const path = require('path');
const { on, json, readBody, checkOrigin, getIp } = require('./router');
const { loadConfig } = require('./config');
const { fetchChecked, fetchUnchecked, SsrfBlockedError } = require('./proxy');
const { parsePrometheus } = require('./parse-prometheus');
const { cpuSample, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds } = require('./metrics');
const { getRegistry, WIDGETS_PATH } = require('./widgets');
const { translatorFor } = require('./widget-i18n');
const { preserveWidgetSecrets } = require('./widget-secrets');
const { alignSavedConfig, leavesStoredSecretBlank, RETYPE_MESSAGE } = require('./secret-scope');
const { dispatchProvider } = require('./provider-dispatch');
const { widgetSettings } = require('./widget-settings');
const { IS_DEMO } = require('./demo');
const demoData = require('./demo-data');
const log = require('./log');
const failureLog = require('./failure-log');
const { fail, KIND, WidgetError } = require('./api-error');
const { rateLimit } = require('./auth');
const LIMITS = require('./poll-limits');
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');
const { FETCH_MS, WIDGET_BUDGET_MS, WIDGET_HOLD_MS, WIDGET_KEEP_MS } = require('./timeouts');
const { latest } = require('./latest');

function normalizeBase(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const withProto = s.includes('://') ? s : 'http://' + s;
  return withProto.replace(/\/+$/, '');
}

/* Request-supplied, so the shape is checked rather than trusted. */
function resolveRow(wc, row) {
  if (!row || typeof row.key !== 'string' || !Number.isInteger(row.index) || row.index < 0) return null;
  if (!Object.hasOwn(wc, row.key)) return null;
  const rows = wc[row.key];
  if (!Array.isArray(rows)) return null;
  const r = rows[row.index];
  return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
}

/* A body that is not JSON, XML or metrics resolves as a string. A widget that
   spreads it into its reply blocks the API for seconds. */
const refuseUnreadable =
  fetch =>
  async (url, opts = {}) => {
    const r = await fetch(url, opts);
    if (!opts.raw && r.status < 400 && typeof r.data === 'string' && r.data.trim() !== '') {
      throw new WidgetError('The service sent a reply that is not JSON.', { kind: KIND.UPSTREAM });
    }
    return r;
  };

const withinBudget =
  (fetch, deadline) =>
  (url, opts = {}) => {
    const left = deadline - Date.now();
    if (left <= 0) return Promise.reject(new Error('Timed out'));
    return fetch(url, { ...opts, timeout: Math.min(opts.timeout || FETCH_MS, left) });
  };

function dataFnContext(wc, endpoint, searchParams, fetch, row = null) {
  const ctx = {
    config: wc /* full widgetConfig, including secrets (server-side only) */,
    /* Non-secret keys only. The full settings object carries the session signing
       key and the password hash. */
    settings: widgetSettings(loadConfig().settings),
    endpoint: endpoint,
    row: resolveRow(wc, row),
    params: searchParams,
    /* The caller supplies the fetcher to match the URL's provenance: unchecked
       for saved config, checked for a request-supplied preview config. */
    fetchJSON: refuseUnreadable(withinBudget(fetch, Date.now() + WIDGET_BUDGET_MS)),
    parsePrometheus,
    metrics: IS_DEMO ? demoData.metrics : { cpuSample, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds },
    demo: IS_DEMO ? demoData.helpers : null,
    normalizeBase,
    serviceBase,
    serviceLink,
    fail: (message, opts) => {
      throw new WidgetError(message, opts);
    },
    KIND,
    log,
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return ctx;
}

async function runDataFn(name, ctx) {
  return runWidgetModule(name, 'data.js', ctx);
}

function runDemoFn(name, ctx) {
  return runWidgetModule(name, 'demo.js', ctx);
}

async function runWidgetModule(name, file, ctx) {
  const fnPath = path.join(WIDGETS_PATH, name, file);
  let fn;
  try {
    fn = require(fnPath);
  } catch (e) {
    throw new Error(`${file} failed to load`, { cause: e });
  }
  if (typeof fn !== 'function') throw new Error(`${file} must export a function`);
  return await fn(ctx);
}

/* Only these reach data.js and the cache key. Passing the raw query lets each
   distinct value store its own cached reply. */
function widgetParams(searchParams, manifest) {
  const out = new URLSearchParams();
  for (const k of ['endpoint', ...(manifest?.params || [])]) {
    const v = searchParams.get(k);
    if (v !== null) out.set(k, v);
  }
  return out;
}

/* Declared values still come from the request. Without this cap one client can
   fill the heap. */
const KEPT_PER_WIDGET = 16;

async function getWidgetData(item, entry, endpointName, searchParams, fetch, row = null, isOptions = false) {
  const wc = item.widgetConfig || {};
  /* An options fetch must run the real path, or the editor shows fabricated
     options. */
  if (IS_DEMO && !isOptions && entry.hasDemoFn) {
    const body = await runDemoFn(entry.manifest.name, dataFnContext(wc, endpointName, searchParams, fetch, row));
    if (body) return { status: 200, body };
  }
  if (!entry.hasDataFn) return { status: 503, body: { error: 'widget declares no data source', kind: KIND.INVALID } };
  const result = await runDataFn(entry.manifest.name, dataFnContext(wc, endpointName, searchParams, fetch, row));
  return { status: 200, body: result };
}

on('GET', '/api/widget-data/:id', async (req, res) => {
  const cfg = loadConfig();
  const item = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  /* Before the rate limit. Its key holds the id, so an unknown id would store a
     bucket per request. */
  if (!item) return json(res, 404, { error: 'widget not found', kind: KIND.INVALID });
  const limited = rateLimit(getIp(req), `widget-data:${item.id}`, LIMITS.WIDGET_DATA.max, LIMITS.WIDGET_DATA.windowMs);
  if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED, code: 'blocked.rate-limit' });

  const entry = getRegistry()[item.widgetType];
  if (!entry) return json(res, 404, { error: 'unknown widget type', kind: KIND.INVALID });

  const params = widgetParams(new URL(req.url, 'http://x').searchParams, entry.manifest);
  const endpointName = params.get('endpoint') || '';

  const logKey = `${item.id}\n${endpointName}`;
  const logFields = { widget: item.widgetType, id: item.id };
  const refresh = () =>
    getWidgetData(item, entry, endpointName, params, fetchUnchecked).then(
      out => {
        failureLog.recovered(logKey, 'widget-data recovered', logFields);
        return out;
      },
      e => {
        failureLog.failed(logKey, 'widget-data failed', logFields, log.reason(e), {
          group: item.id,
          maxPerGroup: KEPT_PER_WIDGET,
        });
        throw e;
      },
    );
  const outcome = await latest(`${cfg._rev}:${item.id}?${params}`, refresh, {
    holdMs: WIDGET_HOLD_MS,
    keepMs: WIDGET_KEEP_MS,
    group: `${cfg._rev}:${item.id}`,
    maxPerGroup: KEPT_PER_WIDGET,
  });
  if (!outcome) return json(res, 202, { pending: true });
  if (outcome.ok) {
    res.setHeader('Age', String(Math.max(0, Math.floor((Date.now() - outcome.at) / 1000))));
    return json(res, outcome.value.status, outcome.value.body);
  }
  fail(res, outcome.error, { status: 502, quiet: true });
});

/* Config-time "Fetch" for a select field declared with optionsFrom. The id is
   '__preview__' before the first save. */
function labelOptions(body, entry, widget) {
  if (!body || !Array.isArray(body.options) || !body.options.some(o => o && o.labelKey)) return body;
  const translate = translatorFor(entry.dir, widget, loadConfig().settings?.language || 'en');
  const options = body.options.map(o => {
    if (!o || typeof o.labelKey !== 'string') return o;
    const { labelKey, ...rest } = o;
    const found = translate(labelKey);
    return found === labelKey ? rest : { ...rest, label: found };
  });
  return { ...body, options };
}

on('POST', '/api/widget-options/:id', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  const limited = rateLimit(getIp(req), 'widget-options', LIMITS.WIDGET_OPTIONS.max, LIMITS.WIDGET_OPTIONS.windowMs);
  if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED, code: 'blocked.rate-limit' });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'invalid body', kind: KIND.INVALID });
  }
  const entry = getRegistry()[body.widgetType];
  if (!entry || !entry.hasDataFn) return json(res, 400, { error: 'unknown widget type', kind: KIND.INVALID });

  const item = {
    type: 'widget',
    id: req.params.id,
    widgetType: body.widgetType,
    widgetConfig: body.widgetConfig || {},
  };
  const saved = (loadConfig().items || []).find(
    i => i.id === req.params.id && i.type === 'widget' && i.widgetType === body.widgetType,
  );
  /* Only restore a blanked secret when the rest of the posted config matches
     what is saved. Otherwise the request picks the destination while the server
     supplies the credential. */
  const aligned = saved ? alignSavedConfig(item.widgetConfig, saved.widgetConfig, entry) : null;
  const withheld = aligned
    ? aligned.dropped
    : !!saved && leavesStoredSecretBlank(item.widgetConfig, saved.widgetConfig, entry);
  if (aligned) preserveWidgetSecrets(item, { ...saved, widgetConfig: aligned.config }, entry);

  try {
    const out = await getWidgetData(
      item,
      entry,
      body.endpoint || '',
      new URLSearchParams(),
      fetchChecked,
      body.row,
      true,
    );
    json(res, out.status, labelOptions(out.body, entry, body.widgetType));
  } catch (e) {
    if (e instanceof SsrfBlockedError) return fail(res, e, { status: e.status });
    if (withheld)
      return fail(res, e, { status: 502, kind: KIND.INVALID, code: 'invalid.retype', error: RETYPE_MESSAGE });
    log.error('widget-options failed', { widget: body.widgetType, error: log.reason(e) });
    fail(res, e, { status: 502 });
  }
});

module.exports = { getWidgetData, widgetParams, normalizeBase, dataFnContext, resolveRow, labelOptions };
