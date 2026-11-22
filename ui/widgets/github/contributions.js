import { poll, fetchData, linkTo, loadStrings, wt, formatNumber, errorState, fitText, cssZoom, failureName } from '/js/widget-toolbox.js?v=039ea657';
import { slotWeeks, isoDay } from '/js/contribution-calendar.js?v=8ea71e8f';
await loadStrings();

const TICK_MS = 300000;
const params = new URLSearchParams(location.search);
const LANG = params.get('lang') || 'en';
const MOBILE = params.get('mobile') === '1';
const size = ['small', 'medium', 'large'].includes(params.get('size')) ? params.get('size') : 'small';
const GRID = { small: { cols: 0, bands: 0 }, medium: { cols: 10, bands: 1 }, large: { cols: 26, bands: 2 } }[size];

const w = document.getElementById('widget');
const cap = document.getElementById('cap');
const tip = document.getElementById('tip');
let linkEl = null;
const dayOf = new WeakMap();

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const head = el('div', 'head');
const fig = el('div', 'fig');
const num = el('div', 'num', '—');
const sub = el('div', 'sub');
const plot = el('div', 'plot');
plot.setAttribute('aria-hidden', 'true');
fig.append(num, sub);
head.append(el('div', 'lbl', wt('view.contributions.label', 'Contributions')), fig);
w.className = 'widget size-' + size;
w.append(head);
if (GRID.cols) w.append(plot);

function levelsOf(weeks) {
  const nz = weeks
    .flatMap(wk => (Array.isArray(wk?.contributionDays) ? wk.contributionDays : []))
    .map(d => Number(d?.contributionCount) || 0)
    .filter(c => c > 0);
  nz.sort((a, b) => a - b);
  const q = p => (nz.length ? nz[Math.floor(p * (nz.length - 1))] : 1);
  const cut = [q(0.25), q(0.5), q(0.75)];
  return c => (c <= 0 ? 0 : c <= cut[0] ? 1 : c <= cut[1] ? 2 : c <= cut[2] ? 3 : 4);
}

let dayFmt = null;
function dayName(iso) {
  try {
    if (!dayFmt) dayFmt = new Intl.DateTimeFormat(LANG, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return dayFmt.format(new Date(iso + 'T00:00:00Z'));
  } catch {
    return iso;
  }
}

function weekColumn(week, level, today) {
  const col = el('div', 'week');
  const slots = Array(7).fill(null);
  for (const d of Array.isArray(week?.contributionDays) ? week.contributionDays : []) {
    if (!d || typeof d !== 'object' || String(d.date) > today) continue;
    const wd = new Date(String(d.date) + 'T00:00:00Z').getUTCDay();
    if (wd >= 0 && wd < 7) slots[wd] = d;
  }
  const known = slots.some(Boolean);
  slots.forEach(d => {
    if (!d) {
      col.append(el('div', known ? 'cell future' : 'cell'));
      return;
    }
    const c = Math.max(0, Number(d.contributionCount) || 0);
    const cell = el('div', `cell l${level(c)}`);
    dayOf.set(cell, { date: String(d.date), count: c });
    col.append(cell);
  });
  return col;
}

function drawGrid(weeks, today) {
  const { cols, bands } = GRID;
  const level = levelsOf(weeks);
  const shown = weeks.slice(-cols * bands);
  while (shown.length < cols * bands) shown.unshift(null);
  plot.replaceChildren();
  for (let b = 0; b < bands; b++) {
    const band = el('div', 'band');
    for (const week of shown.slice(b * cols, (b + 1) * cols)) band.append(weekColumn(week, level, today));
    plot.append(band);
  }
}

function name(text) {
  linkEl.setAttribute('aria-label', text);
}

let marked = null;
function endHover() {
  if (!marked) return;
  marked.classList.remove('on');
  marked = null;
  tip.hidden = true;
}

function hover(e) {
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const day = hit && dayOf.get(hit);
  if (!day) return endHover();
  if (hit === marked) return;
  marked?.classList.remove('on');
  marked = hit;
  hit.classList.add('on');
  tip.textContent = `${dayName(day.date)} · ${formatNumber(day.count)}`;
  tip.hidden = false;
  const r = hit.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const x = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
  const above = r.top - t.height - 6;
  const z = cssZoom();
  tip.style.left = `${x / z}px`;
  tip.style.top = `${(above >= 4 ? above : r.bottom + 6) / z}px`;
}

plot.addEventListener('pointerdown', hover);
plot.addEventListener('pointermove', hover);
plot.addEventListener('pointerleave', endHover);
plot.addEventListener('pointercancel', endHover);
plot.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') endHover(); });
/* Keep every one of these. Safari can skip pointerleave when the pointer leaves the frame. */
document.documentElement.addEventListener('mouseleave', endHover);
window.addEventListener('blur', endHover);
document.addEventListener('visibilitychange', endHover);

function render(data) {
  const now = new Date();
  const cal = Array.isArray(data.slots) ? slotWeeks(data.slots, now) : data;
  const weeks = Array.isArray(cal.weeks) ? cal.weeks : [];
  const total = formatNumber(Math.max(0, Number(cal.totalContributions) || 0));
  endHover();
  linkTo(linkEl, data.profileUrl);
  if (GRID.cols) drawGrid(weeks, isoDay(now));
  num.textContent = total;
  fitText(num);
  sub.textContent = wt('ui.lastYear', 'Past 12 months');
  name(wt('ui.contributionsAria', 'Contributions: {total} in the past 12 months', { total }));
}

const state = errorState({ root: document.body, caption: cap, content: () => [w] });

function boot() {
  linkEl = MOBILE ? w : head;
  linkEl.setAttribute('role', 'img');
  if (MOBILE) head.setAttribute('aria-hidden', 'true');
  name(wt('view.contributions.label', 'Contributions'));
  if (GRID.cols) drawGrid([], isoDay(new Date()));
  poll({
    fetch: () => fetchData('data'),
    interval: TICK_MS,
    render: d => { cap.removeAttribute('aria-hidden'); state.ok(); render(d); },
    onError: ({ error, everOk, stale, since }) => {
      if (!everOk || stale) {
        const line = state.fail(error, { since, inert: everOk });
        name(failureName(line, since));
        cap.setAttribute('aria-hidden', 'true');
      }
    },
  });
}

boot();
