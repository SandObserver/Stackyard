import {
  poll, getConfig, loadStrings, wt, wtCount, formatNumber, formatList, localiseDigits, formatByteRate, formatDuration, linkTo, errorState, readingTime, fitText, placeholder, readerHourCycle,
} from '/js/widget-toolbox.js?v=039ea657';
import { ensureSprite } from '/js/icon-set.js?v=beda3062';
import { variations, finishedToday, hoursMinutes, leftover, lidOpen, finishParts } from './belt-logic.js';

const SVG = 'http://www.w3.org/2000/svg';
const TONES = [
  { top: '#E9BE85', front: '#D4A062', side: '#B5823F' },
  { top: '#D9A96C', front: '#BE8746', side: '#9C6A31' },
  { top: '#F3D3A6', front: '#E3BB88', side: '#C49556' },
];
const SEAM = '#B5823F';
/* Units are the design size in WIDGET_DESIGN, not card pixels. */
const GEOM = {
  small: { w: 170, h: 170, box: 124, depth: 11, x0: 18, maxH: 81, tape: 9, per: 1 },
  medium: { w: 360, h: 170, box: 106, depth: 10, x0: 18, maxH: 81, tape: 9, per: 3 },
};
const BELT_DEPTH = 17;
const RAIL = 19;

/* The page lays out at the card's shape, so its width varies by a few percent. */
function layout() {
  const base = medium ? GEOM.medium : GEOM.small;
  /* The aspect, not the size: the dashboard may apply its zoom after this runs. */
  const cw = document.documentElement.clientWidth, ch = document.documentElement.clientHeight;
  const h = base.h;
  const w = cw && ch ? Math.round((h * cw) / ch) : base.w;
  const box = base.per > 1 ? Math.floor((w - 2 * base.x0 - base.depth) / base.per) : base.box;
  geom = { ...base, w, h, box, belt: h - RAIL };
  beltSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
}

const w = document.getElementById('w');
const stage = document.getElementById('stage');
const track = document.getElementById('track');
const beltSvg = document.getElementById('belt');
const bigEl = document.getElementById('big');
const subEl = document.getElementById('sub');
const pager = document.getElementById('pager');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const countEl = document.getElementById('count');
const sr = document.getElementById('sr');
const capEl = document.getElementById('cap');

/** @param {string} tag @param {Record<string, string>} [attrs] @param {string} [text] */
function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}
/** @param {string} tag @param {Record<string, string|number>} attrs */
function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}
function chevron() {
  const s = svgEl('svg', { class: 'sy-icon', 'aria-hidden': 'true', focusable: 'false' });
  const u = svgEl('use', { href: '#sy-solid-back' });
  s.append(u);
  return s;
}

/* First-strong isolates: "1 min" or "6:58 PM" keeps its own order inside right-to-left text. */
const iso = text => `\u2068${text}\u2069`;
/* Spoken text carries no isolates. */
const plain = text => text.replace(/[\u2068\u2069]/g, '');
function duration(seconds, unitDisplay) {
  const { h, m } = hoursMinutes(seconds);
  return formatDuration(h * 60 + m, unitDisplay, iso);
}
const speed = bps => iso(formatByteRate(bps, { min: 'kilobyte' }));
const percent = p => iso(formatNumber(p, { style: 'percent', maximumFractionDigits: 0 }));
const LANG = new URLSearchParams(location.search).get('lang') || 'en';
const HOUR_CYCLE = readerHourCycle(navigator.language);
function clockParts(ms) {
  try {
    const { time, half } = finishParts(ms, Date.now(), LANG, HOUR_CYCLE);
    const period = half === 'am' ? wt('ui.am', 'AM') : half === 'pm' ? wt('ui.pm', 'PM') : '';
    return { time: localiseDigits(time), period };
  } catch {
    return { time: localiseDigits(new Date(ms).toTimeString().slice(0, 5)), period: '' };
  }
}
function clock(ms) {
  const { time, period } = clockParts(ms);
  return iso(period ? `${time} ${period}` : time);
}
const REASON = {
  noPeers: () => wt('ui.reason.noPeers', 'no peers'),
  missingFiles: () => wt('ui.reason.missingFiles', 'files missing'),
  error: () => wt('ui.reason.error', 'error'),
  paused: () => wt('ui.reason.paused', 'paused'),
};
const reasonText = r => (REASON[r] || REASON.error)();

/** The detail line under a name, and its spoken form. */
function detail(it) {
  if (it.state !== 'run') return { text: `${percent(it.progress)} · `, problem: reasonText(it.reason), cls: it.state };
  const parts = it.eta != null ? [percent(it.progress), duration(it.eta, 'narrow')] : [percent(it.progress)];
  return { text: parts.join(' · '), problem: '', cls: '' };
}
function spoken(it) {
  const p = percent(it.progress);
  if (it.state !== 'run') return wt('ui.sayProblem', '{name}, {percent}, {reason}', { name: it.name, percent: p, reason: reasonText(it.reason) });
  if (it.eta == null) return wt('ui.sayNoEta', '{name}, {percent}', { name: it.name, percent: p });
  return wt('ui.sayItem', '{name}, {percent}, {left} left', { name: it.name, percent: p, left: duration(it.eta) });
}

let medium = false;
let geom = GEOM.small;
let page = 0;
let shown = [];
let drawn = false;

function drawBelt(left) {
  const W = geom.w, y = geom.belt, bd = BELT_DEPTH, bdy = Math.round(bd * 0.6);
  beltSvg.replaceChildren(
    svgEl('polygon', { points: `-40,${y} ${W + 10},${y} ${W + 10 + bd},${y - bdy} ${-40 + bd},${y - bdy}`, fill: 'var(--belt)' }),
    svgEl('rect', { x: 0, y, width: W, height: 3, fill: 'var(--belt-back)' }),
    svgEl('rect', { x: 0, y, width: W, height: 1, fill: 'var(--rail-hi)', opacity: 0.7 }),
    svgEl('rect', { x: 0, y: y + 3, width: W, height: 40, fill: 'var(--rail)' }),
  );
  if (left) beltSvg.append(leftoverArt(left));
}

const ROLL = {
  packing: ['#B5823F', '#E9BE85', 'rgba(0,0,0,.12)'],
  clear: ['rgba(255,255,255,.45)', 'rgba(255,255,255,.6)', 'rgba(255,255,255,.5)'],
  blue: ['#0091FF', '#0091FF', 'rgba(0,0,0,.18)'],
  masking: ['#E3BB88', '#F3D3A6', 'rgba(0,0,0,.1)'],
  yellow: ['#FFD600', '#FFD600', 'rgba(0,0,0,.14)'],
};
const CUTTER = { yellow: '#FFD600', orange: '#FF9230', blue: '#0091FF', grey: '#8E8E93' };

/** A tape roll lying flat, or a box cutter, at 1.5x so it reads at card size. */
function leftoverArt(l) {
  const y = geom.belt, g = svgEl('g', {});
  const room = geom.w - 90;
  const x = 40 + l.x * room;
  if (l.kind === 'roll') {
    const [side, top, ring] = ROLL[l.tape];
    const core = 5, R = core + 2 + l.fill * 8.5, h = 6.5, k = 0.42, y0 = y - 3;
    const ang = 0.35 + l.at * 0.5, sx = x + R * Math.cos(ang), sy = y0 + R * k * Math.sin(ang);
    const len = 9 + l.tail * 10, tw = h * 0.5;
    g.setAttribute('transform', `translate(${x} ${y - 3}) scale(1.5) translate(${-x} ${-(y - 3)})`);
    g.append(
      svgEl('ellipse', { cx: x + 2, cy: y0 + 1, rx: R + 2, ry: R * k + 1.5, fill: 'rgba(0,0,0,.22)' }),
      svgEl('path', { d: `M${x - R},${y0 - h} L${x - R},${y0} A${R},${R * k} 0 0 0 ${x + R},${y0} L${x + R},${y0 - h} Z`, fill: side }),
      svgEl('ellipse', { cx: x, cy: y0 - h, rx: R, ry: R * k, fill: top }),
      ...[0.35, 0.65].map(f => {
        const rr = core + 1.6 + (R - core - 1.6) * f;
        return svgEl('ellipse', { cx: x, cy: y0 - h, rx: rr, ry: rr * k, fill: 'none', stroke: ring, 'stroke-width': 0.8 });
      }),
      svgEl('ellipse', { cx: x, cy: y0 - h, rx: core + 1.4, ry: (core + 1.4) * k, fill: '#D4A062' }),
      svgEl('ellipse', { cx: x, cy: y0 - h, rx: core, ry: core * k, fill: '#5A3A18' }),
      svgEl('path', {
        d: `M${sx},${sy - h} C${sx + 3},${sy - h + 1} ${sx + 5},${sy - 1} ${sx + 6},${sy} L${sx + 6 + len},${sy + 0.6} L${sx + 6 + len + tw * 1.2},${sy + 0.6 - tw} L${sx + 6 + tw * 1.2},${sy - tw} C${sx + 4},${sy - h * 0.6} ${sx + 3},${sy - h + 0.4} ${sx},${sy - h - 0.8} Z`,
        fill: top,
      }),
    );
  } else {
    const body = CUTTER[l.colour], L = 19;
    const c = svgEl('g', { transform: `translate(${x - L / 2} ${y - 4}) rotate(${l.angle.toFixed(1)}) scale(1.4)` });
    c.append(
      svgEl('rect', { x: 1, y: 1.2, width: L, height: 3.2, rx: 1.6, fill: 'rgba(0,0,0,.25)' }),
      svgEl('rect', { x: 0, y: -2.3, width: L, height: 4.6, rx: 2.2, fill: body }),
      ...[3, 5, 7].map(i => svgEl('path', { d: `M${i},-1.4 v2.8`, stroke: '#000', 'stroke-width': 0.7, opacity: 0.3 })),
      l.open
        ? svgEl('polygon', { points: `${L},-1.5 ${L + 6},-0.2 ${L + 6.4},0.6 ${L},1.4`, fill: '#FFFFFF', opacity: 0.85 })
        : svgEl('polygon', { points: `${L},-1 ${L + 1.4},0 ${L},1`, fill: '#8E8E93' }),
    );
    g.append(c);
  }
  return g;
}

