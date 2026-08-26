function wave(periodSec, min, max, phase = 0) {
  const t = Date.now() / 1000;
  const mid = (min + max) / 2,
    amp = (max - min) / 2;
  const n = Math.sin(t / 3) * 0.04;
  return mid + amp * Math.sin((t / periodSec) * 2 * Math.PI + phase) + amp * n;
}
const round = (v, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

const metrics = {
  cpuSample: () => ({ cpu: round(wave(40, 8, 46)), iowait: round(wave(55, 0.2, 2.4, 1), 1) }),
  ramPercent: () => round(wave(90, 54, 68)),
  diskStats: mount => ({ usedPct: mount === '/' ? 61.4 : 78.2, totalGb: mount === '/' ? 467 : 1863 }),
  cpuTemp: () => round(wave(70, 44, 53, 2)),
  procCount: () => Math.round(wave(120, 306, 334)),
  uptimeSeconds: () => 1_512_540 + (Math.floor(Date.now() / 1000) % 86400),
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
