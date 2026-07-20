const path = require('path');
const { on, json, readBody, checkOrigin } = require('./router');
const { loadConfig } = require('./config');
const { fetchChecked, fetchUnchecked, SsrfBlockedError } = require('./proxy');
const { parsePrometheus } = require('./parse-prometheus');
const { FETCH_MS } = require('./timeouts');
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
function _fill(template, wc) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => (wc[k] != null ? wc[k] : ''));
}

/* Build request auth from the declaration's auth block + the widget's stored
   config (which holds the secret values, server-side only). Returns the headers
   to send and an optional query-string fragment to append to the URL.
   Mirrors the existing routes' habit of only attaching credentials when present. */
function buildAuth(authDecl, wc) {
  const headers = {};
  let query = '';
  if (!authDecl || authDecl.type === 'none' || !authDecl.type) return { headers, query };

  switch (authDecl.type) {
    case 'basic': {
      const user = wc[authDecl.user] || '';
      const pass = wc[authDecl.pass] || '';
      if (user || pass) headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
      break;
    }
    case 'bearer': {
      const token = wc[authDecl.token] || '';
      if (token) headers['Authorization'] = 'Bearer ' + token;
      break;
    }
    case 'header': {
      if (authDecl.name) headers[authDecl.name] = _fill(authDecl.value, wc);
      break;
    }
    case 'query': {
      if (authDecl.name) query = encodeURIComponent(authDecl.name) + '=' + encodeURIComponent(_fill(authDecl.value, wc));
      break;
    }
  }
  return { headers, query };
}

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
    buildAuth,
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

/* Resolve a declarative widget's data into { status, body }.
   Returns upstream JSON on success; surfaces auth failures and upstream errors
   with statuses the widget front-ends already understand. */
async function fetchDeclarative(decl, wc, endpointName, fetch) {
  if (!decl) return { status: 503, body: { error: 'widget declares no data source' } };

  const base = normalizeBase(wc[decl.url]);
  if (!base) return { status: 503, body: { error: 'URL not configured' } };

  const endpoints = decl.endpoints || {};
  let epPath = '';
  if (Object.keys(endpoints).length) {
    if (!endpointName) return { status: 400, body: { error: 'missing ?endpoint=' } };
    if (!(endpointName in endpoints)) return { status: 400, body: { error: `unknown endpoint "${endpointName}"` } };
    epPath = endpoints[endpointName] || '';
    if (epPath && !epPath.startsWith('/')) epPath = '/' + epPath;
  }

  const { headers, query } = buildAuth(decl.auth, wc);
  let url = base + epPath;
  if (query) url += (url.includes('?') ? '&' : '?') + query;

  /* Match AdGuard's behavior: honor an explicit per-widget TLS-skip if set,
     otherwise let fetchJSON fall back to its own host-based heuristic. */
  const skipTls = wc.skipTlsVerify === true ? true : undefined;

  let r;
  try { r = await fetch(url, { headers, timeout: FETCH_MS, skipTls }); }
  catch (e) {
    if (e instanceof SsrfBlockedError) return { status: e.status, body: { error: e.message } };
    return { status: 502, body: { error: e.message } };
  }

  if (r.status === 401) return { status: 401, body: { error: 'Upstream auth failed (401), check credentials' } };
  if (r.status === 403) return { status: 403, body: { error: 'Upstream auth failed (403), check credentials' } };
  if (r.status >= 500)  return { status: 502, body: { error: 'Upstream HTTP ' + r.status } };
  return { status: 200, body: r.data };
}

/* Core: resolve a widget's data, choosing the data-function path when the
   widget ships a data.js, otherwise the declarative path. Exported for tests. */
async function getWidgetData(item, entry, endpointName, searchParams, fetch) {
  const wc = item.widgetConfig || {};
  if (IS_DEMO) {
    /* Stats runs its real code path against fake metrics; the fetch-based
       widgets get a canned body since their upstream is unreachable here. */
    const body = demoData.demoWidgetBody(item.widgetType);
    if (body) return { status: 200, body };
  }
  if (entry.hasDataFn) {
    const result = await runDataFn(entry.manifest.name, dataFnContext(wc, endpointName, searchParams, fetch));
    return { status: 200, body: result };
  }
  return fetchDeclarative(entry.manifest.data, wc, endpointName, fetch);
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

module.exports = { getWidgetData, fetchDeclarative, buildAuth, normalizeBase, dataFnContext };