const FLAP_LIFT = { small: 4.5, medium: 5 };
const flapAngle = lift => (Math.atan((2 * lift) / geom.box) * 180) / Math.PI;

/** The right flap and the dark inside under it. The flap leans on its outer hinge. */
function makeFlap(tone, d, dy) {
  const bw = geom.box;
  const pts = `${bw / 2},${dy} ${bw},${dy} ${bw + d},0 ${bw / 2 + d},0`;
  const s = svgEl('svg', { class: 'flap', width: bw + d, height: dy, 'aria-hidden': 'true' });
  Object.assign(s.style, { left: '0', top: -dy + 'px' });
  const g = svgEl('g', {});
  g.style.transformOrigin = `${bw}px ${dy}px`;
  g.append(
    svgEl('polygon', { points: pts, fill: tone.top }),
    svgEl('line', { x1: bw / 2, y1: dy - 0.4, x2: bw, y2: dy - 0.4, stroke: tone.side, 'stroke-width': 0.8 }),
  );
  s.append(svgEl('polygon', { points: pts, fill: '#5A3A18' }), g);
  return s;
}
function setFlap(flap, open) {
  if (!flap) return;
  flap.lastChild.style.transform = `skewY(${open ? flapAngle(FLAP_LIFT[medium ? 'medium' : 'small']) : 0}deg)`;
}

const rtl = () => document.documentElement.dir === 'rtl';
/** Where box i stands. Right to left, the first box stands at the right end. */
function slotX(i) {
  return rtl() ? geom.w - geom.x0 - geom.depth - (i + 1) * geom.box : geom.x0 + i * geom.box;
}

const tapeShift = progress => `translateX(${Math.max(4, progress * 100) - 100}%)`;

function lidClip(fw, off) {
  return `polygon(0px 100%, ${fw.toFixed(1)}px 100%, ${(fw + off).toFixed(1)}px 0px, ${off.toFixed(1)}px 0px)`;
}

/** One box: faces, label, and tape over the lid. Returns its element; height
    follows the label, which is measured after it is in the page. */
