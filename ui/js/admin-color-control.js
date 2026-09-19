import { PE_SVG, initInlineEdit, toast, reveal } from '/js/admin-shared.js?v=68fb1cb2';
import { t } from '/js/i18n.js?v=1f1ea9c1';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { qa, q } from '/js/utils.js?v=18f28539';
import { iconSvg } from '/js/icon-set.js?v=606a68c6';
import { HUE_NAMES, ROLE_NAMES, TILE_KEYWORDS, pageTheme, tileColor } from '/js/palette.js?v=918226d2';

const CC_SWATCHES = ['#1c1c1e', '#8e8e93', '#f2f2f7', '#ff393c', '#ffcd00', '#35c759', '#0289ff', '#cb30df'];
export const BADGE_DEFAULT = 'info';
const _ccIco = {
  hueLo: iconSvg('hue-lo', 16),
  hueHi: iconSvg('hue-hi', 16),
  satLo: iconSvg('sat-lo', 16),
  satHi: iconSvg('sat-hi', 16),
  brLo: iconSvg('bright-lo', 16),
  brHi: iconSvg('bright-hi', 16),
};
/* Normalise the hue before computing `x`. A negative hue otherwise mixes a
   wrapped sextant with an unwrapped `x` and yields a negative channel.

   @param {number} h 0..360 @param {number} s 0..100 @param {number} v 0..100
   @returns {[number, number, number]} each 0..255 */
