// @ts-check
/* Translated through an injected `translate` rather than by importing i18n: this
   file has no imports and no module state, which is what lets it be tested
   directly. A caller that passes none gets readable English. */
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

/* WCAG contrast: dark text only where it beats white.
   ratioW = 1.05/(L+0.05), ratioD = (L+0.05)/0.0617 for #1c1c1e. */
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

/* Priority: unhealthy > activity > fixed-label > healthy-dot. */
/* Why a tile is red, as one short line of hover text. Docker's `status` is
   preferred over `state` because "Exited (1) 2 hours ago" says more than
   "exited", and both checks failing produces both reasons. Long values are
   truncated: a tooltip that runs off the screen is worse than none. */
const REASON_MAX = 90;

const _clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
};

export function healthReason(detail, translate) {
  const tr = typeof translate === 'function' ? translate : (k, v) => _fallback(k, v);
  if (!detail || typeof detail !== 'object') return '';
  const parts = [];

  /* 'unknown' is the server's sentinel for a container it could not find, which
     is a different problem from one that is stopped. */
  if (detail.state === 'unknown') {
    parts.push(tr('status.containerNotFound'));
  } else if (detail.state && detail.state !== 'running') {
    /* Passed through untranslated: the text comes from the daemon. */
    parts.push(_clip(detail.status || tr('status.containerState', { state: detail.state }), REASON_MAX));
  } else if (detail.status && /unhealthy/i.test(detail.status)) {
    /* Running, but Docker's own healthcheck is failing. */
    parts.push(_clip(detail.status, REASON_MAX));
  }

  if (detail.pingError) parts.push(_clip(tr('status.pingFailed', { error: detail.pingError }), REASON_MAX));
  else if (detail.pingStatus >= 400) parts.push(tr('status.pingReturned', { status: detail.pingStatus }));

  return parts.join(' \u2022 ');
}

/** The badge an item should show, as class, text and background colour.
    @param {{
      health?: boolean, activity?: number,
      custom?: { unit?: string, color?: string },
      staticBdg?: { enabled?: boolean, label?: string, color?: string },
      hasHC?: boolean, hideHealthy?: boolean,
      badgesStale?: boolean, healthStale?: boolean,
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
  healthDetail,
  translate,
}) {
  const tr = typeof translate === 'function' ? translate : (k, v) => _fallback(k, v);
  let cls,
    txt,
    bg = '';

  if (health) {
    cls = 'badge on red';
    txt = '!';
  } else if (activity > 0) {
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

  /* Accessible status text so meaning isn't carried by color alone (HIG: don't rely on color) */
  let aria = '';
  if (health) aria = tr('status.needsAttention');
  else if (activity > 0)
    aria = tr('status.pending', {
      count: (activity > 99 ? '99+' : String(activity)) + (custom.unit ? ' ' + custom.unit : ''),
    });
  else if (staticBdg.enabled && staticBdg.label) aria = staticBdg.label;
  else if (cls.includes('green')) aria = tr('status.healthy');

  if ((activity > 0 && badgesStale) || ((health || cls.includes('green')) && healthStale)) {
    cls += ' stale';
    aria = (aria ? aria + ' ' : '') + tr('status.stale');
  }

  /* Hover text, and appended to the label so it is not sight-only. Only when
     something is actually wrong: a tooltip on a healthy tile is noise. */
  const reason = health ? healthReason(healthDetail) : '';
  if (reason) aria = aria + ': ' + reason;

  /* Auto dark text: WCAG luminance check on the resolved hex. Falls back to
     class-based color (blue/red/green) when bg is empty. */
  const effectiveBg =
    bg ||
    (cls.includes('red') ? NAMED.red : cls.includes('green') ? NAMED.green : cls.includes('blue') ? NAMED.blue : '');
  const color = effectiveBg && needsDark(effectiveBg) ? '#1c1c1e' : '';

  return { cls, txt, bg, aria, color, title: reason };
}
