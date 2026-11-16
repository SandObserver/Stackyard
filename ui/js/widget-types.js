// @ts-check
import { DEFAULT_WIDGET_SIZE } from '/js/limits.js?v=ff61256e';

/* Layout geometry, keyed by widget family size, never by widget. */
export const WIDGET_HEIGHTS = { small: 150, medium: 150, large: 330, xlarge: 510 };
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

/* The iframe URL, from the manifest entry in `reg`. The cache version is hashed
   from file content at release, never maintained by hand. */
/* A `card` inside the selected view wins over the manifest's top-level one. */
const CARD_PRESETS = ['dark', 'graphite', 'light', 'translucent'];

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

export function showIfMatches(cond, current) {
  if (Array.isArray(cond.in)) return cond.in.map(String).includes(String(current));
  if (typeof current === 'boolean') return current === !!cond.equals;
  return String(current) === String(cond.equals);
}

/* Follow showIf chains. A hidden controller still holds a value underneath, and
   its dependants would show themselves against it.

   Resolve each field by its position. Two fields may share a key, one per
   branch of a showIf, and resolving by key gives both the same answer: the
   wrong branch is shown, or both branches are hidden. */
export function visibleFieldFlags(fields, readValue) {
  const idxsByKey = new Map();
  fields.forEach((f, i) => {
    if (!f || f.key == null) return;
    const at = idxsByKey.get(f.key);
    if (at) at.push(i);
    else idxsByKey.set(f.key, [i]);
  });
  const memo = new Map();
  const isShown = i => {
    if (memo.has(i)) return memo.get(i);
    memo.set(i, false); /* guard against a cycle in malformed manifests */
    const f = fields[i];
    let ok = true;
    if (f && f.showIf) {
      const dep = f.showIf.field;
      const depIdxs = idxsByKey.get(dep);
      ok = depIdxs
        ? depIdxs.some(j => isShown(j)) && showIfMatches(f.showIf, readValue(dep))
        : showIfMatches(f.showIf, readValue(dep));
    }
    memo.set(i, ok);
    return ok;
  };
  return fields.map((f, i) => (f && f.key != null ? isShown(i) : false));
}

/** @param {any} item @param {any} reg @returns {string|null} */
export function overlayHref(item, reg) {
  if (item?.url || item?.href) return item.url || item.href;
  const fields = item?.widgetType ? reg?.[item.widgetType]?.fields : null;
  if (!Array.isArray(fields)) return null;
  const wc = item.widgetConfig && typeof item.widgetConfig === 'object' ? item.widgetConfig : {};
  /** @param {string} key */
  const readValue = key => {
    if (wc[key] != null) return wc[key];
    const declared = fields.filter(f => f && f.key === key);
    const withDefault = declared.find(f => f.default != null);
    if (withDefault) return withDefault.default;
    return declared.find(f => Array.isArray(f.options) && f.options.length)?.options[0].value;
  };
  const shown = visibleFieldFlags(fields, readValue);
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!shown[i] || f.link !== true) continue;
    const value = wc[f.key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

export function fixedAppearance(item, reg) {
  const entry = item?.widgetType ? reg?.[item.widgetType] : null;
  return entry?.appearance === 'dark' ? 'dark' : '';
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
  parts.push('size=' + encodeURIComponent(item?.widgetSize || DEFAULT_WIDGET_SIZE));
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
