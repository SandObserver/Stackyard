module.exports = async function (ctx) {
  if (ctx.endpoint === 'devices') return diskDevices(ctx);
  if (ctx.endpoint === 'disk-health') return diskHealth(ctx);
  if (ctx.endpoint === 'speed') return speed(ctx);
  return systemSummary(ctx);
};

function diskDevices(ctx) {
  return ctx.dispatchProvider(
    {
      scrutiny: scrutinyDeviceOptions,
      truenas: truenasPoolOptions,
    },
    { field: 'diskProvider', default: 'scrutiny' },
  );
}

async function scrutinyDeviceOptions(ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  if (!config.scrutinyUrl) ctx.fail('Enter the Scrutiny URL first.', { kind: ctx.KIND.INVALID });
  const r = await fetchJSON(normalizeBase(config.scrutinyUrl) + '/api/summary', { timeout: 8000 });
  if (r.status >= 400) ctx.fail('Scrutiny HTTP ' + r.status);
  const summary = r.data?.data?.summary || {};
  const options = Object.values(summary)
    .filter(e => e.device?.device_id)
    .map(e => ({
      value: e.device.device_id,
      label: e.device.model_name || e.device.device_name || e.device.device_id,
    }));
  return { options };
}

function truenasStatus(ctx, r) {
  if (r.status === 401 || r.status === 403) ctx.fail('TrueNAS auth failed, check API key', { kind: ctx.KIND.AUTH });
  if (r.status === 404) ctx.fail('TrueNAS REST API not found (removed in v26; supported on 25.x, or use Scrutiny)');
  if (r.status >= 400) ctx.fail('TrueNAS HTTP ' + r.status);
}

async function truenasPoolOptions(ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  if (!config.truenasUrl) ctx.fail('Enter the TrueNAS URL first.', { kind: ctx.KIND.INVALID });
  if (!config.truenasKey) ctx.fail('Enter the TrueNAS API key first.', { kind: ctx.KIND.INVALID });
  const r = await fetchJSON(normalizeBase(config.truenasUrl) + '/api/v2.0/pool', {
    headers: { Authorization: 'Bearer ' + config.truenasKey },
    timeout: 8000,
  });
  truenasStatus(ctx, r);
  const options = (Array.isArray(r.data) ? r.data : [])
    .filter(p => p && p.name)
    .map(p => ({ value: p.name, label: p.name }));
  return { options };
}

function diskHealth(ctx) {
  return ctx.dispatchProvider(
    {
      scrutiny: diskHealthScrutiny,
      truenas: diskHealthTrueNas,
    },
    { field: 'diskProvider', default: 'scrutiny' },
  );
}

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

async function diskHealthScrutiny(ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  const url = config.scrutinyUrl;
  if (!url) ctx.fail('scrutinyUrl not configured', { kind: ctx.KIND.INVALID });
  const bays = config.bays || [];

  const base = normalizeBase(url);
  const r = await fetchJSON(base + '/api/summary', { timeout: 8000 });

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
      device_id: deviceId,
      device_status: entry.device.device_status ?? 0,
      hasSmart: !!entry.smart,
      model_name: entry.device.model_name || entry.device.device_serial_id || entry.device.device_name,
      device_name: entry.device.device_name,
      temp: entry.smart?.temp ?? null,
      capacity: entry.device.capacity || null,
    };
  });

  return { bays: result, href: config.scrutinyHref || '', provider: 'scrutiny' };
}

/* A pool's `healthy` flag becomes the per-bay status, in the codes the widget
   already uses for Scrutiny. */
async function diskHealthTrueNas(ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  const url = config.truenasUrl;
  const key = config.truenasKey;
  if (!url) ctx.fail('truenasUrl not configured', { kind: ctx.KIND.INVALID });
  if (!key) ctx.fail('TrueNAS API key not configured', { kind: ctx.KIND.INVALID });
  const bays = config.bays || [];

  const base = normalizeBase(url);
  const r = await fetchJSON(base + '/api/v2.0/pool', {
    headers: { Authorization: 'Bearer ' + key },
    timeout: 8000,
  });
  truenasStatus(ctx, r);

  const byName = {};
  (Array.isArray(r.data) ? r.data : []).forEach(p => {
    if (p && p.name) byName[p.name] = p;
  });

  const result = bays.map(name => {
    if (!name) return null;
    const p = byName[name];
    if (!p) return { device_id: name, device_status: 0, hasSmart: false, error: 'not found' };
    return {
      device_id: name,
      device_status: p.healthy === true ? 0 : 2,
      hasSmart: true,
      model_name: name,
      device_name: name,
      temp: null,
      capacity: p.size != null ? Number(p.size) : null,
    };
  });

  return { bays: result, href: config.truenasHref || '', provider: 'truenas' };
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
