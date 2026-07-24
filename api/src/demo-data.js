/* Synthetic data for demo mode. Every value here is invented; nothing is
   fetched. Numbers drift with time so the dashboard looks alive across polls,
   while structural data (the GitHub calendar) is seeded so it stays stable. */

/* Smooth wave in [min,max], period seconds, plus a little noise. */
function wave(periodSec, min, max, phase = 0) {
  const t = Date.now() / 1000;
  const mid = (min + max) / 2, amp = (max - min) / 2;
  const n = (Math.sin(t / 3) * 0.04);
  return mid + amp * Math.sin((t / periodSec) * 2 * Math.PI + phase) + amp * n;
}
const round = (v, d = 0) => { const f = 10 ** d; return Math.round(v * f) / f; };

const metrics = {
  cpuPercent: () => round(wave(40, 8, 46)),
  cpuIoWait:  () => round(wave(55, 0.2, 2.4, 1), 1),
  ramPercent: () => round(wave(90, 54, 68)),
  diskStats:  (mount) => ({ usedPct: mount === '/' ? 61.4 : 78.2, totalGb: mount === '/' ? 467 : 1863 }),
  cpuTemp:    () => round(wave(70, 44, 53, 2)),
  procCount:  () => Math.round(wave(120, 306, 334)),
  uptimeSeconds: () => 1_512_540 + Math.floor(Date.now() / 1000) % 86400,
};

function githubCalendar() {
  const COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
  let seed = 1337, total = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const weeks = [];
  const start = new Date(); start.setDate(start.getDate() - 52 * 7);
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const r = rnd();
      const count = r < 0.45 ? 0 : Math.floor(rnd() * 14) + 1;
      total += count;
      const lvl = count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;
      const date = new Date(start); date.setDate(start.getDate() + w * 7 + d);
      days.push({ contributionCount: count, date: date.toISOString().slice(0, 10), color: COLORS[lvl] });
    }
    weeks.push({ contributionDays: days });
  }
  return { view: 'contributions', weeks, totalContributions: total };
}
let _cal = null;

function demoWidgetBody(widgetType, wc) {
  switch (widgetType) {
    case 'backup':
      return demoBackup(wc);
    case 'dns': {
      const total = Math.round(wave(600, 46000, 52000));
      const blocked = Math.round(total * 0.19);
      const hourly = (base) => Array.from({ length: 24 }, (_, h) => Math.round(base * (0.4 + 0.6 * Math.abs(Math.sin(h / 3.8)))));
      return {
        num_dns_queries: total, num_blocked_filtering: blocked,
        num_cached: Math.round(total * 0.31), num_forwarded: Math.round(total * 0.5),
        dns_queries: hourly(total / 24), blocked_filtering: hourly(blocked / 24),
      };
    }
    case 'nowplaying':
      /* progress is 0..1 per the widget contract, and sweeps nearly the whole
         range so the tape winds visibly between polls. */
      return { provider: 'jellyfin', sessions: [
        { title: 'Interstellar', subtitle: '2014 · 2160p', progress: round(wave(300, 0.04, 0.96), 3), state: 'playing', type: 'movie', player: 'Living Room TV' },
        { title: 'Time', subtitle: 'Hans Zimmer', progress: round(wave(220, 0.04, 0.96, 2), 3), state: 'paused', type: 'audio', player: 'Kitchen Speaker' },
      ] };
    case 'books':
      return { provider: 'audiobookshelf', source: 'unread', books: [
        { title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', progress: round(wave(900, 0.05, 0.95), 3), finished: false, color: null, kind: 'book' },
        { title: 'Piranesi', author: 'Susanna Clarke', progress: round(wave(700, 0.05, 0.95, 1.7), 3), finished: false, color: null, kind: 'book' },
        { title: 'The Dispossessed', author: 'Ursula K. Le Guin', progress: 1, finished: true, color: null, kind: 'book' },
        { title: 'Klara and the Sun', author: 'Kazuo Ishiguro', progress: null, finished: false, color: null, kind: 'book' },
      ] };
    case 'weather':
      return { temp: Math.round(wave(3600, 16, 21)), usedFeels: true, units: 'c', code: 1, isDay: true, city: 'San Francisco, California, USA' };
    case 'github':
      if (!_cal) _cal = githubCalendar();
      return _cal;
    default:
      return null;
  }
}

function demoBadges(items) {
  const preset = { 'app-jellyfin': 2, 'app-portainer': 12 };
  const out = {};
  for (const i of items || []) {
    if (i?.type === 'app' && i.monitoring?.activity?.enabled) out[i.id] = { value: preset[i.id] ?? 1 };
  }
  return out;
}
function demoHealth(items) {
  const out = {};
  for (const i of items || []) {
    if (i?.type === 'app' && i.monitoring?.healthcheck?.enabled) out[i.id] = { unhealthy: i.id === 'app-grafana' };
  }
  return out;
}

function demoBackup(wc) {
  const slots = Array.isArray(wc?.slots) ? wc.slots : [];
  const now = Date.now();
  return slots.map((s, i) => ({
    id: 'demo-' + i,
    name: s.customName || 'Backup',
    provider: s.provider || 'duplicati',
    status: 'healthy',
    lastFinished: new Date(now - 3 * 3600 * 1000).toISOString(),
    nextRun: new Date(now + 21 * 3600 * 1000).toISOString(),
    size: '42.7 GB',
    href: '',
  }));
}

module.exports = { metrics, demoWidgetBody, demoBadges, demoHealth, demoBackup };