function _hsvToRgb(h, s, v) {
  h %= 360;
  if (h < 0) h += 360;
  s /= 100;
  v /= 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function _hsvToHex(h, s, v) {
  return (
    '#' +
    _hsvToRgb(h, s, v)
      .map(n => n.toString(16).padStart(2, '0'))
      .join('')
  );
}
/* Any CSS colour to lowercase #rrggbb, or null. Callers compare these strings,
   so the case must stay stable. */
const _HEX6 = /^#[0-9a-f]{6}$/i;
/* An invalid assignment to fillStyle leaves the previous value, so a single
   read cannot tell "black" from "not a colour". Two seeds can: only an
   assignment that took effect makes both reads agree. */
function _cssParse(str) {
  const c = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
  const read = seed => {
    c.fillStyle = seed;
    c.fillStyle = str;
    return String(c.fillStyle);
  };
  const first = read('#000000');
  return first === read('#ffffff') ? first : null;
}
function _cssToHex(str) {
  const direct = String(str ?? '').trim();
  if (_HEX6.test(direct)) return direct.toLowerCase();
  try {
    const v = _cssParse(str);
    if (v === null) return null;
    if (_HEX6.test(v)) return v.toLowerCase();
    const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    return m ? '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('') : null;
  } catch {
    return null;
  }
}

const _BARE_HEX = /^[0-9a-f]{3,8}$/i;
/** A typed colour, with a missing leading hash supplied.
    @param {string} str
    @returns {{ value: string, ok: boolean }} */
export function normalizeColorInput(str) {
  const v = String(str ?? '').trim();
  if (!v) return { value: '', ok: false };
  if (_cssToHex(v)) return { value: v, ok: true };
  if (_BARE_HEX.test(v) && _cssToHex('#' + v)) return { value: '#' + v, ok: true };
  return { value: v, ok: false };
}
function _hexToHsv(hex) {
  const h6 = _cssToHex(hex);
  if (!h6) return null;
  const r = parseInt(h6.slice(1, 3), 16) / 255,
    g = parseInt(h6.slice(3, 5), 16) / 255,
    b = parseInt(h6.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(mx ? (d / mx) * 100 : 0), v: Math.round(mx * 100) };
}

export const _internals = { cssToHex: _cssToHex, hsvToRgb: _hsvToRgb, hexToHsv: _hexToHsv };

const COLOR_KEYS = {
  dark: 'color.dark',
  light: 'color.light',
  auto: 'color.auto',
  clear: 'color.clear',
  accent: 'color.accent',
  success: 'color.success',
  warning: 'color.warning',
  danger: 'color.danger',
  info: 'color.info',
  red: 'color.red',
  orange: 'color.orange',
  yellow: 'color.yellow',
  green: 'color.green',
  mint: 'color.mint',
  teal: 'color.teal',
  cyan: 'color.cyan',
  blue: 'color.blue',
  indigo: 'color.indigo',
  purple: 'color.purple',
  pink: 'color.pink',
  brown: 'color.brown',
  gray: 'color.gray',
};

/** @param {string} v */
const _swatchFill = v => tileColor(v, pageTheme());

/** @param {HTMLElement} container
    @param {{ value?: string, idPrefix?: string,
              onChange?: (value: string) => void, variant?: 'tile'|'badge',
              swatchColors?: string[], label?: string }} [opts] */
export function renderColorControl(
  container,
  { value = '#0289ff', idPrefix, onChange, variant, swatchColors = CC_SWATCHES, label = 'Color' } = {},
) {
  const top = variant === 'tile' ? TILE_KEYWORDS : variant === 'badge' ? ROLE_NAMES : [];
  const hues = variant ? HUE_NAMES : [];
  const isKw = v => typeof v === 'string' && (top.includes(v) || hues.includes(v));
  const kwName = v => t(COLOR_KEYS[v]);
  const init = _hexToHsv(isKw(value) ? _swatchFill(value) || '#0289ff' : value) || { h: 212, s: 99, v: 100 };
  const kwSwatch = v =>
    html`<button type="button" class="cc-swatch cc-kw cc-kw-${v}" data-v="${v}" title="${kwName(v)}" aria-label="${kwName(v)}"></button>`;
  const swatch = h => html`<button type="button" class="cc-swatch" data-v="${h}" aria-label="${h}"></button>`;
  const rainbow = html`<button type="button" class="cc-swatch cc-rainbow" data-v="custom" aria-label="${t('appearance.customColor')}"></button>`;
  const swatches = variant ? html`${top.map(kwSwatch)}${rainbow}` : html`${rainbow}${swatchColors.map(swatch)}`;
  const wrap = document.createElement('div');
  const slider = (label, cls, id, max, val, lo, hi) => html`
    <div class="row hsb-row"><span class="rl">${label}</span><div class="hsb-track"><span class="hsb-ico">${raw(lo)}</span><input type="range" class="${cls}" id="${id}" min="0" max="${max}" value="${val}" aria-label="${label}"><span class="hsb-ico">${raw(hi)}</span></div></div>`;
  const hueRow = hues.length
    ? html`<div class="row cc-row cc-hues"><span class="rl">${t('color.system')}</span><div class="cc-sw">${hues.map(kwSwatch)}</div></div>`
    : '';
  setHtml(
    wrap,
    html`
    <div class="row cc-row"><span class="rl">${label}</span><div class="cc-sw">${swatches}</div></div>
    <div class="row-wrap reveal cc-tune"><div class="reveal-in">
    ${hueRow}
    ${slider('Hue', 'hsb-range hsb-hue', `${idPrefix}-h`, 360, init.h, _ccIco.hueLo, _ccIco.hueHi)}
    ${slider('Saturation', 'hsb-range', `${idPrefix}-s`, 100, init.s, _ccIco.satLo, _ccIco.satHi)}
    ${slider('Brightness', 'hsb-range', `${idPrefix}-v`, 100, init.v, _ccIco.brLo, _ccIco.brHi)}
    <div class="row ie-row" id="${idPrefix}-code-row"><span class="rl">${t('appearance.colorCode')}</span><span class="rv is-ph">#rrggbb or any CSS color</span><input id="${idPrefix}-hex" type="text" class="d-none"><button class="pe" type="button">${raw(PE_SVG)}</button></div>
    </div></div>`,
  );
  /* The markup carries no style attribute, so the page keeps style-src without
     'unsafe-inline'. A swatch paints itself from its own value. */
  for (const b of wrap.querySelectorAll('.cc-swatch[data-v]')) {
    const v = b.getAttribute('data-v') || '';
    const fill = v[0] === '#' ? v : v === 'auto' || v === 'clear' ? '' : _swatchFill(v);
    if (fill) /** @type {HTMLElement} */ (b).style.background = fill;
  }
  const rows = /** @type {HTMLElement[]} */ ([...wrap.children]);
  rows.forEach(r => container.appendChild(r));
  const qLocal = sel => /** @type {HTMLInputElement} */ (container.querySelector(sel));
  const hEl = qLocal(`#${idPrefix}-h`),
    sEl = qLocal(`#${idPrefix}-s`),
    vEl = qLocal(`#${idPrefix}-v`);
  const codeRv = qLocal(`#${idPrefix}-code-row .rv`);
  const tune = rows.find(r => r.classList.contains('cc-tune'));
  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.id = `${idPrefix}-val`;
  container.appendChild(hidden);
  let mode = isKw(value) ? value : 'color';
  let showTune = hues.includes(mode);
  /* The first paint restores stored state, so it must not animate. */
  let _painted = false;
  /* The value as it was stored. The sliders are integers, so reading a colour
     back out of them shifts it, and an untouched control would save a colour
     nobody picked. Cleared the moment the user changes anything. */
  let pristine = mode === 'color' ? value : null;
  const curHex = () => _hsvToHex(+hEl.value, +sEl.value, +vEl.value);
  const _rgb = h => {
    const x = _cssToHex(h);
    return x ? [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)] : null;
  };
  const _near = (a, b) => {
    const ra = _rgb(a),
      rb = _rgb(b);
    return ra && rb && ra.every((n, i) => Math.abs(n - rb[i]) <= 3);
  };
  const setSliders = hex => {
    const hv = _hexToHsv(hex);
    if (!hv) return;
    hEl.value = String(hv.h);
    sEl.value = String(hv.s);
    vEl.value = String(hv.v);
  };
  function paint() {
    const h = +hEl.value,
      v = +vEl.value,
      hex = curHex();
    /* backgroundImage, never the background shorthand. The shorthand resets
       background-clip, which is what keeps the track thin inside the 44px touch
       target on a phone. */
    sEl.style.backgroundImage = `linear-gradient(var(--slider-dir), ${_hsvToHex(h, 0, v)}, ${_hsvToHex(h, 100, v)})`;
    vEl.style.backgroundImage = `linear-gradient(var(--slider-dir), #000, ${_hsvToHex(h, 100, 100)})`;
    /* Each knob previews what its own slider is set to: the hue on its own, the
       resulting colour for the other two. */
    hEl.style.setProperty('--knob-fill', _hsvToHex(h, 100, 100));
    sEl.style.setProperty('--knob-fill', hex);
    vEl.style.setProperty('--knob-fill', hex);
    qa('.cc-swatch', container).forEach(b => {
      let on = false;
      if (mode !== 'color') on = b.dataset.v === mode;
      else if (!showTune) on = b.dataset.v !== 'custom' && !b.classList.contains('cc-kw') && _near(b.dataset.v, hex);
      b.classList.toggle('on', on);
    });
    const rb = q('.cc-rainbow', container);
    if (rb) rb.classList.toggle('on', showTune && (mode === 'color' || hues.includes(mode)));
    reveal(tune, showTune, !_painted);
    if (!codeRv.closest('.editing')) {
      codeRv.textContent = mode === 'color' ? hex : kwName(mode);
      codeRv.classList.remove('is-ph');
    }
    hidden.value = mode === 'color' ? (pristine ?? hex) : mode;
    _painted = true;
  }
  const commit = () => {
    pristine = null;
    paint();
    onChange?.(hidden.value);
  };
  [hEl, sEl, vEl].forEach(el =>
    el.addEventListener('input', () => {
      mode = 'color';
      showTune = true;
      commit();
    }),
  );
  qa('.cc-swatch', container).forEach(b =>
    b.addEventListener('click', () => {
      const v = b.dataset.v || '';
      if (v === 'custom') {
        showTune = !(showTune && mode === 'color');
        if (showTune && !hues.includes(mode)) mode = 'color';
        commit();
        return;
      }
      if (isKw(v)) {
        mode = v;
        showTune = hues.includes(v);
        if (showTune) setSliders(_swatchFill(v));
        commit();
        return;
      }
      mode = 'color';
      showTune = false;
      setSliders(v);
      commit();
    }),
  );
  initInlineEdit(`${idPrefix}-code-row`, `${idPrefix}-hex`, {
    root: container,
    placeholder: '#rrggbb or any CSS color',
    onCommit(val) {
      const { value, ok } = normalizeColorInput(val);
      const hv = ok ? _hexToHsv(value) : null;
      if (hv) {
        mode = 'color';
        showTune = true;
        setSliders(value);
      } else if (val) toast(t('toast.colorInvalid'), 'err');
      commit();
    },
  });
  if (mode === 'color') {
    const presets = qa('.cc-swatch', container)
      .filter(b => b.dataset.v !== 'custom' && !b.classList.contains('cc-kw'))
      .map(b => b.dataset.v);
    showTune = !presets.some(pv => _near(pv, value));
  }
  paint();
  return { getValue: () => hidden.value };
}
