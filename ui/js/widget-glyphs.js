// @ts-check
/* A glyph per widget type for the Settings item list, drawn on the 24-unit grid
   the other icons in admin.js use. Inline rather than a file per glyph: they are
   stroked with currentColor, so they follow the theme and the increased-contrast
   block with no rule of their own, which an <img> cannot do.

   A widget names one in its manifest. A widget that names none, or names one
   that is not here, keeps the size icon. */

/** @type {Record<string, string>} */
const PATHS = {
  clock: '<circle cx="12" cy="12" r="7.6"/><path d="M12 7.8V12l3.4 2"/>',
  weather:
    '<circle cx="7.8" cy="7.4" r="2.6"/><path d="M9.6 18.2h6.6a3.3 3.3 0 0 0 .2-6.6 4.8 4.8 0 0 0-9.2 1.2 2.8 2.8 0 0 0 1.4 5.4z"/>',
  gauge:
    '<path d="M4.6 16.6a7.6 7.6 0 1 1 14.8 0"/><path d="M12 16.6l3.6-5"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/>',
  shield:
    '<path d="M12 4l6.2 2.5v5c0 3.7-2.6 6.4-6.2 7.7-3.6-1.3-6.2-4-6.2-7.7v-5z"/><path d="M9.4 9.6h5.2M9.4 13h5.2"/>',
  drive:
    '<rect x="3.6" y="6.6" width="16.8" height="10.8" rx="2.6"/><path d="M6.4 12h2.6l1.5-2.8 2.1 5.6 1.5-2.8h2.6"/>',
  archive:
    '<ellipse cx="10" cy="6.6" rx="5.6" ry="2.4"/><path d="M4.4 6.6v6.4c0 1.4 2.5 2.4 5.6 2.4"/><path d="M17.4 11v6.6m0 0l-2.2-2.2m2.2 2.2l2.2-2.2"/>',
  shelf:
    '<rect x="4.6" y="5.6" width="3.8" height="12.8" rx="1.2"/><rect x="9.6" y="5.6" width="3.8" height="12.8" rx="1.2"/><path d="M16 6.8l3.2.9-2.8 10.4-3.2-.9z"/>',
  play: '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4.4"/><path d="M10 8.4l5.6 3.6-5.6 3.6z"/>',
  network:
    '<circle cx="12" cy="6" r="2.3"/><circle cx="5.8" cy="17.4" r="2.3"/><circle cx="18.2" cy="17.4" r="2.3"/><path d="M10.9 8L7 15.4M13.1 8l3.9 7.4M8.1 17.4h7.8"/>',
  merge:
    '<circle cx="7.4" cy="6" r="2.3"/><circle cx="16.6" cy="6" r="2.3"/><circle cx="12" cy="18" r="2.3"/><path d="M7.4 8.3v1.5a3 3 0 0 0 3 3h3.2a3 3 0 0 0 3-3V8.3M12 12.8v2.9"/>',
  panels:
    '<rect x="3.4" y="5" width="10.2" height="8.6" rx="2.2"/><rect x="10.4" y="10.4" width="10.2" height="8.6" rx="2.2"/><path d="M13.6 9.2v1.2"/>',
};

/** The glyph names a manifest may declare. */
export const GLYPH_NAMES = Object.freeze(Object.keys(PATHS));

/** One glyph as SVG markup, or null when the name is not one of ours.
    @param {unknown} name @returns {string|null} */
export function widgetGlyph(name) {
  const d = typeof name === 'string' ? PATHS[name] : undefined;
  if (!d) return null;
  return (
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  );
}
