function waveAt(t, periodSec, min, max, phase = 0) {
  const mid = (min + max) / 2,
    amp = (max - min) / 2;
  const n = Math.sin(t / 3) * 0.04;
  return mid + amp * Math.sin((t / periodSec) * 2 * Math.PI + phase) + amp * n;
}

function wave(periodSec, min, max, phase = 0) {
  return waveAt(Date.now() / 1000, periodSec, min, max, phase);
}
const round = (v, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/* One curve per metric, so a value and its history cannot drift apart:
   [periodSec, min, max, phase, decimals]. */
const CURVES = {
  cpu: [40, 8, 46, 0, 0],
  iowait: [55, 0.2, 2.4, 1, 1],
  ram: [90, 54, 68, 0, 0],
  temp: [70, 44, 53, 2, 0],
  procs: [120, 306, 334, 0, 0],
};

function at(kind, t) {
  const [period, min, max, phase, decimals] = CURVES[kind];
  return round(waveAt(t, period, min, max, phase), decimals);
}

/* Oldest first, ending at the value `at` returns now, so a chart seeded from
   this runs continuously into the next live tick. */
function series(kind, count, stepSec) {
  const now = Date.now() / 1000;
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(at(kind, now - i * stepSec));
  return out;
}

const metrics = {
  cpuSample: () => ({ cpu: at('cpu', Date.now() / 1000), iowait: at('iowait', Date.now() / 1000) }),
  ramPercent: () => at('ram', Date.now() / 1000),
  diskStats: mount => ({ usedPct: mount === '/' ? 61.4 : 78.2, totalGb: mount === '/' ? 467 : 1863 }),
  cpuTemp: () => at('temp', Date.now() / 1000),
  procCount: () => at('procs', Date.now() / 1000),
  uptimeSeconds: () => 1_512_540 + (Math.floor(Date.now() / 1000) % 86400),
  series,
};

function demoBadges(items) {
  const preset = Object.assign(Object.create(null), { 'app-jellyfin': 2, 'app-portainer': 12 });
  const out = Object.create(null);
  for (const i of items || []) {
    if (i?.type !== 'app' || !i.monitoring?.activity?.enabled) continue;
    const labels = i.monitoring.activity.labels;
    if (!i.monitoring.activity.combine && Array.isArray(labels) && labels.length) {
      const values = labels.map((_, n) => round(wave(30 + n * 11, 0, 9 + n * 37, n)));
      const at = values.findIndex(v => v >= 1);
      out[i.id] = { value: at === -1 ? 0 : values[at], values };
    } else out[i.id] = { value: preset[i.id] ?? 1 };
  }
  return out;
}
function demoHealth(items) {
  const out = Object.create(null);
  for (const i of items || []) {
    if (i?.type === 'app' && i.monitoring?.healthcheck?.enabled) out[i.id] = { unhealthy: i.id === 'app-grafana' };
  }
  return out;
}

const helpers = { wave, round };

module.exports = { metrics, helpers, demoBadges, demoHealth };
