const path = require('path');
const { on, json, readBody, checkOrigin, getIp } = require('./router');
const { loadConfig } = require('./config');
const { fetchChecked, fetchUnchecked, jsonRpcChecked, jsonRpcUnchecked, SsrfBlockedError } = require('./proxy');
const { parsePrometheus } = require('./parse-prometheus');
const { cpuSample, ramPercent, tempSensors, sensorTemps, diskStats, procCount, uptimeSeconds } = require('./metrics');
const { getRegistry, WIDGETS_PATH } = require('./widget-registry');
const { translatorFor } = require('./widget-i18n');
const { preserveWidgetSecrets } = require('./widget-secrets');
const { alignSavedConfig, duplicateRowRefusal, leavesStoredSecretBlank, RETYPE_MESSAGE } = require('./secret-scope');
const { dispatchProvider } = require('./provider-dispatch');
const { widgetSettings } = require('./widget-settings');
const { withManifestDefaults } = require('./widget-defaults');
const { IS_DEMO } = require('./demo');
const demoData = require('./demo-data');
const log = require('./log');
const failureLog = require('./failure-log');
const { classify, codeOf, fail, KIND, WidgetError } = require('./api-error');
const { rateLimit } = require('./auth');
const LIMITS = require('./poll-limits');
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');
const { FETCH_MS, WIDGET_BUDGET_MS, WIDGET_HOLD_MS, WIDGET_KEEP_MS } = require('./timeouts');
const { latest } = require('./latest');
const { limitPerOrigin } = require('./origin-limit');
const { remember } = require('./bounded-cache');

const PER_ORIGIN = 6;

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

/* A body that is not JSON, XML or metrics resolves as text. A widget that
   spreads it into its reply blocks the API for seconds. */
const READABLE = new Set(['json', 'xml', 'metrics']);
const isEmpty = data => data == null || (typeof data === 'string' && data.trim() === '');

const refuseUnreadable =
  fetch =>
  async (url, opts = {}) => {
    const r = await fetch(url, opts);
    if (!opts.raw && r.status < 400 && !READABLE.has(r.format) && !isEmpty(r.data)) {
      throw new WidgetError('The service sent a reply that is not JSON.', { kind: KIND.UPSTREAM });
    }
    return r;
  };

/** @typedef {{ status: number | undefined }} StatusTrace */

/** @param {Function} fetch @param {StatusTrace | null} trace */
const recordStatus = (fetch, trace) => async (url, opts) => {
  const r = await fetch(url, opts);
  if (trace && typeof r?.status === 'number' && r.status > (trace.status ?? 0)) trace.status = r.status;
  return r;
};

/** @param {any} e @param {StatusTrace} trace @param {number} started */
function failureTiming(e, trace, started) {
  const own = e?.detail?.status ?? (e?.kind === KIND.UPSTREAM ? e.status : undefined);
  const status = typeof own === 'number' ? own : trace.status;
  return status === undefined ? { ms: Date.now() - started } : { ms: Date.now() - started, upstreamStatus: status };
}

const withinBudget =
  (fetch, deadline) =>
  (url, opts = {}, ...rest) => {
    const left = deadline - Date.now();
    if (left <= 0) return Promise.reject(new Error('Timed out'));
    return fetch(url, { ...opts, timeout: Math.min(opts.timeout || FETCH_MS, left) }, ...rest);
  };

/** @typedef {{
      method?: string, headers?: Record<string, string>, body?: string | Buffer, timeout?: number,
      raw?: boolean, binary?: boolean, withHeaders?: boolean, maxBytes?: number, skipTls?: boolean
    }} FetchOptions */

/** @typedef {{
      status: number, data: any, format?: 'json' | 'xml' | 'metrics' | 'text',
      headers?: import('http').IncomingHttpHeaders, contentType?: string, error?: string
    }} FetchReply */

/** The `ctx` a widget's data.js and demo.js receive.
    @typedef {object} WidgetCtx
    @property {Record<string, any>} config the saved widget config, secrets included
    @property {Readonly<Record<string, any>>} settings the allowlisted, frozen slice of global settings
    @property {string} endpoint the `endpoint` query value
    @property {Record<string, any> | null} row the object row the request names, if any
    @property {URLSearchParams} params `endpoint` and the manifest's declared `params`
    @property {(url: string, opts?: FetchOptions) => Promise<FetchReply>} fetchJSON
    @property {(url: string, opts: object, fn: (session: any) => Promise<any>) => Promise<any>} jsonRpc
    @property {typeof parsePrometheus} parsePrometheus
    @property {Record<string, Function>} metrics host metrics, or their demo stand-ins
    @property {typeof demoData.helpers | null} demo `{ wave, round }` in demo mode, else null
    @property {typeof normalizeBase} normalizeBase
    @property {typeof serviceBase} serviceBase
    @property {typeof serviceLink} serviceLink
    @property {typeof remember} remember
    @property {(message: string, opts?: { kind?: string, detail?: object }) => never} fail throws a WidgetError
    @property {typeof KIND} KIND
    @property {typeof classify} classify
    @property {typeof codeOf} codeOf the API code for a caught error, for a partial failure the widget draws itself
    @property {typeof log} log
    @property {(handlers: Record<string, (ctx: WidgetCtx) => any>,
      opts?: { field?: string, default?: string, onError?: (e: any, ctx: WidgetCtx) => any }) => Promise<any>} dispatchProvider */

