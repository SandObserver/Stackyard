/* The server requires this file directly. Keep it free of the DOM, of window
   and of imports. */

export const DOCK_MAX = 4;

export const NAME_MAX = 64;

export const ITEMS_MAX = 5000;

/** @param {string} name @returns {string} */
export function clampName(name) {
  const s = String(name);
  if (s.length <= NAME_MAX) return s;
  const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)];
  return parts.length <= NAME_MAX
    ? s
    : parts
        .slice(0, NAME_MAX)
        .map(p => p.segment)
        .join('');
}

export const CONFIG_MAX_BYTES = 2 * 1024 * 1024;
