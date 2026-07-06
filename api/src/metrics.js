const fs = require('fs');

function readCpuStat() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const [, user, nice, sys, idle, iowait, irq, softirq, steal] = line.split(/\s+/).map(Number);
  const total = user + nice + sys + idle + iowait + irq + softirq + steal;
  return { total, busy: total - idle - iowait, iowait };
}

async function cpuPercent() {
  const a = readCpuStat();
  await new Promise(r => setTimeout(r, 500));
  const b = readCpuStat();
  const dt = b.total - a.total;
  return dt > 0 ? Math.min(100, ((b.busy - a.busy) / dt) * 100) : 0;
}

/* IO wait as a percentage of total CPU time over a short sampling window, the
   same delta approach as cpuPercent (both counters are cumulative). */
async function cpuIoWait() {
  const a = readCpuStat();
  await new Promise(r => setTimeout(r, 500));
  const b = readCpuStat();
  const dt = b.total - a.total;
  return dt > 0 ? Math.min(100, Math.max(0, ((b.iowait - a.iowait) / dt) * 100)) : 0;
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

function ramPercent() {
  const text = fs.readFileSync('/proc/meminfo', 'utf8');
  const get  = key => { const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm')); return m ? parseInt(m[1], 10) : 0; };
  const total = get('MemTotal'), avail = get('MemAvailable');
  return total > 0 ? ((total - avail) / total) * 100 : 0;
}

function cpuTemp(zone = 0) {
  try {
    const raw = fs.readFileSync(`/sys/class/thermal/thermal_zone${zone}/temp`, 'utf8').trim();
    const val = parseInt(raw, 10);
    return isNaN(val) ? null : parseFloat((val / 1000).toFixed(1));
  } catch { return null; }
}

function diskStats(mountPoint) {
  try {
    const s = fs.statfsSync(mountPoint);
    const total = s.blocks * s.bsize, avail = s.bavail * s.bsize;
    return { usedPct: total > 0 ? ((total - avail) / total) * 100 : 0, totalGb: total / (1024 ** 3) };
  } catch { return { usedPct: 0, totalGb: 0 }; }
}

module.exports = { cpuPercent, cpuIoWait, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds };
