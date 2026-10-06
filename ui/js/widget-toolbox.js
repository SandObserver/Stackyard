/* Optional toolbox for widget authors: data access, self-contained visuals and
   a fetch/render loop. */

import { esc, html, setHtml } from '/js/html.js?v=c71f8903';
import { isSafeLinkUrl } from '/js/link-url.js?v=54adb40f';
import { jitter } from '/js/jitter.js?v=087a1fcf';
import { errorState as _errorState, errorKind, errorCopy } from '/js/widget-error.js?v=7da9754b';
import { setNumberLanguage } from '/js/format-number.js?v=349a741d';

export { esc, html, setHtml };

/* Escaping cannot make a CSS value safe. `red; background-image: url(...)`
   survives esc() and still parses as a second declaration. Assign the result
   through a specific CSSOM property, never a concatenated style string. */
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;
export function colorOrFallback(value, fallback) {
  return COLOR_RE.test(String(value ?? '').trim()) ? String(value).trim() : fallback;
}

/* widget-theme.js sets the attribute before the first paint. */
const _hostTheme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

const _lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** @param {number[]} c */
const _lum = c => 0.2126 * _lin(c[0] / 255) + 0.7152 * _lin(c[1] / 255) + 0.0722 * _lin(c[2] / 255);

/** Darkens a colour only as far as 4.5:1 on white needs. Returns it unchanged on the dark theme.
    @param {string} hex #rrggbb @param {number} [min] */
export function readableInk(hex, min = 4.5) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m || _hostTheme() !== 'light') return hex;
  let rgb = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  for (let k = 0; k < 40 && 1.05 / (_lum(rgb) + 0.05) < min; k++) rgb = rgb.map(v => v * 0.95);
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** @param {unknown} value @returns {number[] | null} */
function _rgbOf(value) {
  const s = String(value ?? '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map(c => parseInt(c + c, 16));
  m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s);
  return m ? m.slice(1, 4).map(v => Math.min(255, Number(v))) : null;
}

const _cardLum = () => (_hostTheme() === 'light' ? 1 : _lum([28, 28, 30]));

/** Contrast of a colour against the card, as a ratio. NaN when it cannot be read.
    @param {string} colour @returns {number} */
export function cardContrast(colour) {
  const rgb = _rgbOf(colour);
  if (!rgb) return NaN;
  const a = _lum(rgb) + 0.05;
  const b = _cardLum() + 0.05;
  return Math.max(a, b) / Math.min(a, b);
}

/** Moves a colour toward black on the light card or toward white on the dark
    one, only as far as min:1 against that card needs. For text: a fill keeps
    the colour the user picked.
    @param {string} colour hex or rgb() @param {number} [min] @returns {string} #rrggbb, or the input when unreadable */
export function contrastInk(colour, min = 4.5) {
  let rgb = _rgbOf(colour);
  if (!rgb) return colour;
  const light = _hostTheme() === 'light';
  const card = _cardLum() + 0.05;
  const ratio = c => (light ? card / (_lum(c) + 0.05) : (_lum(c) + 0.05) / card);
  for (let k = 0; k < 40 && ratio(rgb) < min; k++) rgb = rgb.map(v => (light ? v * 0.95 : v + (255 - v) * 0.08));
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function theme() {
  return _hostTheme();
}

const NS = 'http://www.w3.org/2000/svg';
const _params = new URLSearchParams(location.search);

/** Gives the card the dark card's edge and border while the widget paints its own dark background.
    @param {boolean} dark */
export function setCardAppearance(dark) {
  const card = /** @type {HTMLElement | null | undefined} */ (
    window.frameElement?.closest('.widget, .mob-widget-card')
  );
  if (!card) return;
  if (dark) card.dataset.appearance = 'dark';
  else delete card.dataset.appearance;
}

export function widgetId() {
  return _params.get('id') || '';
}

export async function fetchData(endpoint, opts = {}) {
  const id = widgetId();
  const p = new URLSearchParams();
  if (endpoint) p.set('endpoint', endpoint);
  for (const [k, v] of Object.entries(opts.params || {})) p.set(k, String(v));
  const query = p.toString();
  const qs = query ? '?' + query : '';
  const r = await fetch(`/api/widget-data/${encodeURIComponent(id)}${qs}`, { cache: 'no-store', signal: opts.signal });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const e = /** @type {Error & { status?: number, kind?: string }} */ (new Error(d.error || 'HTTP ' + r.status));
    e.status = r.status;
    if (typeof d.kind === 'string') e.kind = d.kind;
    throw e;
  }
  return r.json();
}

export function openUrl(href) {
  if (!href) return;
  /* A javascript: or data: URL clicked from a widget runs in the dashboard's
     origin, and widget config can arrive by import. */
  if (!isSafeLinkUrl(href)) return;
  try {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

const _links = new WeakMap();

/** Make `el` a link to `href` for mouse and keyboard: role link, a tab stop,
    click and Enter. Call again to change the link; an empty or unsafe `href`
    removes it and restores the element's own role. Keep buttons and other
    controls out of `el`: a link must not contain them.
    @param {HTMLElement} el @param {string} href @returns {boolean} whether `el` is now a link */
export function linkTo(el, href) {
  const on = !!href && isSafeLinkUrl(href);
  let link = _links.get(el);
  if (!link) {
    if (!on) return false;
    link = { href: '', role: el.getAttribute('role') };
    _links.set(el, link);
    el.addEventListener('click', () => {
      if (link.href) openUrl(link.href);
    });
    el.addEventListener('keydown', e => {
      if (!link.href || e.key !== 'Enter' || e.target !== el) return;
      e.preventDefault();
      openUrl(link.href);
    });
  }
  link.href = on ? href : '';
  el.classList.toggle('clickable', on);
  if (on) {
    el.setAttribute('role', 'link');
    el.tabIndex = 0;
  } else {
    if (link.role) el.setAttribute('role', link.role);
    else el.removeAttribute('role');
    el.removeAttribute('tabindex');
  }
  return on;
}

export async function getConfig() {
  const id = widgetId();
  const r = await fetch(`/api/widget-config/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!r.ok) {
    const e = /** @type {Error & { status?: number }} */ (new Error('config HTTP ' + r.status));
    e.status = r.status;
    throw e;
  }
  return r.json();
}

const _r = n => Math.round(n * 100) / 100;

/* points: [[x,y], ...] */
export function smoothPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M${_r(points[0][0])},${_r(points[0][1])}`;
  const t = 0.35;
  let d = `M${_r(points[0][0])},${_r(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i],
      p1 = points[i],
      p2 = points[i + 1],
      p3 = points[i + 2] || points[i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) * t,
      cp1y = p1[1] + (p2[1] - p0[1]) * t;
    const cp2x = p2[0] - (p3[0] - p1[0]) * t,
      cp2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${_r(cp1x)},${_r(cp1y)} ${_r(cp2x)},${_r(cp2y)} ${_r(p2[0])},${_r(p2[1])}`;
  }
  return d;
}

/* opts: { width=200, height=60, color='#0a84ff', fillOpacity=0.22,
           lineWidth=1.5, smooth=true, max=auto*1.2, gradientId } */
export function sparkline(values, opts = {}) {
  const W = opts.width || 200,
    H = opts.height || 60;
  const color = opts.color || '#0a84ff';
  const lineWidth = opts.lineWidth != null ? opts.lineWidth : 1.5;
  const fillOpacity = opts.fillOpacity != null ? opts.fillOpacity : 0.22;
  const smooth = opts.smooth !== false;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.display = 'block';
  svg.style.overflow = 'visible';

  const data = Array.isArray(values) ? values.filter(v => typeof v === 'number') : [];
  if (data.length < 2) return svg;

  const dataMax = Math.max(...data, 1);
  const yMax = opts.max != null ? opts.max : dataMax * 1.2;
  const len = data.length;
  const xOf = i => (i / (len - 1)) * W;
  const yOf = v => H - (v / yMax) * H;
  const pts = data.map((v, i) => [xOf(i), yOf(v)]);
  const linePathStr = smooth ? smoothPath(pts) : 'M' + pts.map(p => `${_r(p[0])},${_r(p[1])}`).join(' L');
  const areaPathStr = linePathStr + ` L${_r(xOf(len - 1))},${H} L${_r(xOf(0))},${H} Z`;

  const gid = opts.gradientId || 'sl_' + Math.random().toString(36).slice(2, 9);
  const defs = document.createElementNS(NS, 'defs');
  const grad = document.createElementNS(NS, 'linearGradient');
  grad.setAttribute('id', gid);
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '0');
  grad.setAttribute('y2', '1');
  const g0 = document.createElementNS(NS, 'stop');
  g0.setAttribute('offset', '0%');
  g0.setAttribute('stop-color', color);
  g0.setAttribute('stop-opacity', String(fillOpacity));
  const g1 = document.createElementNS(NS, 'stop');
  g1.setAttribute('offset', '100%');
  g1.setAttribute('stop-color', color);
  g1.setAttribute('stop-opacity', '0');
  grad.append(g0, g1);
  defs.appendChild(grad);
  svg.appendChild(defs);

  const area = document.createElementNS(NS, 'path');
  area.setAttribute('d', areaPathStr);
  area.setAttribute('fill', `url(#${gid})`);
  svg.appendChild(area);

  const line = document.createElementNS(NS, 'path');
  line.setAttribute('d', linePathStr);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', String(lineWidth));
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);

  return svg;
}

