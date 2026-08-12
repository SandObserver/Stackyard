const path = require('path');
const { on, json, readBody, checkOrigin, getIp } = require('./router');
const { loadConfig } = require('./config');
const { fetchChecked, fetchUnchecked, SsrfBlockedError } = require('./proxy');
const { parsePrometheus } = require('./parse-prometheus');
const { cpuSample, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds } = require('./metrics');
const { getRegistry, WIDGETS_PATH } = require('./widgets');
const { preserveWidgetSecrets } = require('./widget-secrets');
const { widgetConfigMatchesSaved, RETYPE_MESSAGE } = require('./secret-scope');
const { dispatchProvider } = require('./provider-dispatch');
const { widgetSettings } = require('./widget-settings');
const { IS_DEMO } = require('./demo');
const demoData = require('./demo-data');
const log = require('./log');
const { fail, KIND, WidgetError } = require('./api-error');
const { rateLimit } = require('./auth');
const LIMITS = require('./poll-limits');

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
    fetchJSON: fetch,
    parsePrometheus,
    metrics: IS_DEMO ? demoData.metrics : { cpuSample, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds },
    demo: IS_DEMO ? demoData.helpers : null,
    normalizeBase,
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
    throw new Error(`${file} failed to load: ` + e.message);
  }
  if (typeof fn !== 'function') throw new Error(`${file} must export a function`);
  return await fn(ctx);
}

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
  const limited = rateLimit(
    getIp(req),
    `widget-data:${req.params.id}`,
    LIMITS.WIDGET_DATA.max,
    LIMITS.WIDGET_DATA.windowMs,
  );
  if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED });
  const cfg = loadConfig();
  const item = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!item) return json(res, 404, { error: 'widget not found', kind: KIND.INVALID });

  const entry = getRegistry()[item.widgetType];
  if (!entry) return json(res, 404, { error: 'unknown widget type', kind: KIND.INVALID });

  const u = new URL(req.url, 'http://x');
  const endpointName = u.searchParams.get('endpoint') || '';

  try {
    const out = await getWidgetData(item, entry, endpointName, u.searchParams, fetchUnchecked);
    json(res, out.status, out.body);
  } catch (e) {
    log.error('widget-data failed', { widget: item.widgetType, id: item.id, error: e.message });
    fail(res, e, { status: 502 });
  }
});

/* Config-time "Fetch" for a select field declared with optionsFrom. The id is
   '__preview__' before the first save. */
on('POST', '/api/widget-options/:id', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  const limited = rateLimit(getIp(req), 'widget-options', LIMITS.WIDGET_OPTIONS.max, LIMITS.WIDGET_OPTIONS.windowMs);
  if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED });
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
  const saved = (loadConfig().items || []).find(i => i.id === req.params.id && i.type === 'widget');
  /* Only restore a blanked secret when the rest of the posted config matches
     what is saved. Otherwise the request picks the destination while the server
     supplies the credential. */
  const scoped = !!saved && widgetConfigMatchesSaved(item.widgetConfig, saved.widgetConfig, entry);
  if (scoped) preserveWidgetSecrets(item, saved, entry);

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
    json(res, out.status, out.body);
  } catch (e) {
    if (e instanceof SsrfBlockedError) return fail(res, e, { status: e.status });
    if (!scoped && saved) return fail(res, e, { status: 502, kind: KIND.INVALID, error: RETYPE_MESSAGE });
    log.error('widget-options failed', { widget: body.widgetType, error: e.message });
    fail(res, e, { status: 502 });
  }
});

module.exports = { getWidgetData, normalizeBase, dataFnContext, resolveRow };
