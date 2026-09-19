// @ts-check
import { iconSvg } from '/js/icon-set.js?v=606a68c6';

/* Keys are the glyph names in widget.json files. Renaming one breaks that widget. */
/** @type {Record<string, string>} */
const GLYPH_ICON = {
  clock: 'clock',
  weather: 'weather',
  gauge: 'system',
  shield: 'dns',
  drive: 'disk',
  archive: 'backup',
  shelf: 'books',
  play: 'nowplaying',
  network: 'connections',
  merge: 'github',
  panels: 'switcher',
};

/** The glyph names a manifest may declare. */
export const GLYPH_NAMES = Object.freeze(Object.keys(GLYPH_ICON));

/** One glyph as SVG markup, or null when the name is not one of ours.
    @param {unknown} name @returns {string|null} */
export function widgetGlyph(name) {
  const id = typeof name === 'string' ? GLYPH_ICON[name] : undefined;
  return id ? iconSvg(id, 26) : null;
}
