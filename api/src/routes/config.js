const { on, json, readBody, checkOrigin } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { loadConfig, saveConfig, ensureSystemItems, migrate } = require('../config');
const log = require('../log');
const { fail, KIND } = require('../api-error');
/* Shared with the browser rather than copied. The Dockerfile places this file
   where the same relative path resolves inside the image. */
const { firstUnsafeLink } = require('../../../ui/js/link-url.js');
const { scrubAllSecrets, preserveAllSecrets } = require('../config-secrets');
const { firstMalformedRow } = require('../badge-headers');
const backoff = require('../poll-backoff');
const { stripDisabledCredentials } = require('../auth');
const { pruneWallpapers } = require('./wallpaper');

const DOCK_MAX = 4;

function scrubSecrets(cfg) {
  const safe = JSON.parse(JSON.stringify(cfg));
  scrubAllSecrets(safe);
  if (safe.settings?.background?.apiKey) delete safe.settings.background.apiKey;
  if (safe.settings?.auth) {
    delete safe.settings.auth.secret;
    delete safe.settings.auth.passwordHash;
  }
  return safe;
}

on('GET', '/api/config', (_, res) => {
  json(res, 200, ensureSystemItems(scrubSecrets(loadConfig())));
});

on('GET', '/api/settings/unsplash-key', (_, res) => {
  json(res, 200, { configured: !!loadConfig().settings?.background?.apiKey });
});

on('POST', '/api/settings/unsplash-key', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  try {
    const { apiKey = '' } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    cfg.settings = cfg.settings || {};
    cfg.settings.background = cfg.settings.background || {};
    if (apiKey.trim()) cfg.settings.background.apiKey = apiKey.trim();
    else delete cfg.settings.background.apiKey;
    saveConfig(cfg);
    json(res, 200, { ok: true });
  } catch (e) {
    fail(res, e, { status: 400 });
  }
});

on('POST', '/api/config', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  try {
    const data = JSON.parse(await readBody(req));
    if (!Array.isArray(data.items)) return json(res, 400, { error: 'items must be an array', kind: KIND.INVALID });
    const bad = data.items.find(i => !i || typeof i.id !== 'string' || !i.id || typeof i.type !== 'string' || !i.type);
    if (bad) return json(res, 400, { error: 'every item needs a non-empty id and type', kind: KIND.INVALID });
    /* Lookups take the first match, so a second item sharing an id is
       unreachable. Refuse rather than rename: renaming changes what folder
       children point at. */
    const seen = new Set();
    for (const item of data.items) {
      if (seen.has(item.id)) {
        return json(res, 400, { error: `duplicate item id: ${item.id}`, kind: KIND.INVALID });
      }
      seen.add(item.id);
    }
    /* A link is rendered into an <a href>. A javascript: or data: URL would
       execute in the dashboard's own origin when the tile is clicked. */
    for (const item of data.items) {
      const badRow = firstMalformedRow(item);
      if (badRow) {
        return json(res, 400, {
          error: `${item.id}: ${badRow.field}[${badRow.index}] is not a { key, value, secret } entry`,
          kind: KIND.INVALID,
        });
      }
      const unsafe = firstUnsafeLink(item);
      if (unsafe) {
        return json(res, 400, {
          error: `${item.id}: ${unsafe.field} must not use the ${unsafe.value.split(':')[0].trim().toLowerCase()} scheme`,
          kind: KIND.INVALID,
        });
      }
    }
    /* Mirrors DOCK_MAX in ui/js/admin-logic.js. The two cannot share a module
       across the CJS/ESM split without a build step. */
    if (data.items.filter(i => i.type === 'app' && i.dock).length > DOCK_MAX)
      return json(res, 400, { error: `at most ${DOCK_MAX} apps can be shown in the dock`, kind: KIND.INVALID });
    const KNOWN_SETTINGS = new Set([
      'background',
      'showLabels',
      'keepAwake',
      'stats',
      'server',
      'auth',
      'theme',
      'layout',
      'search',
      'greeting',
      'logLevel',
      'language',
    ]);
    if (data.settings && typeof data.settings === 'object') {
      for (const key of Object.keys(data.settings)) {
        if (!KNOWN_SETTINGS.has(key)) delete data.settings[key];
      }
      if (data.settings.logLevel && !['debug', 'info', 'error'].includes(data.settings.logLevel))
        delete data.settings.logLevel;
      if (data.settings.language && !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(data.settings.language))
        delete data.settings.language;
      if ('keepAwake' in data.settings) data.settings.keepAwake = data.settings.keepAwake === true;
    }
    const existing = loadConfig();
    /* Stale-write check. A client that sends no _rev overwrites. */
    if (data._rev != null && Number(data._rev) !== (Number(existing._rev) || 0))
      return json(res, 409, {
        error: 'This config was changed somewhere else. Reload the page and try again.',
        kind: KIND.INVALID,
      });
    if (existing.settings?.background?.apiKey && !data.settings?.background?.apiKey) {
      data.settings = data.settings || {};
      data.settings.background = data.settings.background || {};
      data.settings.background.apiKey = existing.settings.background.apiKey;
    }
    /* settings.auth is owned entirely by the /api/auth/* routes. Keep nothing a
       config write supplies. */
    if (data.settings) delete data.settings.auth;
    if (existing.settings?.auth) {
      data.settings = data.settings || {};
      data.settings.auth = JSON.parse(JSON.stringify(existing.settings.auth));
      if (stripDisabledCredentials(data.settings.auth)) log.audit('stale password cleared', {});
    }
    /* A stored credential is only refilled for the request it was stored for. */
    const { withheld } = preserveAllSecrets(data, existing);
    migrate(data);
    ensureSystemItems(data);
    saveConfig(data);
    /* Only now: until the config points at it, the file being replaced is still
       the wallpaper on screen. */
    pruneWallpapers(data.settings?.background?.url);
    /* An edited address must be tried at once, not wait out a backoff the
       previous one earned. */
    backoff.reset();
    if (data.settings) log.setLevel(data.settings.logLevel);
    log.audit('config saved', {});
    if (withheld.length) log.audit('stored credentials withheld', { items: withheld.map(w => w.id) });
    json(res, 200, withheld.length ? { ok: true, withheld } : { ok: true });
  } catch (e) {
    fail(res, e, { status: 400 });
  }
});

on('GET', '/api/config/export', (_, res) => {
  const safe = scrubSecrets(loadConfig());
  delete safe._rev;
  const d = JSON.stringify(safe, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Disposition': 'attachment; filename="dashboard-apps.json"',
    'Content-Length': Buffer.byteLength(d),
  });
  res.end(d);
});
