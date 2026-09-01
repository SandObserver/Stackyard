/* Optional toolbox for widget authors: data access, self-contained visuals and
   a fetch/render loop. */

import { esc, html, setHtml } from '/js/html.js?v=c71f8903';
import { isSafeLinkUrl } from '/js/link-url.js?v=54adb40f';
import { jitter } from '/js/jitter.js?v=4eeef4c9';

export { esc, html, setHtml };

/* Escaping cannot make a CSS value safe. `red; background-image: url(...)`
   survives esc() and still parses as a second declaration. Assign the result
   through a specific CSSOM property, never a concatenated style string. */
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;
export function safeColor(value, fallback) {
  return COLOR_RE.test(String(value ?? '').trim()) ? String(value).trim() : fallback;
}

const NS = 'http://www.w3.org/2000/svg';
const _params = new URLSearchParams(location.search);

export function widgetId() {
  return _params.get('id') || '';
}

export async function fetchData(endpoint, opts = {}) {
  const id = widgetId();
  const qs = endpoint ? '?endpoint=' + encodeURIComponent(endpoint) : '';
  const r = await fetch(`/api/widget-data/${encodeURIComponent(id)}${qs}`, { cache: 'no-store', signal: opts.signal });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const e = /** @type {Error & { status?: number }} */ (new Error(d.error || 'HTTP ' + r.status));
    e.status = r.status;
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

/* opts: { color='#0a84ff', track='rgba(255,255,255,0.10)', height=6, radius=3 } */
export function barFill(percent, opts = {}) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const h = opts.height != null ? opts.height : 6;
  const radius = opts.radius != null ? opts.radius : 3;
  const track = document.createElement('div');
  track.style.cssText =
    `position:relative;width:100%;height:${h}px;border-radius:${radius}px;` +
    `background:${opts.track || 'rgba(255,255,255,0.10)'};overflow:hidden`;
  const fill = document.createElement('div');
  fill.style.cssText =
    `position:absolute;left:0;top:0;bottom:0;width:${pct}%;border-radius:${radius}px;` +
    `background:${opts.color || '#0a84ff'}` +
    (reducedMotion() ? '' : ';transition:width .4s ease');
  track.appendChild(fill);
  return track;
}

/* A widget is an iframe and does not load the i18n module. The language arrives
   on the iframe URL. */
const _lang = new URLSearchParams(location.search).get('lang') || 'en';
let _strings = null;

async function _loadStrings() {
  if (_lang === 'en') return;
  try {
    const r = await fetch(`/i18n/${encodeURIComponent(_lang)}.json`, { cache: 'force-cache' });
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
      cache: 'force-cache',
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
/* Digit shape follows the reader's locale. Re-exported here so a widget takes it
   from the toolbox rather than reaching for toLocaleString, which is the same
   thing until someone passes it a language. */
export { formatNumber, localiseDigits } from '/js/format-number.js?v=4a5ccef4';

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

function _overlay(root) {
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
    'text-align:center;padding:0 16px;font-size:11px;line-height:1.35;color:rgba(150,150,150,0.92);pointer-events:none';
  root.appendChild(el);
  return {
    show(msg, dim) {
      el.textContent = msg;
      el.style.background = dim ? 'rgba(20,20,22,0.55)' : 'transparent';
      el.style.display = 'flex';
    },
    hide() {
      el.style.display = 'none';
    },
  };
}

/* The options and the poll lifecycle are documented in docs/widgets.md. */

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
  const ov = custom ? null : _overlay(opts.root || document.body);
  let lastOk = 0,
    fails = 0,
    everOk = false,
    stopped = false,
    lastData = null,
    timer = null;
  let paused = false;
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
      if (!custom && isEmpty(data)) ov.show(opts.emptyText || _t('noData', 'No data'), false);
      else {
        if (ov) ov.hide();
        opts.render && opts.render(data);
      }
    } catch (e) {
      if (stopped) return;
      fails++;
      const stale = fails >= staleAfter;
      if (custom) opts.onError({ error: e, everOk, stale, since: lastOk ? sinceLabel(lastOk) : '' });
      else if (!everOk) ov.show(opts.errorText || _t('unavailable', 'Unavailable'), false);
      else if (stale)
        ov.show(
          (opts.errorText || _t('unavailable', 'Unavailable')) + (lastOk ? ' · ' + sinceLabel(lastOk) : ''),
          true,
        );
    }
  }

  const isHidden = () => typeof document !== 'undefined' && document.hidden === true;

  /* setTimeout, not setInterval. A slow fetch must not overlap the next one. */
  async function loop() {
    await tick();
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
    if (due <= 0) {
      timer = null;
      loop();
    } else {
      timer = setTimeout(loop, jitter(due));
    }
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
    loop();
  }
  /* poll() is unit-tested outside a browser, where there is no document. */
  const canObserve = typeof document !== 'undefined' && typeof document.addEventListener === 'function';
  if (canObserve) document.addEventListener('visibilitychange', onVisibility);

  if (ov) ov.show(opts.loadingText || _t('loading', 'Loading'), false);
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
