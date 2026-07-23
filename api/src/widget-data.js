const path = require('path');
const { on, json, readBody, checkOrigin } = require('./router');
const { loadConfig } = require('./config');
const { fetchChecked, fetchUnchecked, SsrfBlockedError } = require('./proxy');
const { parsePrometheus } = require('./parse-prometheus');
const { cpuPercent, ramPercent, cpuTemp, diskStats, cpuIoWait, procCount, uptimeSeconds } = require('./metrics');
const { getRegistry, WIDGETS_PATH } = require('./widgets');
const { preserveWidgetSecrets } = require('./widget-secrets');
const { dispatchProvider } = require('./provider-dispatch');
const { IS_DEMO } = require('./demo');
const demoData = require('./demo-data');
const log = require('./log');

/* Normalize a user-entered base URL the same way the existing hand-written data
   routes do (e.g. AdGuard): add http:// when no scheme is given, and strip any
   trailing slashes. Host-IP → container-name rewriting is applied later by the
   fetch boundary, so it is intentionally not repeated here. */
function normalizeBase(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const withProto = s.includes('://') ? s : 'http://' + s;
  return withProto.replace(/\/+$/, '');
}

/* Fill {field} placeholders in an auth value template from the widget config. */
/* The toolbox handed to a widget's data.js. These are the same server-side
   primitives the built-in complex widgets use, so an author writing a data
   function reuses them instead of re-deriving them. */
function dataFnContext(wc, endpoint, searchParams, fetch) {
  const ctx = {
    config:   wc,                 /* full widgetConfig, including secrets (server-side only) */
    settings: loadConfig().settings || {}, /* global non-secret config (e.g. stats.diskMount, networkInterface), server-side only */
    endpoint: endpoint,
    params:   searchParams,       /* URLSearchParams for any extra query params */
    /* Named fetchJSON because widget data.js files destructure it. The caller
       supplies the fetcher to match the URL's provenance: fetchUnchecked for a
       saved-config widget (widget-data), fetchChecked for a request-supplied
       preview config (widget-options). */
    fetchJSON: fetch,
    parsePrometheus,
    metrics:  IS_DEMO ? demoData.metrics : { cpuPercent, ramPercent, cpuTemp, diskStats, cpuIoWait, procCount, uptimeSeconds },
    normalizeBase,
    log,
  };
  /* Provider dispatch for multi-provider widgets, bound to this ctx so callers
     write ctx.dispatchProvider(handlers, opts). */
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return ctx;
}

/* Run a widget's data function. The module ships inside the widget folder and
   is part of the image (trusted maintainer/author code, not runtime input),
   the same trust model as the built-in routes it replaces. */
async function runDataFn(name, ctx) {
  const fnPath = path.join(WIDGETS_PATH, name, 'data.js');
  let fn;
  try { fn = require(fnPath); }
  catch (e) { throw new Error('data function failed to load: ' + e.message); }
  if (typeof fn !== 'function') throw new Error('data.js must export an async function');
  return await fn(ctx);
}

/* Core: resolve a widget's data by running its data.js. A widget with no data.js
   is client-only and has no server data source. Exported for tests. */
async function getWidgetData(item, entry, endpointName, searchParams, fetch) {
  const wc = item.widgetConfig || {};
  if (IS_DEMO) {
    /* Stats runs its real code path against fake metrics; the fetch-based
       widgets get a canned body since their upstream is unreachable here. */
    const body = demoData.demoWidgetBody(item.widgetType);
    if (body) return { status: 200, body };
  }
  if (!entry.hasDataFn) return { status: 503, body: { error: 'widget declares no data source' } };
  const result = await runDataFn(entry.manifest.name, dataFnContext(wc, endpointName, searchParams, fetch));
  return { status: 200, body: result };
}

on('GET', '/api/widget-data/:id', async (req, res) => {
  const cfg = loadConfig();
  const item = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!item) return json(res, 404, { error: 'widget not found' });

  const entry = getRegistry()[item.widgetType];
  if (!entry) return json(res, 404, { error: 'unknown widget type' });

  const u = new URL(req.url, 'http://x');
  const endpointName = u.searchParams.get('endpoint') || '';

  try {
    const out = await getWidgetData(item, entry, endpointName, u.searchParams, fetchUnchecked);
    json(res, out.status, out.body);
  } catch (e) {
    log.error('widget-data failed', { widget: item.widgetType, id: item.id, error: e.message });
    json(res, 502, { error: e.message });
  }
});

/* Config-time "Fetch" for select fields declared with optionsFrom (e.g. the
   Books list picker). Mirrors the backup widget's fetch endpoints: the admin UI
   posts the in-progress config (URL + secret, or omits the secret to reuse the
   saved one), keyed by widget id ('__preview__' before first save). Reuses the
   widget's own data.js via the named endpoint, so no per-widget backend code. */
on('POST', '/api/widget-options/:id', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid body' }); }
  const entry = getRegistry()[body.widgetType];
  if (!entry || !entry.hasDataFn) return json(res, 400, { error: 'unknown widget type' });

  const item = { type: 'widget', id: req.params.id, widgetType: body.widgetType, widgetConfig: body.widgetConfig || {} };
  const saved = (loadConfig().items || []).find(i => i.id === req.params.id && i.type === 'widget');
  if (saved) preserveWidgetSecrets(item, saved, entry); /* restore a secret the form left blank */

  try {
    const out = await getWidgetData(item, entry, body.endpoint || '', new URLSearchParams(), fetchChecked);
    json(res, out.status, out.body);
  } catch (e) {
    if (e instanceof SsrfBlockedError) return json(res, e.status, { error: e.message });
    log.error('widget-options failed', { widget: body.widgetType, error: e.message });
    json(res, 502, { error: e.message });
  }
});

module.exports = { getWidgetData, normalizeBase, dataFnContext };
