/* Text is translated through an injected `translate`, not by importing the i18n
   module.

   This file is pure: no imports, no module state, which is what lets it be
   tested directly and reused. Importing the loader would tie every caller to it
   and to whatever it has loaded. The dashboard passes `t`; anything that does
   not gets readable English, so a missing translate is a degraded label rather
   than a key on screen.

   These strings were hardcoded English, so a Persian or Chinese user heard
   English status announcements from a screen reader with no way to see the
   visual state instead. */
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

export const NAMED = { blue:'#1e6ef4', green:'#008932', yellow:'#ffcc00', red:'#e9152d', gray:'#636366' };

/* WCAG contrast: use dark text (#1c1c1e) only when it gives higher contrast ratio than white.
   ratioW = 1.05/(L+0.05)  [white on bg]
   ratioD = (L+0.05)/0.0617 [bg on near-black; LD(#1c1c1e)≈0.0117, LD+0.05=0.0617] */
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
  } catch { return false; }
}

export function resolveColor(c) { return c ? (NAMED[c] || c) : ''; }

/* Priority: unhealthy (1) > activity (2) > fixed-label (3) > healthy-dot (4).
   Each higher-priority signal overrides lower ones. Pure function: takes the
   badge state and item-derived flags, returns the visual state to apply. */
/* Why a tile is red, as one short line for its hover text.

   /api/health returns `unhealthy` plus whatever detail explains it: `state` and
   `status` from Docker, `pingStatus` and `pingError` from the URL check. Only
   `unhealthy` was ever used, so a red dot said nothing about the cause. An item
   configured with both checks also lost its container detail on the way out; see
   routes/health.js.

   Docker's own `status` is preferred over `state` because it is the more useful
   of the two: "Exited (1) 2 hours ago" rather than "exited". Both checks failing
   produces both reasons, since either can be the one that matters.

   Long values are truncated: an upstream error can run to hundreds of characters
   and a tooltip that leaves the screen is worse than no tooltip.

   English here, like the aria strings above it. Localising this file is
   fix/localise-dashboard-strings. */
const REASON_MAX = 90;

const _clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
};

export function healthReason(detail, translate) {
  const tr = typeof translate === 'function' ? translate : ((k, v) => _fallback(k, v));
  if (!detail || typeof detail !== 'object') return '';
  const parts = [];

  /* 'running' is the healthy state; only report a container that is not.
     'unknown' is the server's sentinel for a container it could not find at all,
     which is a different problem from one that is stopped. */
  if (detail.state === 'unknown') {
    parts.push(tr('status.containerNotFound'));
  } else if (detail.state && detail.state !== 'running') {
    /* Docker's own status text is passed through untranslated: it comes from the
       daemon, and inventing a translation for "Exited (1) 2 hours ago" would be
       guessing at a string this code does not produce. */
    parts.push(_clip(detail.status || tr('status.containerState', { state: detail.state }), REASON_MAX));
  } else if (detail.status && /unhealthy/i.test(detail.status)) {
    /* Running, but Docker's own healthcheck is failing. */
    parts.push(_clip(detail.status, REASON_MAX));
  }

  if (detail.pingError) parts.push(_clip(tr('status.pingFailed', { error: detail.pingError }), REASON_MAX));
  else if (detail.pingStatus >= 400) parts.push(tr('status.pingReturned', { status: detail.pingStatus }));

  return parts.join(' \u2022 ');
}

export function computeBadgeVisual({ health, activity, custom = {}, staticBdg = {}, hasHC, hideHealthy, badgesStale, healthStale, healthDetail, translate }) {
  const tr = typeof translate === 'function' ? translate : ((k, v) => _fallback(k, v));
  let cls, txt, bg = '';

  if (health) {
    cls = 'badge on red'; txt = '!';

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
    cls = 'badge on green'; txt = '';

  } else {
    cls = 'badge'; txt = '';
  }

  /* Accessible status text so meaning isn't carried by color alone (HIG: don't rely on color) */
  let aria = '';
  if (health) aria = tr('status.needsAttention');
  else if (activity > 0) aria = tr('status.pending', { count: (activity > 99 ? '99+' : String(activity)) + (custom.unit ? ' ' + custom.unit : '') });
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
  const effectiveBg = bg || (cls.includes('red') ? NAMED.red : cls.includes('green') ? NAMED.green : cls.includes('blue') ? NAMED.blue : '');
  const color = effectiveBg && needsDark(effectiveBg) ? '#1c1c1e' : '';

  return { cls, txt, bg, aria, color, title: reason };
}
