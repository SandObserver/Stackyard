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
/* Resolve the group row an options fetch came from. Request-supplied, so the
   shape is checked rather than trusted. */
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
    config:   wc,                 /* full widgetConfig, including secrets (server-side only) */
    /* Only the shared non-secret keys, as a frozen copy. See widget-settings.js:
       the full settings object carries the session signing key and the password
       hash, and handing over the live object let a data function rewrite them. */
    settings: widgetSettings(loadConfig().settings),
    endpoint: endpoint,
    /* Set only for an optionsFrom fetch from inside a group: the row's own
       values, so a per-row picker reads the URL and key that row was given.
       The full config still travels so secrets are preserved as usual. */
    row:      resolveRow(wc, row),
    params:   searchParams,       /* URLSearchParams for any extra query params */
    /* Named fetchJSON because widget data.js files destructure it. The caller
       supplies the fetcher to match the URL's provenance: fetchUnchecked for a
       saved-config widget (widget-data), fetchChecked for a request-supplied
       preview config (widget-options). */
    fetchJSON: fetch,
    parsePrometheus,
    metrics:  IS_DEMO ? demoData.metrics : { cpuSample, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds },
    /* Only set in demo mode, where a widget's demo.js uses it to drift its
       invented numbers on the same clock as every other widget's. */
    demo:     IS_DEMO ? demoData.helpers : null,
    normalizeBase,
    /* Throw this to report a failure in the widget author's own words. A plain
       Error is sanitised to a generic message, which is right for a caught
       exception and wrong for "Set a Pi-hole password". See api-error.js. */
    fail: (message, opts) => { throw new WidgetError(message, opts); },
    KIND,
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
  return runWidgetModule(name, 'data.js', ctx);
}

/* Same contract as data.js, but only reached in demo mode, so the file is never
   required on a normal install. */
function runDemoFn(name, ctx) {
  return runWidgetModule(name, 'demo.js', ctx);
}

async function runWidgetModule(name, file, ctx) {
  const fnPath = path.join(WIDGETS_PATH, name, file);
  let fn;
  try { fn = require(fnPath); }
  catch (e) { throw new Error(`${file} failed to load: ` + e.message); }
  if (typeof fn !== 'function') throw new Error(`${file} must export a function`);
  return await fn(ctx);
}

/* Core: resolve a widget's data by running its data.js. A widget with no data.js
   is client-only and has no server data source. Exported for tests. */
async function getWidgetData(item, entry, endpointName, searchParams, fetch, row = null, isOptions = false) {
  const wc = item.widgetConfig || {};
  /* Only the dashboard's own data gets a canned body. An optionsFrom fetch has
     to run the real code path, because a demo visitor opening the widget editor
     should see the upstream fail rather than a list of fabricated options. */
  if (IS_DEMO && !isOptions && entry.hasDemoFn) {
    /* A widget whose upstream is unreachable here ships a demo.js returning an
       invented body. One without it (stats) runs its real code path, because
       ctx.metrics already hands it fake numbers. */
    const body = await runDemoFn(entry.manifest.name, dataFnContext(wc, endpointName, searchParams, fetch, row));
    if (body) return { status: 200, body };
  }
  if (!entry.hasDataFn) return { status: 503, body: { error: 'widget declares no data source', kind: KIND.INVALID } };
  const result = await runDataFn(entry.manifest.name, dataFnContext(wc, endpointName, searchParams, fetch, row));
  return { status: 200, body: result };
}

on('GET', '/api/widget-data/:id', async (req, res) => {
  /* Counted per widget id, since that is what maps to one upstream service.
     See poll-limits.js. */
  const limited = rateLimit(getIp(req), `widget-data:${req.params.id}`, LIMITS.WIDGET_DATA.max, LIMITS.WIDGET_DATA.windowMs);
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

/* Config-time "Fetch" for select fields declared with optionsFrom (e.g. the
   Books list picker). Mirrors the backup widget's fetch endpoints: the admin UI
   posts the in-progress config (URL + secret, or omits the secret to reuse the
   saved one), keyed by widget id ('__preview__' before first save). Reuses the
   widget's own data.js via the named endpoint, so no per-widget backend code. */
on('POST', '/api/widget-options/:id', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  /* Admin only and never polled, so a low ceiling is ample. See
     poll-limits.js. */
  const limited = rateLimit(getIp(req), 'widget-options', LIMITS.WIDGET_OPTIONS.max, LIMITS.WIDGET_OPTIONS.windowMs);
  if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid body', kind: KIND.INVALID }); }
  const entry = getRegistry()[body.widgetType];
  if (!entry || !entry.hasDataFn) return json(res, 400, { error: 'unknown widget type', kind: KIND.INVALID });

  const item = { type: 'widget', id: req.params.id, widgetType: body.widgetType, widgetConfig: body.widgetConfig || {} };
  const saved = (loadConfig().items || []).find(i => i.id === req.params.id && i.type === 'widget');
  /* Restore a secret the form left blank, but only when the rest of the posted
     config is identical to what is saved. Otherwise the request chooses the
     destination while the server supplies the credential, which would send a
     stored secret wherever the caller asked. See secret-scope.js. */
  const scoped = !!saved && widgetConfigMatchesSaved(item.widgetConfig, saved.widgetConfig, entry);
  if (scoped) preserveWidgetSecrets(item, saved, entry);

  try {
    const out = await getWidgetData(item, entry, body.endpoint || '', new URLSearchParams(), fetchChecked, body.row, true);
    json(res, out.status, out.body);
  } catch (e) {
    if (e instanceof SsrfBlockedError) return fail(res, e, { status: e.status });
    /* A failure right after declining to restore is very likely the missing
       credential, so say so rather than surfacing an upstream 401. */
    if (!scoped && saved) return fail(res, e, { status: 502, kind: KIND.INVALID, error: RETYPE_MESSAGE });
    log.error('widget-options failed', { widget: body.widgetType, error: e.message });
    fail(res, e, { status: 502 });
  }
});

module.exports = { getWidgetData, normalizeBase, dataFnContext, resolveRow };
