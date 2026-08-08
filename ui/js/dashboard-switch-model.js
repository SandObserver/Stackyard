/* Pure render model for the Dashboard Switch widget. Keep it free of the DOM.
   A keychain's elements, and its colour when the user left it unset, are derived
   from the dashboard URL, so the same URL always draws the same keychain. */

/* `id` is stored in config; `hex` is what the frontend paints. */
export const PALETTE = [
  { id: 'teal', label: 'Teal', hex: '#14b8c6' },
  { id: 'cyan', label: 'Cyan', hex: '#22c1d6' },
  { id: 'orange', label: 'Orange', hex: '#ef8a2b' },
  { id: 'pink', label: 'Pink', hex: '#f5325b' },
  { id: 'purple', label: 'Purple', hex: '#7c5cff' },
  { id: 'green', label: 'Green', hex: '#2fbf71' },
  { id: 'yellow', label: 'Yellow', hex: '#f4c430' },
  { id: 'blue', label: 'Blue', hex: '#2f6df4' },
];

/* Each id maps to an art asset in the widget frontend. `metal` groups similar
   keys, so a keychain avoids stacking two that read as one blob. */
export const KEY_STYLES = [
  { id: 'silver-key-a', metal: 'silver' },
  { id: 'silver-key-d', metal: 'silver' },
  { id: 'gold-key-solid', metal: 'gold' },
  { id: 'gold-key-open', metal: 'gold' },
  { id: 'black-key-a', metal: 'black' },
  { id: 'black-key-round', metal: 'black' },
  { id: 'skeleton-brass', metal: 'brass' },
];

export const EXTRA_STYLES = ['ring-disc', 'tag-dog-gray', 'tag-long-black', 'tag-rect-silver', 'strap-blue'];

const EXTRA_CHANCE = 0.45;

/* FNV-1a 32-bit. Stable across Node and browsers (integer math only). */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* mulberry32 PRNG seeded from a uint32. Deterministic; returns [0,1). */
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Deterministic Fisher-Yates draw of k distinct items from a catalog. */
function pickDistinct(rng, catalog, k) {
  const pool = catalog.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.min(k, pool.length));
}

/* The canonical form used for hashing, matching and the href. Cosmetic
   differences collapse; a different port or subpath is preserved. Null for
   anything that is not a usable http(s) URL. */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s) ? s : `http://${s}`;
  let u;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  let path = u.pathname || '';
  if (path === '/') path = '';
  else if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const port = u.port ? `:${u.port}` : '';
  return `${u.protocol}//${u.hostname}${port}${path}${u.search || ''}${u.hash || ''}`;
}

function originOf(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '' : u.pathname;
  } catch {
    return '';
  }
}

function hostLabel(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/* Matches on origin, and on the subpath too when the keychain URL carries one,
   as a reverse-proxy setup does. Both arguments must be canonical. */
export function sameDashboard(slotUrl, currentUrl) {
  if (!slotUrl || !currentUrl) return false;
  if (originOf(slotUrl) !== originOf(currentUrl)) return false;
  const sp = pathOf(slotUrl);
  if (!sp) return true;
  const cp = pathOf(currentUrl);
  return cp === sp || cp.startsWith(`${sp}/`);
}

/* Guarantees 1 to 3 distinct keys and at most one non-key dangler, from disjoint
   catalogs, so nothing repeats within a keychain. */
export function deriveComposition(canonicalUrl) {
  const rng = mulberry32(hashString(canonicalUrl));
  const numKeys = 1 + Math.floor(rng() * 3);
  const shuffled = pickDistinct(rng, KEY_STYLES, KEY_STYLES.length);
  const keys = [];
  const metals = new Set();
  /* First pass: one key per distinct metal, so keys stay visually separable. */
  for (const k of shuffled) {
    if (keys.length >= numKeys) break;
    if (!metals.has(k.metal)) {
      keys.push(k.id);
      metals.add(k.metal);
    }
  }
  /* Fallback only if more keys were asked for than there are metals. */
  for (const k of shuffled) {
    if (keys.length >= numKeys) break;
    if (!keys.includes(k.id)) keys.push(k.id);
  }
  const extras = rng() < EXTRA_CHANCE ? pickDistinct(rng, EXTRA_STYLES, 1) : [];
  return { keys, extras };
}

/* On a stream independent of the composition, so colour and elements do not move
   together. Only used when the colour is unset. */
export function deriveColor(canonicalUrl) {
  const rng = mulberry32(hashString(canonicalUrl) ^ 0x9e3779b9);
  return PALETTE[Math.floor(rng() * PALETTE.length)].id;
}

function isValidColor(id) {
  return typeof id === 'string' && PALETTE.some(p => p.id === id);
}

/* config: { keychains: [ { name, url, color }, ... ], openIn?: 'same'|'new' }
   opts:   { size?: 'small'|'medium', currentHref?: string }
   Returns { size, capacity, openIn, count, slots }, each slot ready to draw. */
export function buildModel(config = {}, opts = {}) {
  const size = opts.size === 'small' ? 'small' : 'medium';
  const capacity = size === 'small' ? 2 : 5;
  const openIn = config && config.openIn === 'new' ? 'new' : 'same';
  const currentCanonical = normalizeUrl(opts.currentHref || '');
  const rows = config && Array.isArray(config.keychains) ? config.keychains : [];

  const seen = new Set();
  const slots = [];
  for (const row of rows) {
    if (slots.length >= capacity) break;
    if (!row || typeof row !== 'object') continue;
    const href = normalizeUrl(row.url);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const colorId = isValidColor(row.color) ? row.color : deriveColor(href);
    const color = PALETTE.find(p => p.id === colorId) || PALETTE[0];
    const comp = deriveComposition(href);
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : hostLabel(href);
    slots.push({
      name,
      url: href,
      href,
      color: color.id,
      colorHex: color.hex,
      keys: comp.keys,
      extras: comp.extras,
      isCurrent: currentCanonical ? sameDashboard(href, currentCanonical) : false,
    });
  }
  return { size, capacity, openIn, count: slots.length, slots };
}
