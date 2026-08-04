// @ts-check

/* Layout geometry, keyed by widget family size (small/medium/large/xlarge), not
   by widget. Shared by every widget; adding a widget never touches this file. */
export const WIDGET_HEIGHTS = { small:150, medium:150, large:304, xlarge:456 };
/* Fixed internal render resolution per family (design canvas, in px).
   Widgets always render at these dimensions and are scaled uniformly to fit
   their card, so a family looks pixel-identical on every device/renderer.
   Aspect ratios follow Apple's widget families: small 1:1, medium ~2:1, large 1:1. */
export const WIDGET_DESIGN  = { small:[170,170], medium:[360,170], large:[360,360], xlarge:[360,540] };
export const WIDGET_COLS    = { desktop:{small:1,medium:2,large:2,xlarge:2}, mobile:{small:2,medium:4,large:4,xlarge:4} };
export const WIDGET_ROWS    = { desktop:{small:0,medium:0,large:2,xlarge:3}, mobile:{small:2,medium:2,large:4,xlarge:6} };
export const WIDGET_COST    = { desktop:{small:1,medium:2,large:4,xlarge:6}, mobile:{small:4,medium:8,large:16,xlarge:24} };

/* Build a widget's iframe URL from its manifest entry, as served by /api/widgets
   in `reg` (keyed by widget name). A multi-view widget picks its view file from
   the manifest's `viewField` (which widgetConfig key holds the choice) and
   `defaultView`; a single-view widget uses index.html. The cache version comes
   from `entryVersions`, hashed from file content at release, so no version is
   maintained by hand. The `custom` (paste-a-URL) type has no folder, is absent
   from the registry, and falls back to the item's own url. */
/* Which card background a widget asks for, or '' for the default glass. Resolved
   the same way as the view file: a `card` inside the selected view wins over the
   manifest's top-level one, so a widget can style one view differently. Returns
   '' for an unknown name; the server validator is what rejects those. */
export const CARD_PRESETS = ['dark', 'light', 'translucent'];

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
  /* A widget is an iframe and does not load the i18n module, so nothing inside
     it knows which language is selected. Passing it here means the toolbox can
     fetch the same locale file the parent already has, which comes from cache.

     The alternative was passing the translated strings themselves, which would
     lengthen the URL with every new string, and the URL is also the cache key. */
  if (opts?.lang) parts.push('lang=' + encodeURIComponent(opts.lang));
  return `/widgets/${type}/${file}?${parts.join('&')}`;
}