function makeBox(it, v, x) {
  const { box: bw, depth: d, tape: th } = geom;
  const dy = Math.round(d * 0.6), tone = TONES[v.tone];
  const b = el('div', { class: 'box' });
  b.style.left = x + 'px';
  b.style.width = bw + 'px';
  const top = el('div', { class: 'face' });
  Object.assign(top.style, { left: '0', top: -dy + 'px', width: bw + d + 'px', height: dy + 'px', background: tone.top,
    clipPath: `polygon(0 100%, ${d}px 0, 100% 0, ${bw}px 100%)` });
  const side = el('div', { class: 'face' });
  Object.assign(side.style, { left: bw + 'px', top: -dy + 'px', width: d + 'px', background: tone.side });
  const front = el('div', { class: 'face' });
  Object.assign(front.style, { inset: '0', background: tone.front, borderRadius: '1px', boxShadow: 'inset 1px 0 0 rgba(0,0,0,.18)' });
  const seam = el('div', { class: 'face' });
  const deg = (-Math.atan2(dy, d) * 180) / Math.PI;
  Object.assign(seam.style, { left: bw / 2 + 'px', top: '-0.6px', width: Math.hypot(d, dy).toFixed(1) + 'px', height: '1.2px',
    background: SEAM, transformOrigin: '0 50%', transform: `rotate(${deg.toFixed(1)}deg)` });

  const lab = el('div', { class: 'lab' });
  Object.assign(lab.style, { left: '7px', right: '7px', top: th + 6 + 'px' });
  const nm = el('span', { class: 'nm', dir: 'auto' });
  for (const part of it.name.split(/(?<=[-._])/)) nm.append(part, el('wbr'));
  const dt = detail(it);
  const dtEl = el('span', { class: 'dt' }, dt.text);
  if (dt.problem) dtEl.append(el('span', { class: dt.cls }, dt.problem));
  lab.append(nm, dtEl);

  const colour = `var(--${it.state})`;
  const off = d * 0.55, lh = dy * 0.55;
  const lid = el('div', { class: 'lid' });
  Object.assign(lid.style, { left: '0', top: -lh + 'px', width: bw + d + 'px', height: lh + 1 + 'px', background: colour,
    clipPath: lidClip(bw * it.progress, off) });
  const tp = el('div', { class: 'tp' });
  Object.assign(tp.style, { width: bw + 'px', height: th + 'px' });
  const fill = el('div', { class: `fill end-${v.end}${v.end === 'tab' ? ' tab' : ''}` });
  Object.assign(fill.style, { transform: tapeShift(it.progress), background: colour });
  tp.append(fill);

  const shadow = el('div', { class: 'face' });
  const flap = v.ajar ? makeFlap(tone, d, dy) : null;
  b.append(...[shadow, top, seam, flap, side, front, lab, lid, tp].filter(Boolean));
  b._parts = { side, lab, shadow, lid, fill, flap, v, dy, d, bw, off };
  return b;
}

function sizeBox(b, extra) {
  const { side, lab, shadow, dy, d, bw } = b._parts;
  const need = Math.round(lab.offsetTop + lab.offsetHeight + 8);
  const h = Math.max(need, Math.min(need + extra, geom.maxH));
  b.style.height = h + 'px';
  b.style.top = geom.belt - 3 - h + 'px';
  Object.assign(side.style, { height: h + dy + 'px', clipPath: `polygon(0 ${dy}px, 100% 0, 100% ${h}px, 0 100%)` });
  Object.assign(shadow.style, { left: '3px', top: h - 1 + 'px', width: bw + d + 'px', height: '4px', background: 'rgba(0,0,0,.35)',
    clipPath: `polygon(0 100%, ${d}px 0, 100% 0, ${bw}px 100%)` });
  b._parts.roomy = h + FLAP_LIFT[medium ? 'medium' : 'small'] <= geom.maxH;
}

function drawGhosts() {
  const { box: bw, depth: d } = geom, dy = Math.round(d * 0.6);
  track.replaceChildren(
    ...[62, 54, 60].map((h, i) => {
      const g = el('div', { class: 'box' });
      Object.assign(g.style, { left: slotX(i) + 'px', top: geom.belt - 3 - h + 'px', width: bw + 'px', height: h + 'px' });
      const parts = [
        [{ left: '0', top: -dy + 'px', width: bw + d + 'px', height: dy + 'px', clipPath: `polygon(0 100%, ${d}px 0, 100% 0, ${bw}px 100%)` }, '--ghost-top'],
        [{ left: bw + 'px', top: -dy + 'px', width: d + 'px', height: h + dy + 'px', clipPath: `polygon(0 ${dy}px, 100% 0, 100% ${h}px, 0 100%)` }, '--ghost-side'],
        [{ left: '0', top: '0', width: bw + 'px', height: h + 'px' }, '--ghost-front'],
        [{ left: '7px', top: geom.tape + 6 + 'px', width: bw - 14 + 'px', height: Math.min(h - geom.tape - 14, 34) + 'px', borderRadius: '3px' }, '--ghost-label'],
      ];
      for (const [style, colour] of parts) {
        const p = el('div', { class: 'ghost' });
        Object.assign(p.style, style, { background: `var(${colour})` });
        g.append(p);
      }
      return g;
    }),
  );
}

let headerMode = 'finish';