/* A widget page loads no shared stylesheet, so a reduced-motion rule cannot
   reach a style set here. Ask for the preference instead. */
function reducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/* opts: { color='#0a84ff', track='rgba(255,255,255,0.10)', height=6, radius=3 }
   track: null paints no track, so the page styles .tb-bar per theme. */
export function barFill(percent, opts = {}) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const h = opts.height != null ? opts.height : 6;
  const radius = opts.radius != null ? opts.radius : 3;
  const track = document.createElement('div');
  track.className = 'tb-bar';
  track.style.cssText = `position:relative;width:100%;height:${h}px;border-radius:${radius}px;overflow:hidden`;
  if (opts.track !== null) track.style.backgroundColor = opts.track || 'rgba(255,255,255,0.10)';
  const fill = document.createElement('div');
  fill.className = 'tb-bar-fill';
  fill.style.cssText =
    `position:absolute;left:0;top:0;bottom:0;width:${pct}%;border-radius:${radius}px` +
    (reducedMotion() ? '' : ';transition:width .4s ease');
  fill.style.backgroundColor = colorOrFallback(opts.color, '#0a84ff');
  track.appendChild(fill);
  return track;
}

/** Rounded columns, newest on the right, for a short history at a glance.
    Built once; update() moves heights only, so a poll never rebuilds the DOM.
    track: null paints no track, so the page styles .tb-col per theme.

    @param {{ count?: number, color?: string, track?: string | null, gap?: number, radius?: number }} [opts]
    @returns {{ el: HTMLElement, update: (values: unknown[], scale?: { min?: number, max?: number, dim?: (v: number) => boolean }) => void, indexAt: (clientX: number) => number, mark: (index: number | null) => void }} */
export function columns(opts = {}) {
  const count = Math.max(1, Math.floor(Number(opts.count) || 24));
  const radius = opts.radius != null ? opts.radius : 3;
  const color = colorOrFallback(opts.color, '#0a84ff');
  const el = document.createElement('div');
  el.className = 'tb-cols';
  el.style.cssText = `display:flex;align-items:stretch;height:100%;gap:${opts.gap != null ? opts.gap : 3}px`;
  /** @type {HTMLElement[]} */
  const fills = [];
  /** @type {HTMLElement[]} */
  const cols = [];
  /** @type {HTMLElement | null} */
  let marker = null;
  for (let i = 0; i < count; i++) {
    const col = document.createElement('div');
    col.className = 'tb-col';
    col.style.cssText = `flex:1 1 0;position:relative;overflow:hidden;border-radius:${radius}px`;
    if (opts.track !== null) col.style.backgroundColor = opts.track || 'rgba(255,255,255,0.10)';
    const fill = document.createElement('div');
    fill.className = 'tb-col-fill';
    fill.style.cssText = `position:absolute;left:0;right:0;bottom:0;height:0;border-radius:${radius}px`;
    fill.style.backgroundColor = color;
    col.appendChild(fill);
    el.appendChild(col);
    cols.push(col);
    fills.push(fill);
  }
  return {
    el,
    update(values, scale = {}) {
      const list = Array.isArray(values) ? values.slice(-count) : [];
      const offset = count - list.length;
      const min = Number.isFinite(scale.min) ? Number(scale.min) : 0;
      const max = Number.isFinite(scale.max) && Number(scale.max) > min ? Number(scale.max) : min + 100;
      for (let i = 0; i < count; i++) {
        const v = i < offset ? null : list[i - offset];
        const fill = fills[i];
        /* Keep the sliver. Without it a zero reading looks like a missing one. */
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          fill.style.height = '0';
          fill.style.opacity = '';
          continue;
        }
        const share = Math.max(0, Math.min(1, (v - min) / (max - min)));
        fill.style.height = `max(2px, ${(share * 100).toFixed(2)}%)`;
        fill.style.opacity = scale.dim && scale.dim(v) ? '0.45' : '';
      }
    },
    /** The column under a pointer, so the whole plot is the hit target.
        @param {number} clientX @returns {number} */
    indexAt(clientX) {
      const box = el.getBoundingClientRect();
      const share = box.width > 0 ? (clientX - box.left) / box.width : 1;
      return Math.max(0, Math.min(count - 1, Math.floor(share * count)));
    },
    /** A thin marker on one column, or none. track: null leaves its colour to
        the page as .tb-col-mark.
        @param {number | null} index */
    mark(index) {
      if (index === null || !Number.isInteger(index) || index < 0 || index >= count) {
        marker?.remove();
        return;
      }
      if (!marker) {
        marker = document.createElement('div');
        marker.className = 'tb-col-mark';
        marker.style.cssText =
          'position:absolute;top:0;bottom:0;left:50%;width:2px;border-radius:1px;transform:translateX(-50%)';
        if (opts.track !== null) marker.style.backgroundColor = 'rgba(255,255,255,0.9)';
      }
      cols[index].appendChild(marker);
    },
  };
}

