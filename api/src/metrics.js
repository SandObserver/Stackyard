const fs = require('fs');

/* The first line of /proc/stat is aggregate CPU time. Fields after softirq were
   added over time, so a kernel that reports fewer of them yields undefined, and
   undefined coerces to NaN, which then poisons every arithmetic result. Missing
   trailing fields count as zero instead. */
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

/* Busy and iowait as percentages of total CPU time between two /proc/stat
   snapshots (both counters are cumulative). Pure, so the derivation is tested
   without the sampling delay. */
/* A percentage, or 0 for anything that is not a usable number. Guarding dt alone
   is not enough: a NaN in `busy` or `iowait` survives a perfectly good dt and
   reaches the widget, which is how NaN got out before. */
const _pct = v => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);

function computeCpu(a, b) {
  const dt = b.total - a.total;
  /* Not `dt <= 0`: NaN fails every comparison, so a malformed /proc/stat passed
     straight through that guard. */
  if (dt <= 0) return { cpu: 0, iowait: 0 };
  return {
    cpu: _pct(((b.busy - a.busy) / dt) * 100),
    iowait: _pct(((b.iowait - a.iowait) / dt) * 100),
  };
}

/* One sampling window yields both busy% and iowait%, so a widget needing both
   pays a single delay instead of two. */
async function cpuSample() {
  const a = readCpuStat();
  await new Promise(r => setTimeout(r, 500));
  return computeCpu(a, readCpuStat());
}

/* Total number of processes/threads, from the 4th field of /proc/loadavg
   ("runnable/total"); returns the total. */
function procCount() {
  try {
    const f = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/);
    const total = (f[3] || '').split('/')[1];
    return parseInt(total, 10) || 0;
  } catch { return 0; }
}

/* System uptime in whole seconds, from the first field of /proc/uptime. */
function uptimeSeconds() {
  try {
    const v = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]);
    return Number.isFinite(v) ? Math.floor(v) : 0;
  } catch { return 0; }
}

/* MemAvailable is the kernel's own estimate of what a new workload could claim,
   and is the right number when present. It is absent on kernels before 3.14 and
   in some container setups, where the lookup returned 0 and every machine
   reported 100% memory used. Falling back to free plus reclaimable is what tools
   like `free` did before MemAvailable existed: less accurate, but not wrong by
   the whole total. */
function ramPercent() {
  const text = fs.readFileSync('/proc/meminfo', 'utf8');
  const get  = key => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? parseInt(m[1], 10) : null;
  };
  const total = get('MemTotal');
  if (!total || total <= 0) return 0;

  let avail = get('MemAvailable');
  if (avail === null) {
    avail = (get('MemFree') || 0) + (get('Buffers') || 0) + (get('Cached') || 0) + (get('SReclaimable') || 0);
  }
  /* An implausible reading is better reported as zero than as a number that
     looks real. */
  if (!Number.isFinite(avail) || avail < 0 || avail > total) return 0;
  return ((total - avail) / total) * 100;
}

function cpuTemp(zone = 0) {
  try {
    const raw = fs.readFileSync(`/sys/class/thermal/thermal_zone${zone}/temp`, 'utf8').trim();
    const val = parseInt(raw, 10);
    return Number.isNaN(val) ? null : parseFloat((val / 1000).toFixed(1));
  } catch { return null; }
}

function diskStats(mountPoint) {
  try {
    const s = fs.statfsSync(mountPoint);
    const total = s.blocks * s.bsize, avail = s.bavail * s.bsize;
    return { usedPct: total > 0 ? ((total - avail) / total) * 100 : 0, totalGb: total / (1024 ** 3) };
  } catch { return { usedPct: 0, totalGb: 0 }; }
}

module.exports = { cpuSample, computeCpu, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds };
