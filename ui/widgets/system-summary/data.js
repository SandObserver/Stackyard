module.exports = async function (ctx) {
  if (ctx.endpoint === 'speed') return speed(ctx);
  return systemSummary(ctx);
};

/* Mount paths come from the widget's disk slots, then the global
   stats.diskMount setting, then '/'. */
async function systemSummary({ config, settings, metrics }) {
  const slots = config.slots || [];

  const mounts = new Set();
  for (const s of slots) {
    if (s.type !== 'disk') continue;
    if (s.primary) mounts.add(s.primary);
    if (s.secondary) mounts.add(s.secondary);
  }
  if (!mounts.size) mounts.add(settings?.stats?.diskMount || '/');

  const { cpu, iowait: iowaitPct } = await metrics.cpuSample();
  const disks = [...mounts].map(m => ({ mount: m, ...metrics.diskStats(m) }));
  const ram = metrics.ramPercent();

  const iowait = slots.some(s => s.type === 'iowait') ? iowaitPct : null;
  const procs = metrics.procCount();
  const uptime = metrics.uptimeSeconds();

  const zones = new Set([0]);
  for (const s of slots) if (s.type === 'temp' && Number.isInteger(s.thermalZone)) zones.add(s.thermalZone);
  const temps = {};
  for (const z of zones) {
    const t = metrics.cpuTemp(z);
    if (t !== null) temps[z] = t;
  }

  return { cpu, ram, temp: temps[0] ?? null, temps, disks, iowait, procs, uptime };
}

/* The provider lives in the nested network slot, so this branches directly
   rather than through ctx.dispatchProvider, which reads a top-level field. */
async function speed(ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  const net = config.network;
  if (!net?.enabled || !net?.url) ctx.fail('network slot not configured', { kind: ctx.KIND.INVALID });
  const base = normalizeBase(net.url);

  if ((net.provider || 'myspeed') === 'speedtest-tracker') {
    const r = await fetchJSON(base + '/api/speedtest/latest', { timeout: 8000 });
    const row = r.data?.data;
    if (!row?.id) ctx.fail('No result from Speedtest Tracker');
    return {
      download: row.download,
      upload: row.upload,
      ping: row.ping,
      failed: row.failed || false,
      ts: row.created_at,
    };
  }
  const headers = {};
  if (net.myspeedPass) headers['x-password'] = net.myspeedPass;
  const r = await fetchJSON(base + '/api/speedtests?limit=1', { headers, timeout: 8000 });
  if (r.status === 401) ctx.fail('MySpeed returned 401, check password', { kind: ctx.KIND.AUTH });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!row) ctx.fail('No result from MySpeed');
  return { download: row.download, upload: row.upload, ping: row.ping, failed: false, ts: row.created };
}
