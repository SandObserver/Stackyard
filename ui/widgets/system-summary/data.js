module.exports = async function (ctx) {
  if (ctx.endpoint === 'speed') return speed(ctx);
  if (ctx.endpoint === 'sensors') return glancesSensorOptions(ctx);
  return systemSummary(ctx);
};

function systemSummary(ctx) {
  return ctx.dispatchProvider(
    {
      system: systemSummaryLocal,
      glances: systemSummaryGlances,
    },
    { field: 'statProvider', default: 'system' },
  );
}

/* Mount paths come from the widget's disk slots, then the global
   stats.diskMount setting, then '/'. */
async function systemSummaryLocal({ config, settings, metrics }) {
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

/* Glances serves the same fields under /api/4 and /api/3, and offers no way to
   ask which it speaks. One probe per host settles it, shared by every call in
   the poll and remembered afterwards. */
const API_VERSIONS = [4, 3];
const _apiVersion = new Map();

function glancesAuth(config) {
  if (!config.glancesUser && !config.glancesPass) return {};
  const pair = `${config.glancesUser || ''}:${config.glancesPass || ''}`;
  return { Authorization: 'Basic ' + Buffer.from(pair).toString('base64') };
}

function glancesVersion(ctx, base, headers) {
  const known = _apiVersion.get(base);
  if (known) return known;
  const probe = (async () => {
    let last = 0;
    for (const v of API_VERSIONS) {
      const r = await ctx.fetchJSON(`${base}/api/${v}/uptime`, { headers, timeout: 8000 });
      if (r.status === 401) ctx.fail('Glances returned 401, check the username and password', { kind: ctx.KIND.AUTH });
      if (r.status < 400) return v;
      last = r.status;
    }
    ctx.fail('Glances HTTP ' + last);
  })();
  /* A failed probe must not be the cached answer for every later poll. */
  _apiVersion.set(
    base,
    probe.catch(e => {
      _apiVersion.delete(base);
      throw e;
    }),
  );
  return _apiVersion.get(base);
}

async function glancesGet(ctx, plugin) {
  const { config, fetchJSON, normalizeBase } = ctx;
  if (!config.glancesUrl) ctx.fail('Enter the Glances URL first.', { kind: ctx.KIND.INVALID });
  const base = normalizeBase(config.glancesUrl);
  const headers = glancesAuth(config);
  const version = await glancesVersion(ctx, base, headers);
  const r = await fetchJSON(`${base}/api/${version}/${plugin}`, { headers, timeout: 8000 });
  if (r.status === 401) ctx.fail('Glances returned 401, check the username and password', { kind: ctx.KIND.AUTH });
  if (r.status >= 400) ctx.fail('Glances HTTP ' + r.status);
  return r.data;
}

/* "7 days, 20:30:06" and "1:27:01" are both what the uptime plugin returns. */
function glancesUptime(text) {
  const m = /^(?:(\d+)\s+days?,\s*)?(\d+):(\d\d):(\d\d)$/.exec(String(text || '').trim());
  if (!m) return null;
  return Number(m[1] || 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

function glancesTemps(sensors) {
  const out = {};
  for (const s of Array.isArray(sensors) ? sensors : []) {
    if (!s || typeof s.label !== 'string' || typeof s.value !== 'number') continue;
    if (s.unit && s.unit !== 'C') continue;
    out[s.label] = s.value;
  }
  return out;
}

async function glancesSensorOptions(ctx) {
  const temps = glancesTemps(await glancesGet(ctx, 'sensors'));
  return { options: Object.keys(temps).map(label => ({ value: label, label })) };
}

async function systemSummaryGlances(ctx) {
  const slots = ctx.config.slots || [];
  const wants = type => slots.some(s => s.type === type);

  const [cpu, mem] = await Promise.all([glancesGet(ctx, 'cpu'), glancesGet(ctx, 'mem')]);
  const fs = wants('disk') ? await glancesGet(ctx, 'fs') : [];
  const sensors = wants('temp') ? await glancesGet(ctx, 'sensors') : [];
  const procs = wants('procs') ? await glancesGet(ctx, 'processcount') : null;
  const uptime = glancesUptime(await glancesGet(ctx, 'uptime'));

  const byMount = {};
  for (const e of Array.isArray(fs) ? fs : []) {
    if (e && typeof e.mnt_point === 'string') byMount[e.mnt_point] = e;
  }
  const mounts = new Set();
  for (const s of slots) {
    if (s.type !== 'disk') continue;
    if (s.primary) mounts.add(s.primary);
    if (s.secondary) mounts.add(s.secondary);
  }
  const disks = [...mounts].map(mount => {
    const e = byMount[mount];
    const size = Number(e?.size) || 0;
    return {
      mount,
      usedPct: typeof e?.percent === 'number' ? e.percent : 0,
      totalGb: size / 1024 ** 3,
    };
  });

  const temps = glancesTemps(sensors);
  const firstTemp = Object.values(temps)[0];
  return {
    cpu: typeof cpu?.total === 'number' ? cpu.total : null,
    ram: typeof mem?.percent === 'number' ? mem.percent : null,
    temp: firstTemp ?? null,
    temps,
    disks,
    iowait: typeof cpu?.iowait === 'number' ? cpu.iowait : null,
    procs: typeof procs?.total === 'number' ? procs.total : null,
    uptime,
  };
}
