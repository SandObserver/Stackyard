module.exports = async function (ctx) {
  if (ctx.endpoint === 'speed') return speed(ctx);
  if (ctx.endpoint === 'sensors') return sensorOptions(ctx);
  if (ctx.endpoint === 'systems') return beszelSystemOptions(ctx);
  return systemSummary(ctx);
};

function systemSummary(ctx) {
  return ctx.dispatchProvider(
    {
      system: systemSummaryLocal,
      glances: systemSummaryGlances,
      beszel: systemSummaryBeszel,
    },
    { field: 'statProvider', default: 'system' },
  );
}

/* Only a source that names its sensors offers the picker, so the local machine
   has no handler here. */
function sensorOptions(ctx) {
  return ctx.dispatchProvider(
    { glances: glancesSensorOptions, beszel: beszelSensorOptions },
    { field: 'statProvider' },
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

/* Beszel is a PocketBase app: a login returns a token rather than accepting a
   key. The account collection moved between releases, so both are tried and the
   working one is remembered with its token. */
const BESZEL_COLLECTIONS = ['_superusers', 'users'];
const _beszelSession = new Map();

async function beszelLogin(ctx, base) {
  const { config, fetchJSON } = ctx;
  if (!config.beszelUser || !config.beszelPass)
    ctx.fail('Enter the Beszel account and password first.', { kind: ctx.KIND.INVALID });
  const body = JSON.stringify({ identity: config.beszelUser, password: config.beszelPass });
  const known = _beszelSession.get(base);
  const tries = known ? [known.collection] : BESZEL_COLLECTIONS;

  for (const collection of tries) {
    const r = await fetchJSON(`${base}/api/collections/${collection}/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      timeout: 8000,
    });
    if (r.status < 400 && r.data?.token) {
      const session = { collection, token: r.data.token };
      _beszelSession.set(base, session);
      return session;
    }
  }
  _beszelSession.delete(base);
  ctx.fail('Beszel rejected the account and password', { kind: ctx.KIND.AUTH });
}

/* An expired token is not refused: PocketBase applies the collection's read
   rule instead, and an unauthenticated read of systems is an empty list. So an
   empty answer is retried once with a fresh token before it is believed. */
async function beszelGet(ctx, base, path) {
  const { fetchJSON } = ctx;
  let session = _beszelSession.get(base) || (await beszelLogin(ctx, base));
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetchJSON(`${base}${path}`, {
      headers: { Authorization: session.token },
      timeout: 8000,
    });
    if (r.status === 401 || r.status === 403 || (Array.isArray(r.data?.items) && !r.data.items.length)) {
      if (attempt === 0) {
        _beszelSession.delete(base);
        session = await beszelLogin(ctx, base);
        continue;
      }
      return r.data;
    }
    if (r.status >= 400) ctx.fail('Beszel HTTP ' + r.status);
    return r.data;
  }
}

function beszelBase(ctx) {
  if (!ctx.config.beszelUrl) ctx.fail('Enter the Beszel URL first.', { kind: ctx.KIND.INVALID });
  return ctx.normalizeBase(ctx.config.beszelUrl);
}

async function beszelSystems(ctx) {
  const base = beszelBase(ctx);
  const data = await beszelGet(ctx, base, '/api/collections/systems/records?perPage=200&fields=id,name,status');
  return Array.isArray(data?.items) ? data.items : [];
}

async function beszelSystemOptions(ctx) {
  const options = (await beszelSystems(ctx)).map(s => ({ value: s.id, label: s.name || s.id }));
  return { options };
}

async function beszelLatest(ctx, base, systemId) {
  const filter = encodeURIComponent(`system='${systemId}' && type='1m'`);
  const data = await beszelGet(
    ctx,
    base,
    `/api/collections/system_stats/records?filter=(${filter})&sort=-created&perPage=1`,
  );
  return data?.items?.[0]?.stats || null;
}

async function beszelSensorOptions(ctx) {
  const base = beszelBase(ctx);
  const id = ctx.config.beszelSystem;
  if (!id) ctx.fail('Choose a system first.', { kind: ctx.KIND.INVALID });
  const stats = await beszelLatest(ctx, base, id);
  const temps = stats && typeof stats.t === 'object' ? stats.t : {};
  return { options: Object.keys(temps).map(label => ({ value: label, label })) };
}

/* The root filesystem is the one Beszel reports directly. Every other one is
   named, and a slot names it the way Beszel does. */
function beszelDisk(stats, name) {
  if (!name || name === '/') {
    return { usedPct: Number(stats?.dp) || 0, totalGb: Number(stats?.d) || 0 };
  }
  const fs = stats?.efs?.[name];
  const total = Number(fs?.d) || 0;
  const used = Number(fs?.du) || 0;
  return { usedPct: total > 0 ? (used / total) * 100 : 0, totalGb: total };
}

async function systemSummaryBeszel(ctx) {
  const base = beszelBase(ctx);
  const id = ctx.config.beszelSystem;
  if (!id) ctx.fail('Choose a system first.', { kind: ctx.KIND.INVALID });

  const systems = await beszelSystems(ctx);
  if (!systems.length) ctx.fail('Beszel is reporting no systems for this account');
  const system = systems.find(s => s.id === id);
  if (!system) ctx.fail('That system is no longer in Beszel. Choose it again.', { kind: ctx.KIND.INVALID });

  const [record, stats] = await Promise.all([
    beszelGet(ctx, base, `/api/collections/systems/records/${encodeURIComponent(id)}?fields=info`),
    beszelLatest(ctx, base, id),
  ]);
  if (!stats) ctx.fail('Beszel has no readings for that system yet');

  const slots = ctx.config.slots || [];
  const mounts = new Set();
  for (const s of slots) {
    if (s.type !== 'disk') continue;
    mounts.add(s.primary || '/');
    if (s.secondary) mounts.add(s.secondary);
  }
  const disks = [...mounts].map(mount => ({ mount, ...beszelDisk(stats, mount) }));

  const temps = {};
  for (const [label, value] of Object.entries(stats.t || {})) {
    if (typeof value === 'number') temps[label] = value;
  }
  const iowait = Array.isArray(stats.cpub) && typeof stats.cpub[2] === 'number' ? stats.cpub[2] : null;

  return {
    cpu: typeof stats.cpu === 'number' ? stats.cpu : null,
    ram: typeof stats.mp === 'number' ? stats.mp : null,
    temp: Object.values(temps)[0] ?? null,
    temps,
    disks,
    iowait,
    procs: null,
    uptime: Number(record?.info?.u) || null,
  };
}