/* A widget is an iframe and does not load the i18n module. The language arrives
   on the iframe URL. */
const _lang = new URLSearchParams(location.search).get('lang') || 'en';
setNumberLanguage(_lang);
let _strings = null;

async function _loadStrings() {
  if (_lang === 'en') return;
  try {
    const r = await fetch(`/i18n/${encodeURIComponent(_lang)}.json`, { cache: 'no-cache' });
    if (r.ok) _strings = (await r.json())?.widget || null;
  } catch {
    /* English is a usable answer */
  }
}
_loadStrings();

/** @param {string} key @param {string} fallback */
function _t(key, fallback) {
  return (_strings && _strings[key]) || fallback;
}

/* A widget's own strings live in its folder, beside its manifest. English is the
   source: its catalog is not fetched, and an untranslated key renders the
   fallback the caller passed. */
const _widgetName = (String(location.pathname || '').match(/\/widgets\/([^/]+)\//) || [])[1] || '';
let _own = null;

/** Load this widget's catalog. Await it before the first render, or early
    strings paint in English and change under the reader.

    @returns {Promise<void>} */
export async function loadStrings() {
  if (!_widgetName || _lang === 'en' || _own) return;
  try {
    const r = await fetch(`/widgets/${encodeURIComponent(_widgetName)}/i18n/${encodeURIComponent(_lang)}.json`, {
      cache: 'no-cache',
    });
    if (r.ok) {
      const parsed = await r.json();
      if (parsed && typeof parsed === 'object') _own = parsed;
    }
  } catch {
    /* English is a usable answer */
  }
}

/** @param {string} key @param {string} fallback @returns {string} */
export function wt(key, fallback) {
  const v = _own && _own[key];
  return typeof v === 'string' && v ? v : fallback;
}

/** @param {number} ts @returns {string} */
/* Digit shape follows the interface language. Re-exported here so a widget takes it
   from the toolbox rather than reaching for toLocaleString, which is the same
   thing until someone passes it a language. */
export { formatNumber, localiseDigits } from '/js/format-number.js?v=349a741d';

export function sinceLabel(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return _t('justNow', 'just now');

  const [value, unit] =
    s < 3600
      ? [Math.round(s / 60), 'minute']
      : s < 86400
        ? [Math.round(s / 3600), 'hour']
        : [Math.round(s / 86400), 'day'];

  try {
    return new Intl.RelativeTimeFormat(_lang, { numeric: 'auto', style: 'short' }).format(
      -value,
      /** @type {Intl.RelativeTimeFormatUnit} */ (unit),
    );
  } catch {
    /* An unknown locale tag, or a browser without it. */
    return `${value}${unit[0]} ago`;
  }
}

/** The shared error, empty and healthy states, wired to the widget catalog.
    @param {any} opts */
export function errorState(opts = {}) {
  return _errorState(Object.assign({ t: _t }, opts));
}

/** The reader's wording for a failure, for a widget that draws its own state.
    @param {unknown} err a caught error, or { kind } from a response
    @returns {string} */
export function errorLine(err) {
  const { key, text } = errorCopy(errorKind(err));
  return _t(key, text);
}

/* Widgets on a page the user has swiped away from keep running: the dashboard
   mounts every page at once. It multiplies their poll interval through
   window.__setPollRate, which the dashboard calls on each frame. */
const _polls = new Set();
let _rate = 1;

/** @param {number} rate multiplier on every poll interval in this frame */
export function setPollRate(rate) {
  const r = Number(rate) > 0 ? Number(rate) : 1;
  if (r === _rate) return;
  _rate = r;
  for (const p of _polls) p(r);
}

if (typeof window !== 'undefined') /** @type {any} */ (window).__setPollRate = setPollRate;

export function poll(opts = {}) {
  const intervalFor = d => (typeof opts.interval === 'function' ? opts.interval(d) : opts.interval) || 30000;
  const staleAfter = opts.staleAfter != null ? opts.staleAfter : 2;
  const isEmpty = opts.isEmpty || (() => false);
  const doFetch = opts.fetch || (() => fetchData(opts.endpoint));
  const custom = typeof opts.onError === 'function'; /* widget draws its own error UI */
  const ov = custom ? null : errorState({ root: opts.root || document.body, content: opts.content });
  let lastOk = 0,
    fails = 0,
    everOk = false,
    stopped = false,
    lastData = null,
    timer = null;
  let paused = false;
  let inFlight = false;
  let lastTick = 0;

  async function tick() {
    if (stopped) return;
    lastTick = Date.now();
    try {
      const data = await doFetch();
      if (stopped) return;
      fails = 0;
      lastOk = Date.now();
      everOk = true;
      lastData = data;
      if (isEmpty(data)) {
        if (ov) ov.empty(opts.emptyText || _t('noData', 'No data'));
        else opts.onEmpty && opts.onEmpty(data);
      } else {
        if (ov) ov.ok();
        opts.render && opts.render(data);
      }
    } catch (e) {
      if (stopped) return;
      fails++;
      const stale = fails >= staleAfter;
      if (custom) opts.onError({ error: e, everOk, stale, since: lastOk ? sinceLabel(lastOk) : '' });
      else if (!everOk || stale) ov.fail(e, { since: everOk && lastOk ? sinceLabel(lastOk) : '' });
    }
  }

  const isHidden = () => typeof document !== 'undefined' && document.hidden === true;

  /* setTimeout, not setInterval. A slow fetch must not overlap the next one. */
  async function loop() {
    timer = null;
    inFlight = true;
    try {
      await tick();
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    /* Schedule nothing while hidden. Each tick reaches the user's own service,
       and browser throttling only slows that. */
    if (isHidden()) {
      paused = true;
      return;
    }
    /* Jittered, so several widgets on one dashboard do not fetch in lockstep.
       The first tick is not delayed: that one is the widget's content. */
    timer = setTimeout(loop, jitter(intervalFor(lastData) * _rate));
  }

  /* Reschedules against the time of the last fetch, so returning to a page
     refreshes at once when the data is already older than one normal interval,
     and waits out the remainder when it is not. */
  function onRate(rate) {
    if (stopped || paused || timer === null) return;
    clearTimeout(timer);
    const due = lastTick + intervalFor(lastData) * rate - Date.now();
    if (due <= 0) loop();
    else timer = setTimeout(loop, jitter(due));
  }
  _polls.add(onRate);

  function onVisibility() {
    if (stopped) return;
    if (isHidden()) {
      clearTimeout(timer);
      timer = null;
      paused = true;
      return;
    }
    if (!paused) return;
    paused = false;
    /* A tick still in flight schedules the next one when it lands. A second
       loop here would double the poll rate for good. */
    if (!inFlight) loop();
  }
  /* poll() is unit-tested outside a browser, where there is no document. */
  const canObserve = typeof document !== 'undefined' && typeof document.addEventListener === 'function';
  if (canObserve) document.addEventListener('visibilitychange', onVisibility);

  if (ov) ov.empty(opts.loadingText || _t('loading', 'Loading'));
  loop();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      _polls.delete(onRate);
      if (canObserve) document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
