import { poll, fetchData, openUrl, html, setHtml, loadStrings, wt, wtCount, formatNumber, formatList, formatBytes, errorState, cssZoom, twoTap } from '/js/widget-toolbox.js?v=039ea657';
await loadStrings();
document.getElementById('root').setAttribute('aria-label', wt('ui.diskHealth','Disk health'));
const params    = new URLSearchParams(location.search);
const size      = params.get('size') || 'small';
const BAY_COUNT = size === 'medium' ? 10 : 4;
const isMobile  = params.get('mobile') === '1';

const rootEl = document.getElementById('root');
rootEl.classList.remove('size-small','size-medium');
rootEl.classList.add(size === 'medium' ? 'size-medium' : 'size-small');

if (isMobile) {
  const s = document.createElement('style');
  s.textContent = `#panel { padding:9px; padding-inline-end:0; }`;
  document.head.appendChild(s);
}

/* A bay the service did not report. Its status fields are placeholders.
   Reading them draws a missing drive as healthy. */
const unread = d => !!(d && d.error);

function ledClass(s, hasSmart) {
  if (!hasSmart) return '';
  return s === 0 ? 'green' : 'red';
}
function statusText(s, hasSmart) {
  if (!hasSmart) return wt('ui.noSmart','No SMART data');
  return s === 0 ? wt('ui.healthy','Healthy') : wt('ui.failed','Failed');
}
const CAP = { min: 'gigabyte', max: 'terabyte', digits: (v, u) => (u === 'terabyte' && v < 10 ? 1 : 0) };
function fmtCap(c){ return Number(c) > 0 ? formatBytes(Number(c), CAP) : ''; }
function freeText(d) {
  if (d.free == null) return '';
  return wt('ui.freeOf', '{free} / {size} free', {
    free: formatBytes(Math.max(0, Number(d.free) || 0), CAP),
    size: fmtCap(d.fsTotal),
  });
}
function shortName(d) {
  const n = (d.device_name || '').replace(/^\/dev\//, '');
  return n ? n.toUpperCase() : (d.device?.label || d.label || '');
}
function fullName(d) { return d.model_name || d.device?.label || shortName(d); }
function deviceHref(d) {
  if (!_href) return '';
  if (_provider !== 'scrutiny') return _href;
  if (!d || !d.device_id) return _href;
  return _href.replace(/\/+$/, '') + '/web/device/' + encodeURIComponent(d.device_id);
}

let bayData   = new Array(BAY_COUNT).fill(null);
let _href     = '';
let _provider = 'scrutiny';
let bayEls    = [];

const tipEl   = document.getElementById('tip');
const tipLed  = document.getElementById('tip-led');
const tipName = document.getElementById('tip-name');
const tipMeta = document.getElementById('tip-meta');
const tipFree = document.getElementById('tip-free');

function showTip(i) {
  const d = bayData[i];
  if (!d) return;
  if (unread(d)) {
    tipLed.className = 'unread';
    tipName.textContent = fullName(d) || wt('ui.bay', 'Bay {n}', { n: formatNumber(i + 1) });
    tipMeta.textContent = wt('ui.notReporting', 'Not reporting');
    tipFree.hidden = true;
    rootEl.classList.add('tip-active');
    positionTip(i);
    return;
  }
  const lc = ledClass(d.device_status ?? 0, d.hasSmart ?? false);
  tipLed.className = lc || '';
  tipName.textContent = fullName(d);
  const parts = [];
  const cap = fmtCap(d.capacity);
  if (cap && d.free == null) parts.push(cap);
  parts.push(statusText(d.device_status ?? 0, d.hasSmart ?? false));
  if (d.temp != null) parts.push(formatNumber(Number(d.temp)) + '°C');
  tipMeta.textContent = parts.filter(Boolean).join(' · ');
  tipFree.textContent = freeText(d);
  tipFree.hidden = d.free == null;
  rootEl.classList.add('tip-active');
  positionTip(i);
}
function hideTip() { rootEl.classList.remove('tip-active'); }

function positionTip(i) {
  const bay = bayEls[i];
  const z = cssZoom();
  const unzoom = r => ({ left:r.left/z, top:r.top/z, width:r.width/z, height:r.height/z, bottom:r.bottom/z });
  const rootRect = unzoom(rootEl.getBoundingClientRect());
  const bayRect  = unzoom(bay.getBoundingClientRect());
  tipEl.style.left = '0px'; tipEl.style.top = '0px';
  tipEl.style.maxWidth = (rootRect.width - 8) + 'px';
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  const bayCx = (bayRect.left - rootRect.left) + bayRect.width / 2;
  let left = bayCx - tw / 2;
  left = Math.max(4, Math.min(left, rootRect.width - tw - 4));
  let top = (bayRect.top - rootRect.top) - th - 6;
  if (top < 4) top = (bayRect.bottom - rootRect.top) + 6;
  if (top + th > rootRect.height - 4) top = rootRect.height - th - 8;
  top = Math.max(4, top);
  tipEl.style.left = Math.round(left) + 'px';
  tipEl.style.top  = Math.round(top) + 'px';
}

function build() {
  const baysEl = document.getElementById('bays');
  const numsEl = document.getElementById('nums');
  baysEl.replaceChildren(); numsEl.replaceChildren();
  bayEls = [];
  for (let i = 0; i < BAY_COUNT; i++) {
    const bay = document.createElement('div');
    bay.className = 'bay';
    setHtml(bay, html`<div class="bay-name" id="nm-${i}"></div><i class="led" id="led-${i}"></i>`);
    baysEl.appendChild(bay);
    bayEls.push(bay);

    const num = document.createElement('span');
    num.textContent = formatNumber(i + 1);
    numsEl.appendChild(num);

    addEvents(bay, i);
  }
}

function update() {
  for (let i = 0; i < BAY_COUNT; i++) {
    const d   = bayData[i];
    const bay = bayEls[i];
    const nm  = document.getElementById(`nm-${i}`);
    const led = document.getElementById(`led-${i}`);
    if (unread(d)) {
      bay.classList.add('unread'); bay.classList.remove('empty', 'assigned');
      led.className = 'led unread';
      nm.textContent = shortName(d);
      bay.setAttribute('role', 'img'); bay.removeAttribute('tabindex');
      bay.setAttribute('aria-label',
        `${wt('ui.bay','Bay {n}', { n: formatNumber(i + 1) })}: ${wt('ui.notReporting','Not reporting')}`);
    } else if (d) {
      bay.classList.add('assigned'); bay.classList.remove('empty', 'unread');
      const lc = ledClass(d.device_status ?? 0, d.hasSmart ?? false);
      led.className = lc ? 'led ' + lc : 'led';
      nm.textContent = shortName(d);
      const cap = fmtCap(d.capacity);
      const st  = statusText(d.device_status ?? 0, d.hasSmart ?? false);
      bay.setAttribute('role','button'); bay.setAttribute('tabindex','0');
      bay.setAttribute('aria-label', `${wt('ui.bay','Bay {n}', { n: formatNumber(i + 1) })}: ${shortName(d)}${d.free != null ? ', '+freeText(d) : cap ? ', '+cap : ''}${st ? ', '+st : ''}`);
    } else {
      bay.classList.add('empty'); bay.classList.remove('assigned', 'unread');
      led.className = 'led';
      nm.textContent = '';
      bay.setAttribute('role','img'); bay.removeAttribute('tabindex');
      bay.setAttribute('aria-label', wt('ui.bayEmpty','Bay {n}: empty', { n: formatNumber(i + 1) }));
    }
  }
  updateAlert();
}

/* Names failed bays in words, so a failure does not rest on the LED colour. */
function updateAlert() {
  const failed = [];
  bayData.forEach((d, i) => {
    if (d && !unread(d) && ledClass(d.device_status ?? 0, d.hasSmart ?? false) === 'red') failed.push(formatNumber(i + 1));
  });
  const alertEl = document.getElementById('alert');
  alertEl.hidden = !failed.length;
  document.getElementById('nums').hidden = failed.length > 0;
  alertEl.textContent = wtCount('ui.baysFailed', failed.length, { one: 'Bay {list} failed', other: 'Bays {list} failed' }, { list: formatList(failed) });
}

function openBay(i) {
  const d = bayData[i]; if (!d || unread(d)) return;
  const u = deviceHref(d); if (u) openUrl(u);
}

function addEvents(bay, i) {
  let lastPointer = '';
  bay.addEventListener('pointerdown', e => { lastPointer = e.pointerType; });
  bay.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && bayData[i]) showTip(i); });
  bay.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideTip(); });
  bay.addEventListener('click', () => { if (lastPointer !== 'touch') openBay(i); });
  bay.addEventListener('keydown', e => { if ((e.key==='Enter'||e.key===' ') && bayData[i]) { e.preventDefault(); openBay(i); } });
  bay.addEventListener('focus', () => { if (bayData[i]) showTip(i); });
  bay.addEventListener('blur',  () => hideTip());
  twoTap(bay, {
    canReveal: () => !!bayData[i],
    reveal: () => { bay.classList.add('touch-active'); showTip(i); },
    conceal: () => { bay.classList.remove('touch-active'); hideTip(); },
    open: () => openBay(i),
  });
}

function applyBays(d) {
  _href   = d.href || '';
  _provider = d.provider || 'scrutiny';
  bayData = d.bays.map(b => b || null);
  while (bayData.length < BAY_COUNT) bayData.push(null);
  bayData = bayData.slice(0, BAY_COUNT);
  update();
}

build();
update();

const sysLed = document.getElementById('sysled');
const state = errorState({
  root: document.getElementById('root'),
  content: document.getElementById('shell'),
  place: 'center',
});

poll({
  fetch: () => fetchData('disk-health'),
  interval: 60_000,
  render: d => { state.ok(); sysLed.classList.add('green'); applyBays(d); },
  isEmpty: d => !d || !Array.isArray(d.bays) || d.bays.length === 0,
  onEmpty: () => state.empty(wt('ui.noDrives', 'No drives reported')),
  onError: ({ error, everOk, stale, since }) => {
    if (!everOk || stale) { sysLed.classList.remove('green'); state.fail(error, { since, inert: everOk }); }
  },
});
