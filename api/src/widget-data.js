const path = require('path');
const { on, json } = require('./router');
const { loadConfig } = require('./config');
const { fetchJSON, parsePrometheus } = require('./proxy');
const { cpuPercent, ramPercent, cpuTemp, diskStats } = require('./metrics');
const { getRegistry, WIDGETS_PATH } = require('./widgets');
const log = require('./log');

/* Normalize a user-entered base URL the same way the existing hand-written data
   routes do (e.g. AdGuard): add http:// when no scheme is given, and strip any
   trailing slashes. Host-IP → container-name rewriting is applied later inside
   fetchJSON, so it is intentionally not repeated here. */
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
function dataFnContext(wc, endpoint, searchParams) {
  return {
    config:   wc,                 /* full widgetConfig, including secrets (server-side only) */
    settings: loadConfig().settings || {}, /* global settings incl. shared secrets (e.g. githubToken) — server-side only */
    endpoint: endpoint,
    params:   searchParams,       /* URLSearchParams for any extra query params */
    fetchJSON,                    /* the safe fetcher (TLS, redirects, size limits, parsing) */
    parsePrometheus,
    metrics:  { cpuPercent, ramPercent, cpuTemp, diskStats },
    normalizeBase,
    buildAuth,
    log,
  };
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
async function fetchDeclarative(decl, wc, endpointName) {
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
  try { r = await fetchJSON(url, { headers, timeout: 8000, skipTls }); }
  catch (e) { return { status: 502, body: { error: e.message } }; }

  if (r.status === 401) return { status: 401, body: { error: 'Upstream auth failed (401) — check credentials' } };
  if (r.status === 403) return { status: 403, body: { error: 'Upstream auth failed (403) — check credentials' } };
  if (r.status >= 500)  return { status: 502, body: { error: 'Upstream HTTP ' + r.status } };
  return { status: 200, body: r.data };
}

/* Core: resolve a widget's data, choosing the data-function path when the
   widget ships a data.js, otherwise the declarative path. Exported for tests. */
async function getWidgetData(item, entry, endpointName, searchParams) {
  const wc = item.widgetConfig || {};
  if (entry.hasDataFn) {
    const result = await runDataFn(entry.manifest.name, dataFnContext(wc, endpointName, searchParams));
    return { status: 200, body: result };
  }
  return fetchDeclarative(entry.manifest.data, wc, endpointName);
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
    const out = await getWidgetData(item, entry, endpointName, u.searchParams);
    json(res, out.status, out.body);
  } catch (e) {
    log.error('widget-data failed', { widget: item.widgetType, id: item.id, error: e.message });
    json(res, 502, { error: e.message });
  }
});

module.exports = { getWidgetData, fetchDeclarative, buildAuth, normalizeBase, dataFnContext };
