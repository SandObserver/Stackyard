// @ts-check
/* Keep this file free of imports and of module state. Translation arrives
   through an injected `translate`; a caller that passes none gets English. */
const EN = {
  'status.needsAttention': 'Status: needs attention',
  'status.healthy': 'Status: healthy',
  'status.pending': '{count} pending',
  'status.stale': '(may be out of date)',
  'status.moreValues': '{n} more badge',
  'status.moreValuesPlural': '{n} more badges',
  'status.containerNotFound': 'Container not found',
  'status.containerState': 'Container {state}',
  'status.pingFailed': 'Ping failed: {error}',
  'status.pingReturned': 'Ping returned {status}',
};

/** @param {string} key @param {Record<string, unknown>} [vars] */
function _fallback(key, vars) {
  const s = EN[key] || key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** @typedef {{ name: string, value: number|string, unit: string, color: string }} BadgeRow */

export const NAMED = { blue: '#1e6ef4', green: '#008932', yellow: '#ffcc00', red: '#e9152d', gray: '#636366' };

export const LABEL_DEFAULT_COLOR = '#1e6ef4';

/* A badge list longer than this covers the tile it belongs to. */
export const MAX_LABELS = 5;

const AA_TEXT = 4.5;

/* White unless white fails AA on this fill, even where dark scores higher. */
export function needsDark(hex) {
  try {
    const h = hex.replace(/^#/, '');
    if (h.length !== 6) return false;
    const [r, g, b] = [0, 2, 4].map(i => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return 1.05 / (L + 0.05) < AA_TEXT;
  } catch {
    return false;
  }
}

export function resolveColor(c) {
  return c ? NAMED[c] || c : '';
}

/** A colour safe to hand to CSS, or ''. The fill lands in a custom property,
    which stores any string: `url(...)` there becomes a real request.
    @param {unknown} c @returns {string} */
export function safeColor(c) {
  const v = typeof c === 'string' ? resolveColor(c) : '';
  if (!v) return '';
  const supports = globalThis.CSS?.supports;
  if (typeof supports === 'function') return globalThis.CSS.supports('color', v) ? v : '';
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : '';
}

/* Why a tile is red, as one short line of hover text. */
const REASON_MAX = 90;

const _clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
};

export function healthReason(detail, translate) {
  const tr = typeof translate === 'function' ? translate : (k, v) => _fallback(k, v);
  if (!detail || typeof detail !== 'object') return '';
  const parts = [];

  /* 'unknown' is the server's sentinel for a container it could not find. */
  if (detail.state === 'unknown') {
    parts.push(tr('status.containerNotFound'));
  } else if (detail.state && detail.state !== 'running') {
    /* Untranslated. The text comes from the daemon. */
    parts.push(_clip(detail.status || tr('status.containerState', { state: detail.state }), REASON_MAX));
  } else if (detail.status && /unhealthy/i.test(detail.status)) {
    parts.push(_clip(detail.status, REASON_MAX));
  }

  /* Give the room to the translated words and trim the upstream ones. The error
     text comes from the network layer and is never translated, so clipping the
     composed sentence cuts the half a reader can actually use. */
  if (detail.pingError) {
    const around = tr('status.pingFailed', { error: '' }).length;
    const room = Math.max(8, REASON_MAX - around);
    parts.push(_clip(tr('status.pingFailed', { error: _clip(detail.pingError, room) }), REASON_MAX));
  } else if (detail.pingStatus >= 400) parts.push(tr('status.pingReturned', { status: detail.pingStatus }));

  return parts.join(' \u2022 ');
}

/** What one item's entry in a /api/badges response means for the tile.

    The route reports a per-item failure alongside the others' values, so an item
    that did not answer must not be read as the number zero.

    @param {any} entry @returns {{ value: number|null, failed: boolean }} */
export function readBadgeUpdate(entry) {
  if (!entry || typeof entry !== 'object') return { value: null, failed: true };
  if (entry.kind || entry.error) return { value: null, failed: true };
  const n = Number(entry.value);
  if (!Number.isFinite(n)) return { value: null, failed: true };
  return { value: n, failed: false };
}

/** The count at or above which an activity badge appears. Anything below one,
    missing or unreadable means the original behaviour: any count above zero.
    @param {{ min?: unknown }} [custom] @returns {number} */
export function badgeMinimum(custom) {
  const n = Math.floor(Number(custom?.min));
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/** The labels reaching their own threshold, in priority order. `values` is
    positional: index n is the number for `labels[n]`.

    @param {any[]} [labels] @param {number[]} [values]
    @returns {Array<{ index: number, name: string, value: number, unit: string, color: string }>} */
export function firingLabels(labels, values) {
  if (!Array.isArray(labels) || !Array.isArray(values)) return [];
  const out = [];
  for (let i = 0; i < labels.length && out.length < MAX_LABELS; i++) {
    const l = labels[i];
    if (!l || typeof l.path !== 'string' || !l.path) continue;
    const v = Number(values[i]);
    if (!Number.isFinite(v) || v < badgeMinimum(l)) continue;
    out.push({
      index: i,
      name: String(l.name || l.unit || l.path),
      value: v,
      unit: String(l.unit || ''),
      color: safeColor(l.color) || LABEL_DEFAULT_COLOR,
    });
  }
  return out;
}

/** The badge an item should show, as class, text and background colour.
    @param {{
      health?: boolean, activity?: number,
      custom?: { unit?: string, color?: string, min?: number },
      labels?: any[], values?: number[],
      staticBdg?: { enabled?: boolean, label?: string, color?: string },
      hasHC?: boolean, hideHealthy?: boolean,
      badgesStale?: boolean, healthStale?: boolean, activityStale?: boolean,
      healthDetail?: Record<string, unknown>,
      translate?: (key: string, vars?: Record<string, unknown>) => string,
    }} opts */
export function computeBadgeVisual({
  health,
  activity,
  custom = {},
  labels,
  values,
  staticBdg = {},
  hasHC,
  hideHealthy,
  badgesStale,
  healthStale,
  activityStale,
  healthDetail,
  translate,
}) {
  const tr = typeof translate === 'function' ? translate : (k, v) => _fallback(k, v);
  /* Below this the item is treated as having no activity at all. One keeps the
     original behaviour of badging any count above zero. */
  const min = badgeMinimum(custom);
  const fired = firingLabels(labels, values);
  const top = fired[0];
  const rows = [];
  const active = top ? true : activity >= min;
  const fixed = !!(staticBdg.enabled && staticBdg.label);
  let cls,
    num = '',
    unit = '',
    bg = '';

  if (health) {
    cls = 'badge on red';
    num = '!';
  } else if (top) {
    cls = 'badge on blue';
    num = top.value > 99 ? '99+' : String(top.value);
    unit = top.unit ? top.unit.slice(0, 8) : '';
    bg = top.color;
  } else if (active) {
    cls = 'badge on blue';
    num = activity > 99 ? '99+' : String(activity);
    unit = custom.unit ? custom.unit.slice(0, 8) : '';
    bg = safeColor(custom.color);
  } else if (fixed) {
    cls = 'badge on blue';
    num = staticBdg.label.slice(0, 10);
    bg = safeColor(staticBdg.color);
  } else if (!hideHealthy && hasHC) {
    cls = 'badge on green';
  } else {
    cls = 'badge';
  }
  /* What the badge says, as one string. `num` and `unit` are the same text in
     the two elements the pill draws, so a phone can drop the unit. */
  const txt = num + (unit ? ' ' + unit : '');

  /* Status text, so meaning is not carried by colour alone. */
  let aria = '';
  if (health) aria = tr('status.needsAttention');
  else if (top) aria = top.name ? `${top.name}: ${top.value}` : tr('status.pending', { count: String(top.value) });
  else if (active)
    aria = tr('status.pending', {
      count: (activity > 99 ? '99+' : String(activity)) + (custom.unit ? ' ' + custom.unit : ''),
    });
  else if (fixed) aria = staticBdg.label;
  else if (cls.includes('green')) aria = tr('status.healthy');

  if (
    (active && (badgesStale || activityStale)) ||
    ((health || cls.includes('green')) && (healthStale || activityStale))
  ) {
    cls += ' stale';
    aria = (aria ? aria + ' ' : '') + tr('status.stale');
  }

  /* Appended to the label too, so it is not sight-only. */
  const reason = health ? healthReason(healthDetail, translate) : '';
  if (reason) aria = aria + ': ' + reason;

  /* Only a user's own colour is inked here, and then always. A named badge is
     filled from a token and takes --on-fill, which the empty string leaves in
     place. NAMED does not hold those token values and never decided this. */
  const color = bg ? (needsDark(bg) ? '#1c1c1e' : '#ffffff') : '';

  if (health) rows.push({ name: reason || tr('status.needsAttention'), value: '!', unit: '', color: NAMED.red });
  for (const f of fired) rows.push(f);
  if (fixed) rows.push({ name: staticBdg.label, value: '', unit: '', color: safeColor(staticBdg.color) });

  const more = Math.max(0, rows.length - 1);
  if (more) {
    cls += ' has-more';
    aria = aria + '. ' + tr(more === 1 ? 'status.moreValues' : 'status.moreValuesPlural', { n: more });
  }
  const nextColor = more ? rows[1].color : '';

  return { cls, txt, num, unit, bg, aria, color, title: reason, more, nextColor, rows: more ? rows : [] };
}

/** Identity of a rendered badge, for skipping DOM writes that change nothing.
    Must cover every field computeBadgeVisual returns that reaches the element.
    @param {{ cls?: string, txt?: string, unit?: string, bg?: string, aria?: string,
              color?: string, title?: string, nextColor?: string, rows?: BadgeRow[] }} visual */
export function badgeSignature({
  cls = '',
  txt = '',
  unit = '',
  bg = '',
  aria = '',
  color = '',
  title = '',
  nextColor = '',
  rows = [],
} = {}) {
  /* NUL separator. A plain space lets a class list and a label pack into one
     string two ways and compare equal. */
  const digest = rows.map(r => `${r.name}\u0001${r.value}\u0001${r.unit}\u0001${r.color}`).join('\u0002');
  return [cls, txt, unit, bg, aria, color, title, nextColor, digest].join('\u0000');
}
