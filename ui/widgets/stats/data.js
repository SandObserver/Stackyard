/* Stats widget data function. Two endpoints:
     endpoint=system        → live host metrics for the System Summary view
     endpoint=disk-health   → SMART data from Scrutiny for the Disk Health view
   Returns { error } on failure (never throws). */

module.exports = async function (ctx) {
  if (ctx.endpoint === 'disk-health') return diskHealth(ctx);
  return systemSummary(ctx);
};

/* Disk Health dispatch — Scrutiny (per-disk SMART) or TrueNAS (per-pool health). */
function diskHealth(ctx) {
  return ctx.dispatchProvider({
    scrutiny: diskHealthScrutiny,
    truenas:  diskHealthTrueNas,
  }, { field: 'diskProvider', default: 'scrutiny' });
}

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

  /* IO wait costs a second sampling window, so only measure it when a slot asks for it. */
  const iowait = slots.some(s => s.type === 'iowait') ? await metrics.cpuIoWait() : null;
  const procs  = metrics.procCount();
  const uptime = metrics.uptimeSeconds();

  const zones = new Set([0]);
  for (const s of slots) if (s.type === 'temp' && Number.isInteger(s.thermalZone)) zones.add(s.thermalZone);
  const temps = {};
  for (const z of zones) { const t = metrics.cpuTemp(z); if (t !== null) temps[z] = t; }

  return { cpu, ram, temp: temps[0] ?? null, temps, disks, iowait, procs, uptime };
}

/* Disk Health (Scrutiny) — maps the widget's configured bays (device_id per bay)
   onto Scrutiny's SMART summary. */
async function diskHealthScrutiny({ config, fetchJSON }) {
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

  return { bays: result, href: config.scrutinyHref || '', provider: 'scrutiny' };
}

/* Disk Health (TrueNAS) — each configured bay holds a ZFS pool name; pools are
   matched from /api/v2.0/pool. A pool's `healthy` flag is the per-bay status
   (healthy → 0, unhealthy → 2, the same codes the widget uses for Scrutiny). */
async function diskHealthTrueNas({ config, fetchJSON }) {
  const url = config.truenasUrl;
  const key = config.truenasKey;
  if (!url) return { error: 'truenasUrl not configured' };
  if (!key) return { error: 'TrueNAS API key not configured' };
  const bays = config.bays || [];

  let r;
  try {
    const base = url.includes('://') ? url.replace(/\/$/, '') : `http://${url.replace(/\/$/, '')}`;
    r = await fetchJSON(base + '/api/v2.0/pool', {
      headers: { Authorization: 'Bearer ' + key }, timeout: 8000,
    });
  } catch (e) { return { error: e.message }; }

  if (r.status === 401 || r.status === 403) return { error: 'TrueNAS auth failed — check API key' };
  if (r.status >= 400) return { error: 'TrueNAS HTTP ' + r.status };

  const byName = {};
  (Array.isArray(r.data) ? r.data : []).forEach(p => { if (p && p.name) byName[p.name] = p; });

  const result = bays.map(name => {
    if (!name) return null;
    const p = byName[name];
    if (!p) return { device_id: name, device_status: 0, hasSmart: false, error: 'not found' };
    return {
      device_id:     name,
      device_status: p.healthy === true ? 0 : 2,
      hasSmart:      true,
      model_name:    name,
      device_name:   name,
      temp:          null,
      capacity:      (p.size != null ? Number(p.size) : null),
    };
  });

  return { bays: result, href: config.truenasHref || '', provider: 'truenas' };
}
