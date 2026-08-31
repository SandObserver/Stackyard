// @ts-check

/* Layout geometry, keyed by widget family size, never by widget. */
export const WIDGET_HEIGHTS = { small: 150, medium: 150, large: 304, xlarge: 456 };
/* The fixed design canvas per family, in px. Widgets render at these dimensions
   and are scaled to fit the card. */
export const WIDGET_DESIGN = { small: [170, 170], medium: [360, 170], large: [360, 360], xlarge: [360, 540] };
export const WIDGET_COLS = {
  desktop: { small: 1, medium: 2, large: 2, xlarge: 2 },
  mobile: { small: 2, medium: 4, large: 4, xlarge: 4 },
};
export const WIDGET_ROWS = {
  desktop: { small: 0, medium: 0, large: 2, xlarge: 3 },
  mobile: { small: 2, medium: 2, large: 4, xlarge: 6 },
};
export const WIDGET_COST = {
  desktop: { small: 1, medium: 2, large: 4, xlarge: 6 },
  mobile: { small: 4, medium: 8, large: 16, xlarge: 24 },
};

/* The iframe URL, from the manifest entry in `reg`. The cache version is hashed
   from file content at release, never maintained by hand. */
/* A `card` inside the selected view wins over the manifest's top-level one. */
const CARD_PRESETS = ['dark', 'light', 'translucent'];

export function cardPreset(item, reg) {
  const entry = item?.widgetType ? reg?.[item.widgetType] : null;
  if (!entry) return '';
  let card = entry.card || '';
  const views = entry.views;
  if (views) {
    const keys = Object.keys(views);
    const sel = (entry.viewField && item?.widgetConfig?.[entry.viewField]) || entry.defaultView || keys[0];
    const view = views[sel] || views[keys[0]];
    if (view && view.card) card = view.card;
  }
  return CARD_PRESETS.includes(card) ? card : '';
}

export function widgetSrc(item, reg, opts) {
  const type = item?.widgetType;
  const entry = type ? reg?.[type] : null;
  if (!entry) return item?.url || '';

  let file = 'index.html';
  const views = entry.views;
  if (views) {
    const keys = Object.keys(views);
    const sel = (entry.viewField && item?.widgetConfig?.[entry.viewField]) || entry.defaultView || keys[0];
    file = (views[sel] || views[keys[0]] || {}).src || 'index.html';
  }

  const parts = [];
  const ver = entry.entryVersions?.[file];
  if (ver) parts.push('v=' + encodeURIComponent(ver));
  parts.push('id=' + encodeURIComponent(item?.id ?? ''));
  parts.push('size=' + encodeURIComponent(item?.widgetSize || entry.sizes?.[0] || 'medium'));
  if (opts?.mobile) parts.push('mobile=1');
  /* The strings cannot travel here: this URL is also the cache key. */
  if (opts?.lang) parts.push('lang=' + encodeURIComponent(opts.lang));
  return `/widgets/${type}/${file}?${parts.join('&')}`;
}

/* Two widgets of the same type carry the same manifest label, and a frame list
   then holds several entries with one name. */
/** @param {string} base @param {Set<string>} used */
export function uniqueTitle(base, used) {
  let title = base;
  for (let n = 2; used.has(title); n++) title = `${base} ${n}`;
  used.add(title);
  return title;
}
