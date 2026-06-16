/* Stats widget data function. Two endpoints:
     endpoint=system        → live host metrics for the System Summary view
     endpoint=disk-health   → SMART data from Scrutiny for the Disk Health view
   Returns { error } on failure (never throws). */

module.exports = async function (ctx) {
  if (ctx.endpoint === 'disk-health') return diskHealth(ctx);
  return systemSummary(ctx);
};

/* System Summary — CPU / RAM / temperature / per-mount disk usage.
   Mount paths come from the widget's disk slots; falls back to the global
   stats.diskMount setting, then '/'. */
async function systemSummary({ config, settings, metrics }) {
  const slots = config.slots || [];

  const mounts = new Set();
  for (const s of slots) {
    if (s.type !== 'disk') continue;
    if (s.primary)   mounts.add(s.primary);
    if (s.secondary) mounts.add(s.secondary);
  }
  if (!mounts.size) mounts.add(settings?.stats?.diskMount || '/');

  const cpu   = await metrics.cpuPercent();
  const disks = [...mounts].map(m => ({ mount: m, ...metrics.diskStats(m) }));
  const ram   = metrics.ramPercent();

  const zones = new Set([0]);
  for (const s of slots) if (s.type === 'temp' && Number.isInteger(s.thermalZone)) zones.add(s.thermalZone);
  const temps = {};
  for (const z of zones) { const t = metrics.cpuTemp(z); if (t !== null) temps[z] = t; }

  return { cpu, ram, temp: temps[0] ?? null, temps, disks };
}

/* Disk Health — maps the widget's configured bays (device_id per bay) onto
   Scrutiny's SMART summary. */
async function diskHealth({ config, fetchJSON }) {
  const url = config.scrutinyUrl;
  if (!url) return { error: 'scrutinyUrl not configured' };
  const bays = config.bays || [];

  let r;
  try {
    const base = url.includes('://') ? url.replace(/\/$/, '') : `http://${url.replace(/\/$/, '')}`;
    r = await fetchJSON(base + '/api/summary', { timeout: 8000 });
  } catch (e) { return { error: e.message }; }

  const summary = r.data?.data?.summary || {};
  const byId = {};
  Object.values(summary).forEach(entry => {
    if (entry.device?.device_id) byId[entry.device.device_id] = entry;
  });

  const result = bays.map(deviceId => {
    if (!deviceId) return null;
    const entry = byId[deviceId];
    if (!entry) return { device_id: deviceId, device_status: 0, hasSmart: false, error: 'not found' };
    return {
      device_id:     deviceId,
      device_status: entry.device.device_status ?? 0,
      hasSmart:      !!(entry.smart),
      model_name:    entry.device.model_name || entry.device.device_serial_id || entry.device.device_name,
      device_name:   entry.device.device_name,
      temp:          entry.smart?.temp ?? null,
      capacity:      entry.device.capacity || null,
    };
  });

  return { bays: result, href: config.scrutinyHref || '' };
}