function header(data, now) {
  const KINDS = ['time', 'stall', 'error', 'paused'];
  const m = KINDS.includes(data.summary?.kind) ? data.summary : { kind: 'done' };
  bigEl.className = 'big';
  if (m.kind === 'done') {
    const { count, last } = finishedToday(data.finished, now);
    bigEl.classList.add('done');
    bigEl.textContent = wt('ui.allDone', 'All done');
    if (!count) subEl.textContent = wt('ui.nothing', 'Nothing downloading');
    else if (medium && last) subEl.textContent = wtCount('ui.finishedLast', count, { one: '{count} finished today · at {time}', other: '{count} finished today · last at {time}' }, { time: clock(last) });
    else subEl.textContent = wtCount('ui.finishedToday', count, { one: '{count} today', other: '{count} today' });
    return wt('ui.sayHeading', '{title}, {detail}', { title: bigEl.textContent, detail: subEl.textContent });
  }
  if (m.kind === 'paused') {
    const { count } = finishedToday(data.finished, now);
    bigEl.classList.add('pause');
    bigEl.textContent = wt('ui.paused', 'Paused');
    subEl.textContent = count ? wtCount('ui.finishedToday', count, { one: '{count} today', other: '{count} today' }) : '';
    return subEl.textContent ? wt('ui.sayHeading', '{title}, {detail}', { title: bigEl.textContent, detail: subEl.textContent }) : bigEl.textContent;
  }
  if (m.kind === 'stall' || m.kind === 'error') {
    bigEl.classList.add(m.kind);
    bigEl.textContent = m.kind === 'error' ? wt('ui.error', 'Error') : wt('ui.stalled', 'Stalled');
    subEl.textContent = reasonText(m.reason);
    return wt('ui.sayHeading', '{title}, {detail}', { title: bigEl.textContent, detail: subEl.textContent });
  }
  bigEl.classList.add('run', 'time');
  const problem = m.failed
    ? wtCount('ui.failedCount', m.failed, { one: '{count} failed', other: '{count} failed' })
    : m.stalled
      ? wtCount('ui.stalledCount', m.stalled, { one: '{count} stalled', other: '{count} stalled' })
      : '';
  let lead;
  let rest;
  let period = '';
  if (m.seconds == null) {
    lead = wt('ui.waiting', 'Waiting');
    rest = medium
      ? wtCount('ui.noEstimateYet', m.moving, { one: '{count} download · no estimate yet', other: '{count} downloads · no estimate yet' })
      : wt('ui.noEstimateShort', 'no estimate yet');
  } else if (headerMode === 'left') {
    lead = duration(m.seconds);
    rest = wtCount('ui.untilDone', m.moving, { one: 'until done', other: 'until all {count} done' });
  } else {
    ({ time: lead, period } = clockParts(now + m.seconds * 1000));
    rest = wtCount('ui.allDoneAt', m.moving, { one: 'done', other: 'all {count} done' });
  }
  bigEl.textContent = '';
  const leadEl = el('bdi', {}, lead);
  if (period) leadEl.append(el('span', { class: 'period' }, period));
  bigEl.append(leadEl);
  subEl.replaceChildren();
  const parts = [rest].filter(Boolean);
  if (problem) {
    if (parts.length && medium) subEl.append(parts.join(''), ' · ');
    subEl.append(el('span', { class: m.failed ? 'error' : 'stall' }, problem));
  } else {
    if (medium && m.speed > 0) parts.push(speed(m.speed));
    subEl.append(parts.join(' · '));
  }
  const title = period ? `${lead} ${period}` : lead;
  const detailText = problem && !medium && rest ? `${rest} · ${subEl.textContent}` : subEl.textContent;
  return detailText ? wt('ui.sayHeading', '{title}, {detail}', { title, detail: detailText }) : title;
}

function setPage(i, announce) {
  const pages = Math.ceil(shown.length / geom.per);
  page = (i + pages) % pages;
  const first = page * geom.per;
  const b = track.children[first];
  const offset = b ? Math.abs(b.offsetLeft - slotX(0)) : 0;
  track.style.transform = `translateX(${rtl() ? offset : -offset}px)`;
  countEl.textContent = localiseDigits(`${page + 1}/${pages}`);
  pager.setAttribute(
    'aria-label',
    geom.per > 1
      ? wt('ui.pageGroup', 'Page {n} of {total}', { n: formatNumber(page + 1), total: formatNumber(pages) })
      : wt('ui.pageOf', 'Download {n} of {total}', { n: formatNumber(page + 1), total: formatNumber(pages) }),
  );
  if (announce) sr.textContent = plain(formatList(shown.slice(first, first + geom.per).map(spoken)));
}
prevBtn.addEventListener('click', () => setPage(page - 1, true));
nextBtn.addEventListener('click', () => setPage(page + 1, true));

