let _timezone = '';
let _showDate = true;
let _tickId   = null;

const _lang = new URLSearchParams(location.search).get('lang') || 'en';
let _dateLong = null, _dateShort = null, _zoneTime = null, _two = null, _nextMinute = null;
function _a11yLabel(now, t){
  const hh=String(t.hours).padStart(2,'0'), mm=String(t.minutes).padStart(2,'0');
  return `${hh}:${mm}, ${_dateLong(now)}`;
}

function layout() {
  const [hy, my] = _showDate ? [82, 116] : [88, 124];
  for (const k of ['hh', 'hh-over']) document.getElementById(k).setAttribute('y', hy);
  for (const k of ['mm', 'mm-clip']) document.getElementById(k).setAttribute('y', my);
  document.getElementById('date-line').style.display = _showDate ? '' : 'none';
}

function fitDate(el) {
  el.style.fontSize = '';
  let size = 13.77;
  while (el.scrollWidth > el.clientWidth && size > 8.5) {
    size -= 0.51;
    el.style.fontSize = size + 'px';
  }
}

function tick() {
  const now = new Date(), t = _zoneTime(now);
  document.getElementById('widget').setAttribute('aria-label', _a11yLabel(now, t));
  const hh = _two(t.hours), mm = _two(t.minutes);
  for (const k of ['hh', 'hh-over']) document.getElementById(k).textContent = hh;
  for (const k of ['mm', 'mm-clip']) document.getElementById(k).textContent = mm;
  if (_showDate) {
    const dl = document.getElementById('date-line');
    dl.textContent = _dateShort(now);
    fitDate(dl);
  }
  if (_tickId) clearTimeout(_tickId);
  _tickId = setTimeout(tick, _nextMinute(now));
}

async function boot() {
  const [toolbox, dates] = await Promise.all([
    import('/js/widget-toolbox.js?v=039ea657'),
    import('/js/clock-date.js?v=91a77e74'),
  ]);
  const settings = await dates.clockSettings(toolbox.getConfig);
  _timezone = settings.timeZone;
  _showDate = settings.showDate;
  if (!dates.zoneOk(_timezone)) return dates.showUnknownZone(toolbox, document.getElementById('widget'));
  const { clockDateFormatter, zoneTime } = dates;
  _zoneTime = zoneTime(_timezone);
  _dateLong = clockDateFormatter(_lang, 'long', _timezone);
  _dateShort = clockDateFormatter(_lang, 'short', _timezone);
  _two = dates.twoDigits(_lang);
  _nextMinute = dates.msToNextMinute;
  layout();
  tick();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && _zoneTime) tick();
});

boot();