/** @param {StatusTrace | null} [trace] @returns {WidgetCtx} */
function dataFnContext(wc, endpoint, searchParams, fetch, row = null, trace = null) {
  const deadline = Date.now() + WIDGET_BUDGET_MS;
  /** @type {WidgetCtx} */
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
    fetchJSON: refuseUnreadable(recordStatus(limitPerOrigin(withinBudget(fetch, deadline), PER_ORIGIN), trace)),
    /* Follows the fetcher's provenance. Anything but saved config is checked. */
    jsonRpc: withinBudget(fetch === fetchUnchecked ? jsonRpcUnchecked : jsonRpcChecked, deadline),
    parsePrometheus,
    metrics: IS_DEMO
      ? demoData.metrics
      : { cpuSample, ramPercent, tempSensors, sensorTemps, diskStats, procCount, uptimeSeconds },
    demo: IS_DEMO ? demoData.helpers : null,
    normalizeBase,
    serviceBase,
    serviceLink,
    remember,
    fail: (message, opts) => {
      throw new WidgetError(message, opts);
    },
    KIND,
    classify,
    codeOf,
    log,
    dispatchProvider: (handlers, opts) => dispatchProvider(ctx, handlers, opts),
  };
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

/** @param {StatusTrace | null} [trace] */
async function getWidgetData(
  item,
  entry,
  endpointName,
  searchParams,
  fetch,
  row = null,
  isOptions = false,
  trace = null,
) {
  const wc = withManifestDefaults(item.widgetConfig, entry);
  /* An options fetch must run the real path, or the editor shows fabricated
     options. */
  if (IS_DEMO && !isOptions && entry.hasDemoFn) {
    const body = await runDemoFn(entry.manifest.name, dataFnContext(wc, endpointName, searchParams, fetch, row, trace));
    if (body) return { status: 200, body };
  }
  if (!entry.hasDataFn) return { status: 503, body: { error: 'widget declares no data source', kind: KIND.INVALID } };
  const result = await runDataFn(entry.manifest.name, dataFnContext(wc, endpointName, searchParams, fetch, row, trace));
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
  const refresh = () => {
    /** @type {StatusTrace} */
    const trace = { status: undefined };
    const started = Date.now();
    return getWidgetData(item, entry, endpointName, params, fetchUnchecked, null, false, trace).then(
      out => {
        failureLog.recovered(logKey, 'widget-data recovered', logFields);
        return out;
      },
      e => {
        const fields = { ...logFields, ...failureTiming(e, trace, started) };
        failureLog.failed(logKey, 'widget-data failed', fields, log.reason(e), {
          group: item.id,
          maxPerGroup: KEPT_PER_WIDGET,
        });
        throw e;
      },
    );
  };
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
    const { labelKey, labelVars, ...rest } = o;
    const found = translate(labelKey);
    if (found === labelKey) return rest;
    const label = found.replace(/\{(\w+)\}/g, (m, k) =>
      labelVars && Object.hasOwn(labelVars, k) ? String(labelVars[k]) : m,
    );
    return { ...rest, label };
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
  const refusal = duplicateRowRefusal(item, saved, getRegistry());
  if (refusal) return json(res, 400, refusal);
  /* Only restore a blanked secret when the rest of the posted config matches
     what is saved. Otherwise the request picks the destination while the server
     supplies the credential. */
  const aligned = saved ? alignSavedConfig(item.widgetConfig, saved.widgetConfig, entry) : null;
  const withheld = aligned
    ? aligned.dropped
    : !!saved && leavesStoredSecretBlank(item.widgetConfig, saved.widgetConfig, entry);
  if (aligned) preserveWidgetSecrets(item, { ...saved, widgetConfig: aligned.config }, entry);

  /** @type {StatusTrace} */
  const trace = { status: undefined };
  const started = Date.now();
  try {
    const out = await getWidgetData(
      item,
      entry,
      body.endpoint || '',
      new URLSearchParams(),
      fetchChecked,
      body.row,
      true,
      trace,
    );
    json(res, out.status, labelOptions(out.body, entry, body.widgetType));
  } catch (e) {
    if (e instanceof SsrfBlockedError) return fail(res, e, { status: e.status });
    if (withheld)
      return fail(res, e, { status: 502, kind: KIND.INVALID, code: 'invalid.retype', error: RETYPE_MESSAGE });
    log.error('widget-options failed', {
      widget: body.widgetType,
      ...failureTiming(e, trace, started),
      error: log.reason(e),
    });
    fail(res, e, { status: 502 });
  }
});

module.exports = { getWidgetData, widgetParams, normalizeBase, dataFnContext, resolveRow, labelOptions };
