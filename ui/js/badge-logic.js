/* Named-color → hex for all badge types */
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

/* Resolve a named color key or raw hex to a hex string */
export function resolveColor(c) { return c ? (NAMED[c] || c) : ''; }

/* Priority: unhealthy (1) > activity (2) > fixed-label (3) > healthy-dot (4).
   Each higher-priority signal overrides lower ones. Pure function: takes the
   badge state and item-derived flags, returns the visual state to apply. */
export function computeBadgeVisual({ health, activity, custom = {}, staticBdg = {}, hasHC, hideHealthy, badgesStale, healthStale }) {
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
  if (health) aria = 'Status: needs attention';
  else if (activity > 0) aria = (activity > 99 ? '99+' : String(activity)) + (custom.unit ? ' ' + custom.unit : '') + ' pending';
  else if (staticBdg.enabled && staticBdg.label) aria = staticBdg.label;
  else if (cls.includes('green')) aria = 'Status: healthy';

  if ((activity > 0 && badgesStale) || ((health || cls.includes('green')) && healthStale)) {
    cls += ' stale';
    aria = (aria ? aria + ' ' : '') + '(may be out of date)';
  }

  /* Auto dark text: WCAG luminance check on the resolved hex. Falls back to
     class-based color (blue/red/green) when bg is empty. */
  const effectiveBg = bg || (cls.includes('red') ? NAMED.red : cls.includes('green') ? NAMED.green : cls.includes('blue') ? NAMED.blue : '');
  const color = effectiveBg && needsDark(effectiveBg) ? '#1c1c1e' : '';

  return { cls, txt, bg, aria, color };
}