function render(data) {
  const now = Date.now();
  const items = (Array.isArray(data.items) ? data.items : []).filter(
    i => i && typeof i.name === 'string' && i.name && Number.isFinite(i.progress),
  );
  const sameRow = items.length === shown.length && items.every((it, i) => it.name === shown[i]?.name && it.state === shown[i]?.state);
  const summary = header(data, now);
  fitText(bigEl, 15);

  if (sameRow && track.children.length === items.length) {
    items.forEach((it, i) => {
      const p = track.children[i]._parts;
      p.fill.style.transform = tapeShift(it.progress);
      p.lid.style.clipPath = lidClip(p.bw * it.progress, p.off);
      setFlap(p.flap, p.roomy && lidOpen(p.v, it));
      const dt = detail(it);
      const dtEl = p.lab.querySelector('.dt');
      dtEl.textContent = dt.text;
      if (dt.problem) dtEl.append(el('span', { class: dt.cls }, dt.problem));
    });
  } else {
    const vs = variations(items);
    const boxes = items.map((it, i) => {
      const b = makeBox(it, vs[i], slotX(i));
      if (rtl()) b.style.zIndex = String(items.length - i);
      return b;
    });
    track.replaceChildren(...boxes);
    boxes.forEach((b, i) => {
      sizeBox(b, vs[i].extra);
      setFlap(b._parts.flap, b._parts.roomy && lidOpen(vs[i], items[i]));
    });
    if (page >= items.length) page = 0;
  }
  shown = items;
  drawn = true;
  drawBelt(items.length ? null : leftover(Math.floor(readingTime(data) / 1000)));
  pager.hidden = items.length <= geom.per;
  if (!pager.hidden) setPage(page, false);
  else track.style.transform = '';

  const linked = linkTo(stage, data.link || '');
  const text = items.length ? wt('ui.sayAll', '{heading}. {items}', { heading: summary, items: formatList(items.slice(0, 3).map(spoken)) }) : summary;
  stage.setAttribute(
    'aria-label',
    plain(linked ? wt('ui.openClient', '{text}. Activate to open the download client.', { text }) : text),
  );
  if (!linked) stage.setAttribute('role', 'img');
}

async function start() {
  await loadStrings();
  ensureSprite(document);
  prevBtn.append(chevron());
  nextBtn.append(chevron());
  prevBtn.setAttribute('aria-label', wt('ui.previous', 'Previous download'));
  nextBtn.setAttribute('aria-label', wt('ui.next', 'Next download'));
  w.setAttribute('aria-label', wt('widget.label', 'Downloads'));
  let cfg = null;
  try {
    cfg = await getConfig();
  } catch {
    /* The defaults below still draw a usable widget. */
  }
  medium = cfg?.widgetSize === 'medium';
  layout();
  headerMode = cfg?.widgetConfig?.headerShows === 'left' ? 'left' : 'finish';
  w.classList.toggle('medium', medium);
  drawBelt(null);
  drawGhosts();
  bigEl.replaceChildren(placeholder(78, 20, 6));
  subEl.replaceChildren(placeholder(58, 10));
  let lastData = null;
  let failedBelt;
  /* The dashboard sets the page's direction after it loads. */
  const redraw = () => {
    layout();
    if (lastData) {
      shown = [];
      return render(lastData);
    }
    if (failedBelt === undefined) return drawGhosts();
    track.replaceChildren();
    drawBelt(failedBelt);
  };
  window.addEventListener('resize', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });

  const state = errorState({ root: w, caption: capEl, content: () => [track, bigEl] });
  poll({
    interval: 15000,
    render: d => {
      state.ok();
      subEl.hidden = false;
      lastData = d;
      render(d);
    },
    onError: ({ error, everOk, stale, since }) => {
      if (everOk && !stale) return;
      if (!drawn) {
        bigEl.textContent = '';
        track.replaceChildren();
        failedBelt = leftover(Math.floor(Date.now() / 1000));
        drawBelt(failedBelt);
        pager.hidden = true;
      }
      subEl.hidden = true;
      state.fail(error, { since, inert: everOk });
    },
  });
}
start();
