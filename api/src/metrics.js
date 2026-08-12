const fs = require('fs');

/* A kernel reporting fewer fields yields undefined. That becomes NaN and
   poisons every later result. */
function readCpuStat() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const [, ...rest] = line.trim().split(/\s+/);
  const [user, nice, sys, idle, iowait, irq, softirq, steal] = rest.map(v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
  const total = user + nice + sys + idle + iowait + irq + softirq + steal;
  return { total, busy: total - idle - iowait, iowait };
}

const _pct = v => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);

function computeCpu(a, b) {
  const dt = b.total - a.total;
  if (dt <= 0) return { cpu: 0, iowait: 0 };
  return {
    cpu: _pct(((b.busy - a.busy) / dt) * 100),
    iowait: _pct(((b.iowait - a.iowait) / dt) * 100),
  };
}

async function cpuSample() {
  const a = readCpuStat();
  await new Promise(r => setTimeout(r, 500));
  return computeCpu(a, readCpuStat());
}

/* The 4th field of /proc/loadavg is "runnable/total". */
function procCount() {
  try {
    const f = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/);
    const total = (f[3] || '').split('/')[1];
    return parseInt(total, 10) || 0;
  } catch {
    return 0;
  }
}

/* The first field of /proc/uptime is seconds. */
function uptimeSeconds() {
  try {
    const v = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]);
    return Number.isFinite(v) ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

/* MemAvailable is absent on some kernels and container setups. Treating it as 0
   reports every machine at 100% used. */
function ramPercent() {
  const text = fs.readFileSync('/proc/meminfo', 'utf8');
  const get = key => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? parseInt(m[1], 10) : null;
  };
  const total = get('MemTotal');
  if (!total || total <= 0) return 0;

  let avail = get('MemAvailable');
  if (avail === null) {
    avail = (get('MemFree') || 0) + (get('Buffers') || 0) + (get('Cached') || 0) + (get('SReclaimable') || 0);
  }
  if (!Number.isFinite(avail) || avail < 0 || avail > total) return 0;
  return ((total - avail) / total) * 100;
}

function cpuTemp(zone = 0) {
  try {
    const raw = fs.readFileSync(`/sys/class/thermal/thermal_zone${zone}/temp`, 'utf8').trim();
    const val = parseInt(raw, 10);
    return Number.isNaN(val) ? null : parseFloat((val / 1000).toFixed(1));
  } catch {
    return null;
  }
}

function diskStats(mountPoint) {
  try {
    const s = fs.statfsSync(mountPoint);
    const total = s.blocks * s.bsize,
      avail = s.bavail * s.bsize;
    return { usedPct: total > 0 ? ((total - avail) / total) * 100 : 0, totalGb: total / 1024 ** 3 };
  } catch {
    return { usedPct: 0, totalGb: 0 };
  }
}

module.exports = { cpuSample, computeCpu, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds };
