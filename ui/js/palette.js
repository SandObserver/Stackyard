// @ts-check
/* Mirrors tokens.css. ui/test/palette.test.mjs fails on drift. */

/** @type {readonly string[]} */
export const HUE_NAMES = [
  'red',
  'orange',
  'yellow',
  'green',
  'mint',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
  'brown',
  'gray',
];

/** @type {readonly string[]} */
export const ROLE_NAMES = ['accent', 'success', 'warning', 'danger', 'info'];

/** @type {readonly string[]} */
export const TILE_KEYWORDS = ['dark', 'light', 'auto', 'clear'];

/* Prototype-free. A name like "constructor" otherwise resolves to a function
   and reaches the DOM as a colour. */
const _tables = t => {
  for (const k of Object.keys(t)) t[k] = Object.assign(Object.create(null), t[k]);
  return t;
};

const HUES = _tables({
  dark: {
    red: '#FF4245',
    orange: '#FF9230',
    yellow: '#FFD600',
    green: '#30D158',
    mint: '#00DAC3',
    teal: '#00D2E0',
    cyan: '#3CD3FE',
    blue: '#0091FF',
    indigo: '#6D7CFF',
    purple: '#DB34F2',
    pink: '#FF375F',
    brown: '#B78A66',
    gray: '#8E8E93',
  },
  light: {
    red: '#FF383C',
    orange: '#FF8D28',
    yellow: '#FFCC00',
    green: '#34C759',
    mint: '#00C8B3',
    teal: '#00C3D0',
    cyan: '#00C0E8',
    blue: '#0088FF',
    indigo: '#6155F5',
    purple: '#CB30E0',
    pink: '#FF2D55',
    brown: '#AC7F5E',
    gray: '#8E8E93',
  },
});

const ROLES = _tables({
  dark: { accent: '#00D2E0', success: '#30D158', warning: '#FF9230', danger: '#FF4245', info: '#0091FF' },
  light: { accent: '#0071A4', success: '#238539', warning: '#C93400', danger: '#D70015', info: '#0040DD' },
});

const TILE = _tables({
  dark: { dark: '#1C1C1E', light: '#F2F2F7', auto: '#1C1C1E', clear: 'rgba(120,120,128,.36)' },
  light: { dark: '#1C1C1E', light: '#F2F2F7', auto: '#F2F2F7', clear: 'rgba(255,255,255,.45)' },
});

/** @param {unknown} theme */
const pick = theme => (theme === 'light' ? 'light' : 'dark');

/** @param {unknown} name @param {unknown} theme @returns {string} */
export function paletteColor(name, theme) {
  const t = pick(theme);
  if (typeof name !== 'string') return '';
  return HUES[t][name] || ROLES[t][name] || '';
}

/** @param {unknown} name @param {unknown} theme @returns {string} */
export function tileColor(name, theme) {
  if (typeof name !== 'string') return '';
  return TILE[pick(theme)][name] || paletteColor(name, theme);
}

/** @param {{ documentElement?: { getAttribute(n: string): string|null } }} [doc] */
export function pageTheme(doc = globalThis.document) {
  return doc?.documentElement?.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
