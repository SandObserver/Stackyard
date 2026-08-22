// @ts-check
/* Keep this file free of imports and of module state. Translation arrives
   through an injected `translate`; a caller that passes none gets English. */
const EN = {
  'status.needsAttention': 'Status: needs attention',
  'status.healthy': 'Status: healthy',
  'status.pending': '{count} pending',
  'status.stale': '(may be out of date)',
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

export const NAMED = { blue: '#1e6ef4', green: '#008932', yellow: '#ffcc00', red: '#e9152d', gray: '#636366' };

/* WCAG contrast: dark text only where it beats white. */
export function needsDark(hex) {
  try {
    const h = hex.replace(/^#/, '');
    if (h.length !== 6) return false;
    const [r, g, b] = [0, 2, 4].map(i => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return (L + 0.05) / 0.0617 > 1.05 / (L + 0.05);
  } catch {
    return false;
  }
}

export function resolveColor(c) {
  return c ? NAMED[c] || c : '';
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

  if (detail.pingError) parts.push(_clip(tr('status.pingFailed', { error: detail.pingError }), REASON_MAX));
  else if (detail.pingStatus >= 400) parts.push(tr('status.pingReturned', { status: detail.pingStatus }));

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

/** The badge an item should show, as class, text and background colour.
    @param {{
      health?: boolean, activity?: number,
      custom?: { unit?: string, color?: string, min?: number },
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
  const active = activity >= min;
  let cls,
    txt,
    bg = '';

  if (health) {
    cls = 'badge on red';
    txt = '!';
  } else if (active) {
    cls = 'badge on blue';
    txt = activity > 99 ? '99+' : String(activity);
    if (custom.unit) txt += ' ' + custom.unit.slice(0, 8);
    bg = resolveColor(custom.color);
  } else if (staticBdg.enabled && staticBdg.label) {
    cls = 'badge on blue';
    txt = staticBdg.label.slice(0, 10);
    bg = resolveColor(staticBdg.color);
  } else if (!hideHealthy && hasHC) {
    cls = 'badge on green';
    txt = '';
  } else {
    cls = 'badge';
    txt = '';
  }

  /* Status text, so meaning is not carried by colour alone. */
  let aria = '';
  if (health) aria = tr('status.needsAttention');
  else if (active)
    aria = tr('status.pending', {
      count: (activity > 99 ? '99+' : String(activity)) + (custom.unit ? ' ' + custom.unit : ''),
    });
  else if (staticBdg.enabled && staticBdg.label) aria = staticBdg.label;
  else if (cls.includes('green')) aria = tr('status.healthy');

  if (
    (active && (badgesStale || activityStale)) ||
    ((health || cls.includes('green')) && (healthStale || activityStale))
  ) {
    cls += ' stale';
    aria = (aria ? aria + ' ' : '') + tr('status.stale');
  }

  /* Appended to the label too, so it is not sight-only. */
  const reason = health ? healthReason(healthDetail) : '';
  if (reason) aria = aria + ': ' + reason;

  /* Only a user's own colour is inked here, and then always. A named badge is
     filled from a token and takes --on-fill, which the empty string leaves in
     place. NAMED does not hold those token values and never decided this. */
  const color = bg ? (needsDark(bg) ? '#1c1c1e' : '#ffffff') : '';

  return { cls, txt, bg, aria, color, title: reason };
}

/** Identity of a rendered badge, for skipping DOM writes that change nothing.
    Must cover every field computeBadgeVisual returns that reaches the element.
    @param {{ cls?: string, txt?: string, bg?: string, aria?: string, color?: string, title?: string }} visual */
export function badgeSignature({ cls = '', txt = '', bg = '', aria = '', color = '', title = '' } = {}) {
  /* NUL separator. A plain space lets a class list and a label pack into one
     string two ways and compare equal. */
  return [cls, txt, bg, aria, color, title].join('\u0000');
}
