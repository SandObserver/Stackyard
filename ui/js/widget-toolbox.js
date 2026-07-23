/* Optional widget author toolbox.
   Importing this is never required; a widget can fetch and draw entirely on its
   own. It bundles the small, repeatedly-useful primitives so an author building
   a widget for a new service can reuse them instead of re-deriving them.

   DATA
     widgetId()                      this widget's id (from the iframe URL)
     fetchData(endpoint, opts?)      GET the generic data endpoint, parsed JSON
     getConfig()                     GET this widget's (secret-free) config
     openUrl(href)                   open a link in a new tab from inside the
                                     sandboxed widget iframe
     esc(value)                      HTML-escape a value for innerHTML

   VISUALS  (self-contained inline SVG/DOM, no extra CSS needed)
     smoothPath(points)              smooth SVG path string through [[x,y],...]
     sparkline(values, opts?)        an <svg> area+line chart element
     barFill(percent, opts?)         a track+fill bar element

   STATE  (graceful loading / empty / stale / error, self-contained)
     sinceLabel(ts)                  relative "3m ago" label from a timestamp
     poll(opts)                      fetch+render loop that keeps the last good
                                     render on a transient failure

   Heavier visuals (heatmap grid, dotted world map, disk bay layout) are lifted
   into this toolbox as the widgets that own them are converted, so they can be
   verified identical to the originals. More chart types are added here over
   time rather than re-derived per widget.
*/

import { esc } from '/js/html.js?v=1';

/* Re-exported so a widget frontend needs only this one import. */
export { esc };

const NS = 'http://www.w3.org/2000/svg';
const _params = new URLSearchParams(location.search);


export function widgetId() { return _params.get('id') || ''; }

export async function fetchData(endpoint, opts = {}) {
  const id = widgetId();
  const qs = endpoint ? '?endpoint=' + encodeURIComponent(endpoint) : '';
  const r = await fetch(`/api/widget-data/${encodeURIComponent(id)}${qs}`, { cache: 'no-store', signal: opts.signal });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const e = new Error(d.error || 'HTTP ' + r.status);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

/* window.open is unreliable from a sandboxed iframe, so click a real anchor and
   fall back to window.open only if that throws. */
export function openUrl(href) {
  if (!href) return;
  try {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
  } catch { window.open(href, '_blank', 'noopener,noreferrer'); }
}

export async function getConfig() {
  const id = widgetId();
  const r = await fetch(`/api/widget-config/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!r.ok) { const e = new Error('config HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}


const _r = n => Math.round(n * 100) / 100;

/* Smooth path through points, lifted unchanged from the AdGuard chart so lines
   look identical to the existing widgets. points: [[x,y], ...]. */
export function smoothPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M${_r(points[0][0])},${_r(points[0][1])}`;
  const t = 0.35;
  let d = `M${_r(points[0][0])},${_r(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] || points[i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) * t, cp1y = p1[1] + (p2[1] - p0[1]) * t;
    const cp2x = p2[0] - (p3[0] - p1[0]) * t, cp2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${_r(cp1x)},${_r(cp1y)} ${_r(cp2x)},${_r(cp2y)} ${_r(p2[0])},${_r(p2[1])}`;
  }
  return d;
}

/* Area + line sparkline as a self-contained <svg> element, scaling to its
   container (preserveAspectRatio none, like the AdGuard chart).
   opts: { width=200, height=60, color='#0a84ff', fillOpacity=0.22,
           lineWidth=1.5, smooth=true, max=auto*1.2, gradientId } */
export function sparkline(values, opts = {}) {
  const W = opts.width || 200, H = opts.height || 60;
  const color = opts.color || '#0a84ff';
  const lineWidth = opts.lineWidth != null ? opts.lineWidth : 1.5;
  const fillOpacity = opts.fillOpacity != null ? opts.fillOpacity : 0.22;
  const smooth = opts.smooth !== false;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block'; svg.style.overflow = 'visible';

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

  const gid = opts.gradientId || ('sl_' + Math.random().toString(36).slice(2, 9));
  const defs = document.createElementNS(NS, 'defs');
  const grad = document.createElementNS(NS, 'linearGradient');
  grad.setAttribute('id', gid);
  grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0'); grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
  const g0 = document.createElementNS(NS, 'stop');
  g0.setAttribute('offset', '0%'); g0.setAttribute('stop-color', color); g0.setAttribute('stop-opacity', String(fillOpacity));
  const g1 = document.createElementNS(NS, 'stop');
  g1.setAttribute('offset', '100%'); g1.setAttribute('stop-color', color); g1.setAttribute('stop-opacity', '0');
  grad.append(g0, g1); defs.appendChild(grad); svg.appendChild(defs);

  const area = document.createElementNS(NS, 'path');
  area.setAttribute('d', areaPathStr); area.setAttribute('fill', `url(#${gid})`);
  svg.appendChild(area);

  const line = document.createElementNS(NS, 'path');
  line.setAttribute('d', linePathStr); line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color); line.setAttribute('stroke-width', String(lineWidth));
  line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);

  return svg;
}

/* A horizontal track with a proportional fill, self-contained via inline styles.
   opts: { color='#0a84ff', track='rgba(255,255,255,0.10)', height=6, radius=3 } */
export function barFill(percent, opts = {}) {  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const h = opts.height != null ? opts.height : 6;
  const radius = opts.radius != null ? opts.radius : 3;
  const track = document.createElement('div');
  track.style.cssText = `position:relative;width:100%;height:${h}px;border-radius:${radius}px;` +
    `background:${opts.track || 'rgba(255,255,255,0.10)'};overflow:hidden`;
  const fill = document.createElement('div');
  fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:${pct}%;border-radius:${radius}px;` +
    `background:${opts.color || '#0a84ff'};transition:width .4s ease`;
  track.appendChild(fill);
  return track;
}


/* Relative "updated" label from a timestamp (ms since epoch). */
export function sinceLabel(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

/* A muted, centered status message overlaid on the widget, matching the
   existing empty/error look. Self-contained inline styles. */
function _overlay(root) {
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
    'text-align:center;padding:0 16px;font-size:11px;line-height:1.35;color:rgba(150,150,150,0.92);pointer-events:none';
  root.appendChild(el);
  return {
    show(msg, dim) { el.textContent = msg; el.style.background = dim ? 'rgba(20,20,22,0.55)' : 'transparent'; el.style.display = 'flex'; },
    hide() { el.style.display = 'none'; },
  };
}

/* Fetch an endpoint on a timer and render it, handling the loading / empty /
   stale / error lifecycle so a single failed poll never blanks a working
   widget. A successful, non-empty result calls render(data). A successful but
   empty result shows emptyText. A failure keeps the last good render in place;
   only after `staleAfter` consecutive failures does it surface errorText (with
   how long ago the last success was), dimming the stale content behind it. A
   widget that has never loaded shows errorText immediately.

   Widgets with their own error display (e.g. specific "Bad token" / "Not
   configured" messages) can pass onError instead. When present, poll shows no
   overlay and calls onError({ error, everOk, stale, since }) on each failure,
   leaving the widget to decide what to show and whether to keep the last render.
   The usual pattern is: show error.message when there is nothing good to keep
   (`!everOk || stale`), otherwise do nothing so the last render stays.

   opts: {
     render,                 (data) => void  draw a successful, non-empty result
     endpoint,               optional data endpoint name for fetchData
     fetch,                  optional async () => data (defaults to fetchData(endpoint))
     isEmpty,                optional (data) => bool  a successful but empty result
     onError,                optional (info) => void  render your own error UI
     interval = 30000,       poll period in ms, or (data) => ms to vary it
                             with the last successful result
     staleAfter = 2,         consecutive failures tolerated before showing the error
     root = document.body,   element the status message overlays
     loadingText, emptyText, errorText
   }
   Returns { stop }.
*/
export function poll(opts = {}) {
  const intervalFor = d => (typeof opts.interval === 'function' ? opts.interval(d) : opts.interval) || 30000;
  const staleAfter = opts.staleAfter != null ? opts.staleAfter : 2;
  const isEmpty = opts.isEmpty || (() => false);
  const doFetch = opts.fetch || (() => fetchData(opts.endpoint));
  const custom = typeof opts.onError === 'function'; /* widget draws its own error UI */
  const ov = custom ? null : _overlay(opts.root || document.body);
  let lastOk = 0, fails = 0, everOk = false, stopped = false, lastData = null, timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const data = await doFetch();
      if (stopped) return;
      fails = 0; lastOk = Date.now(); everOk = true; lastData = data;
      if (!custom && isEmpty(data)) ov.show(opts.emptyText || 'No data', false);
      else { if (ov) ov.hide(); opts.render && opts.render(data); }
    } catch (e) {
      if (stopped) return;
      fails++;
      const stale = fails >= staleAfter;
      if (custom) opts.onError({ error: e, everOk, stale, since: lastOk ? sinceLabel(lastOk) : '' });
      else if (!everOk) ov.show(opts.errorText || 'Unavailable', false);
      else if (stale) ov.show((opts.errorText || 'Unavailable') + (lastOk ? ' · ' + sinceLabel(lastOk) : ''), true);
      /* within tolerance: leave the last good render untouched */
    }
  }

  /* setTimeout rather than setInterval so a variable interval takes effect from
     the next tick, and so a slow fetch cannot overlap with the following one. */
  async function loop() {
    await tick();
    if (stopped) return;
    timer = setTimeout(loop, intervalFor(lastData));
  }

  if (ov) ov.show(opts.loadingText || 'Loading', false);
  loop();
  return { stop() { stopped = true; clearTimeout(timer); } };
}
