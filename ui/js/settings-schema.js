/* Every key the server keeps in settings and in settings.server. A config save
   drops any other key.

   The server requires this file directly. Keep it free of the DOM, of window
   and of imports. */

export const TOP = 'top';
export const SERVER = 'server';

const LOG_LEVELS = ['debug', 'info', 'error'];
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** @typedef {{ key: string, place: 'top' | 'server', general?: boolean, widgets?: boolean,
               normalize?: (value: unknown) => unknown }} SettingSpec
    `general`: the General section of Settings writes it. `normalize`: the value
    to store, or undefined to drop the key. */

/* `widgets` passes the key to every widget data function. Never set it on a key
   that holds a secret. */
/** @type {readonly SettingSpec[]} */
export const SETTINGS = Object.freeze([
  { key: 'background', place: TOP },
  { key: 'showLabels', place: TOP },
  { key: 'keepAwake', place: TOP, normalize: v => v === true },
  { key: 'typeToSearch', place: TOP, normalize: v => v !== false },
  { key: 'stats', place: TOP, widgets: true },
  { key: 'server', place: TOP },
  { key: 'auth', place: TOP },
  { key: 'theme', place: TOP },
  { key: 'layout', place: TOP },
  { key: 'search', place: TOP },
  { key: 'greeting', place: TOP },
  {
    key: 'logLevel',
    place: TOP,
    general: true,
    normalize: v => (!v || LOG_LEVELS.includes(/** @type {string} */ (v)) ? v : undefined),
  },
  {
    key: 'language',
    place: TOP,
    general: true,
    normalize: v => (!v || LANGUAGE_TAG.test(String(v)) ? v : undefined),
  },
  { key: 'hostIp', place: SERVER, general: true },
  { key: 'healthChecks', place: SERVER, general: true },
  { key: 'socketProxyUrl', place: SERVER, general: true },
  { key: 'hideHealthyBadge', place: SERVER, general: true },
  { key: 'proxmox', place: SERVER, general: true },
  { key: 'allowedHosts', place: SERVER, general: true },
  { key: 'skipTlsVerify', place: SERVER },
  { key: 'portMap', place: SERVER },
]);

/** @param {'top' | 'server'} place @returns {string[]} */
export const keysIn = place => SETTINGS.filter(s => s.place === place).map(s => s.key);

/** @param {'top' | 'server'} place @returns {string[]} */
export const generalKeysIn = place => SETTINGS.filter(s => s.place === place && s.general).map(s => s.key);

/** @returns {string[]} the top-level keys a widget data function may read */
export const widgetKeys = () => SETTINGS.filter(s => s.place === TOP && s.widgets).map(s => s.key);

const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** @param {Record<string, unknown>} block @param {'top' | 'server'} place @param {string} prefix
    @param {string[]} dropped */
function normalizeBlock(block, place, prefix, dropped) {
  const specs = new Map(SETTINGS.filter(s => s.place === place).map(s => [s.key, s]));
  for (const key of Object.keys(block)) {
    const spec = specs.get(key);
    if (!spec) {
      delete block[key];
      dropped.push(prefix + key);
      continue;
    }
    if (!spec.normalize) continue;
    const value = spec.normalize(block[key]);
    if (value === undefined) delete block[key];
    else block[key] = value;
  }
}

/** Drops every key the schema does not list and applies each key's rule, in
    place. @param {unknown} settings @returns {string[]} the dropped keys, as
    `key` or `server.key` */
export function normalizeSettings(settings) {
  /** @type {string[]} */
  const dropped = [];
  if (!isPlain(settings)) return dropped;
  const top = /** @type {Record<string, unknown>} */ (settings);
  normalizeBlock(top, TOP, '', dropped);
  if (isPlain(top.server))
    normalizeBlock(/** @type {Record<string, unknown>} */ (top.server), SERVER, 'server.', dropped);
  return dropped;
}
