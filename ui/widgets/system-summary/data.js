module.exports = async function (ctx) {
  if (ctx.endpoint === 'speed') return speed(ctx);
  if (ctx.endpoint === 'sensors') return sensorOptions(ctx);
  if (ctx.endpoint === 'systems') return beszelSystemOptions(ctx);
  if (ctx.endpoint === 'interfaces') return interfaceOptions(ctx);
  if (ctx.endpoint === 'throughput') return throughput(ctx);
  return systemSummary(ctx);
};

function systemSummary(ctx) {
  return ctx.dispatchProvider(
    {
      system: systemSummaryLocal,
      glances: systemSummaryGlances,
      beszel: systemSummaryBeszel,
      unraid: systemSummaryUnraid,
    },
    { field: 'statProvider', default: 'system' },
  );
}

/* Only a source that names its sensors offers the picker, so the local machine
   has no handler here. */
function sensorOptions(ctx) {
  return ctx.dispatchProvider(
    { glances: glancesSensorOptions, beszel: beszelSensorOptions, unraid: unraidSensorOptions },
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

async function beszelLatestRecord(ctx, base, systemId) {
  const filter = encodeURIComponent(`system='${systemId}' && type='1m'`);
  const data = await beszelGet(
    ctx,
    base,
    `/api/collections/system_stats/records?filter=(${filter})&sort=-created&perPage=1`,
  );
  return data?.items?.[0] || null;
}

async function beszelLatest(ctx, base, systemId) {
  return (await beszelLatestRecord(ctx, base, systemId))?.stats || null;
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

/* Unraid's own web server proxies the API at /graphql, and refuses GET unless
   its sandbox is on, so every request here is a POST carrying the key. */
async function unraidQuery(ctx, query) {
  const { config, fetchJSON, normalizeBase } = ctx;
  if (!config.unraidUrl) ctx.fail('Enter the Unraid URL first.', { kind: ctx.KIND.INVALID });
  if (!config.unraidApiKey) ctx.fail('Enter the Unraid API key first.', { kind: ctx.KIND.INVALID });
  const r = await fetchJSON(normalizeBase(config.unraidUrl) + '/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': config.unraidApiKey },
    body: JSON.stringify({ query }),
    timeout: 8000,
  });
  if (r.status === 401 || r.status === 403) ctx.fail('Unraid rejected the API key', { kind: ctx.KIND.AUTH });
  if (r.status >= 400) ctx.fail('Unraid HTTP ' + r.status);
  /* Both a refused key and a key without the role answer 200 with an errors
     array, so the status code alone never reports an auth problem. */
  const problem = r.data?.errors?.[0];
  if (problem) {
    const code = problem.extensions?.code;
    const denied =
      code === 'FORBIDDEN' ||
      code === 'UNAUTHENTICATED' ||
      /permission|forbidden|unauthor|api key/i.test(problem.message || '');
    ctx.fail('Unraid: ' + problem.message, { kind: denied ? ctx.KIND.AUTH : ctx.KIND.UPSTREAM });
  }
  if (!r.data?.data) ctx.fail('Unraid returned no data');
  return r.data.data;
}

const UNRAID_TEMPS = 'temperature { sensors { name current { value unit } } }';

function unraidCelsius(reading) {
  const v = Number(reading?.value);
  if (!Number.isFinite(v)) return null;
  switch (reading.unit) {
    case 'FAHRENHEIT':
      return ((v - 32) * 5) / 9;
    case 'KELVIN':
      return v - 273.15;
    case 'RANKINE':
      return ((v - 491.67) * 5) / 9;
    default:
      return v;
  }
}

function unraidTemps(temperature) {
  const out = {};
  for (const s of temperature?.sensors || []) {
    const c = unraidCelsius(s?.current);
    if (s?.name && c !== null) out[s.name] = c;
  }
  return out;
}

async function unraidSensorOptions(ctx) {
  const data = await unraidQuery(ctx, `{ metrics { ${UNRAID_TEMPS} } }`);
  const temperature = data.metrics?.temperature;
  /* Unraid ships temperature reporting off, and resolves the field to null
     rather than failing, so an empty picker would look like a broken key. */
  if (!temperature) ctx.fail('Turn on temperature reporting in Unraid first.', { kind: ctx.KIND.INVALID });
  const temps = unraidTemps(temperature);
  return { options: Object.keys(temps).map(name => ({ value: name, label: name })) };
}

const KB = 1024;
const kbToGb = v => (Number(v) || 0) / KB ** 2;

/* A named slot is a user share. A blank one is the array as a whole. */
function unraidDisk(data, name) {
  if (!name) {
    const kb = data.array?.capacity?.kilobytes || {};
    const total = Number(kb.total) || 0;
    const used = Number(kb.used) || 0;
    return { usedPct: total > 0 ? (used / total) * 100 : 0, totalGb: kbToGb(total) };
  }
  const share = (data.shares || []).find(s => s?.name === name);
  const used = Number(share?.used) || 0;
  /* size is the share's own limit, and is 0 when none is set, which is the
     usual case. What is left on the pool is then the only total there is. */
  const limit = Number(share?.size) || 0;
  const total = limit > 0 ? limit : used + (Number(share?.free) || 0);
  return { usedPct: total > 0 ? (used / total) * 100 : 0, totalGb: kbToGb(total) };
}

async function systemSummaryUnraid(ctx) {
  const slots = ctx.config.slots || [];
  const wants = type => slots.some(s => s.type === type);
  const mounts = new Set();
  for (const s of slots) {
    if (s.type !== 'disk') continue;
    mounts.add(s.primary || '');
    if (s.secondary) mounts.add(s.secondary);
  }

  /* Shares and the array sit behind their own permissions, so they are only
     asked for when a slot needs them. */
  const parts = [`metrics { cpu { percentTotal } memory { percentTotal }${wants('temp') ? ' ' + UNRAID_TEMPS : ''} }`];
  parts.push('info { os { uptime } }');
  if ([...mounts].some(m => m)) parts.push('shares { name size used free }');
  if (mounts.has('')) parts.push('array { capacity { kilobytes { total used } } }');

  const data = await unraidQuery(ctx, `{ ${parts.join(' ')} }`);
  const temps = unraidTemps(data.metrics?.temperature);

  /* info.os.uptime is the boot time, not an elapsed count. */
  const booted = Date.parse(data.info?.os?.uptime);
  const uptime = Number.isFinite(booted) ? Math.max(0, Math.round((Date.now() - booted) / 1000)) : null;

  return {
    cpu: typeof data.metrics?.cpu?.percentTotal === 'number' ? data.metrics.cpu.percentTotal : null,
    ram: typeof data.metrics?.memory?.percentTotal === 'number' ? data.metrics.memory.percentTotal : null,
    temp: Object.values(temps)[0] ?? null,
    temps,
    disks: [...mounts].map(mount => ({ mount, ...unraidDisk(data, mount) })),
    iowait: null,
    procs: null,
    uptime,
  };
}

/* A counter is not a rate. Sources that report totals are turned into one here,
   against the previous reading for the same interface. The first reading has
   nothing to compare with and reports nothing.

   `at` is when the counters were taken, not when they were read. A source that
   publishes on its own schedule hands back the same totals to every poll in
   between, and dividing those by the time since the last poll reports zero
   traffic. Reading it twice is then the same reading, so the rate last worked
   out stands until the counters actually move. */
const _netPrev = new Map();

function rateFromTotals(key, at, rx, tx) {
  const prev = _netPrev.get(key);
  if (prev && at <= prev.at) return prev.rate;
  let rate = null;
  /* Counters that went backwards mean the interface was reset or replaced.
     Skip the window rather than report a negative rate. */
  if (prev && rx >= prev.rx && tx >= prev.tx) {
    const seconds = (at - prev.at) / 1000;
    if (seconds > 0) {
      rate = { rx: Math.round((rx - prev.rx) / seconds), tx: Math.round((tx - prev.tx) / seconds) };
    }
  }
  _netPrev.set(key, { at, rx, tx, rate });
  return rate;
}

function throughput(ctx) {
  return ctx.dispatchProvider(
    {
      glances: glancesThroughput,
      beszel: beszelThroughput,
      unraid: unraidThroughput,
    },
    { field: 'statProvider' },
  );
}

function interfaceOptions(ctx) {
  return ctx.dispatchProvider(
    {
      glances: glancesInterfaces,
      beszel: beszelInterfaces,
      unraid: unraidInterfaces,
    },
    { field: 'statProvider' },
  );
}

const chosenInterface = ctx => ctx.config.network?.interface || '';

/* ── Glances ─────────────────────────────────────────────────────────────── */

async function glancesInterfaces(ctx) {
  const list = await glancesGet(ctx, 'network');
  const options = (Array.isArray(list) ? list : [])
    .filter(e => e?.interface_name)
    .map(e => ({ value: e.interface_name, label: e.alias || e.interface_name }));
  return { options };
}

async function glancesThroughput(ctx) {
  const name = chosenInterface(ctx);
  if (!name) ctx.fail('Choose a network interface first.', { kind: ctx.KIND.INVALID });
  const list = await glancesGet(ctx, 'network');
  const e = (Array.isArray(list) ? list : []).find(x => x?.interface_name === name);
  if (!e) ctx.fail(`Glances is not reporting the ${name} interface.`, { kind: ctx.KIND.INVALID });
  /* Version 4 reports the rate. Version 3 reports the window and its length. */
  const perSec = (rate, bytes) => {
    if (typeof rate === 'number') return Math.round(rate);
    const window = Number(e.time_since_update);
    return window > 0 ? Math.round((Number(bytes) || 0) / window) : 0;
  };
  return {
    rx: perSec(e.bytes_recv_rate_per_sec, e.bytes_recv),
    tx: perSec(e.bytes_sent_rate_per_sec, e.bytes_sent),
  };
}

/* ── Beszel ──────────────────────────────────────────────────────────────── */

async function beszelInterfaces(ctx) {
  const base = beszelBase(ctx);
  const id = ctx.config.beszelSystem;
  if (!id) ctx.fail('Choose a system first.', { kind: ctx.KIND.INVALID });
  const stats = await beszelLatest(ctx, base, id);
  const options = Object.keys(stats?.ni || {}).map(name => ({ value: name, label: name }));
  return { options: [{ value: BESZEL_ALL, label: 'All interfaces' }, ...options] };
}

const BESZEL_ALL = '*';

async function beszelThroughput(ctx) {
  const base = beszelBase(ctx);
  const id = ctx.config.beszelSystem;
  if (!id) ctx.fail('Choose a system first.', { kind: ctx.KIND.INVALID });
  const name = chosenInterface(ctx);
  if (!name) ctx.fail('Choose a network interface first.', { kind: ctx.KIND.INVALID });
  const record = await beszelLatestRecord(ctx, base, id);
  const stats = record?.stats;
  if (!stats) ctx.fail('Beszel has no readings for that system yet');

  /* Beszel already divides the whole host's traffic by its own interval. */
  if (name === BESZEL_ALL) {
    const b = Array.isArray(stats.b) ? stats.b : [];
    return { rx: Math.round(Number(b[1]) || 0), tx: Math.round(Number(b[0]) || 0) };
  }
  const row = stats.ni?.[name];
  if (!Array.isArray(row)) ctx.fail(`Beszel is not reporting the ${name} interface.`, { kind: ctx.KIND.INVALID });
  /* Per-interface entries carry totals, and a new record only lands once a
     minute, so the record's own timestamp is the window. */
  const at = Date.parse(record?.created) || 0;
  return rateFromTotals(`beszel|${base}|${id}|${name}`, at, Number(row[3]) || 0, Number(row[2]) || 0);
}

/* ── Unraid ──────────────────────────────────────────────────────────────── */

const UNRAID_NET = 'metrics { network { name bytesReceived bytesSent } }';

async function unraidInterfaces(ctx) {
  const data = await unraidQuery(ctx, `{ ${UNRAID_NET} }`);
  const options = (data.metrics?.network || []).filter(n => n?.name).map(n => ({ value: n.name, label: n.name }));
  return { options };
}

async function unraidThroughput(ctx) {
  const name = chosenInterface(ctx);
  if (!name) ctx.fail('Choose a network interface first.', { kind: ctx.KIND.INVALID });
  const data = await unraidQuery(ctx, `{ ${UNRAID_NET} }`);
  const n = (data.metrics?.network || []).find(x => x?.name === name);
  if (!n) ctx.fail(`Unraid is not reporting the ${name} interface.`, { kind: ctx.KIND.INVALID });
  const base = ctx.normalizeBase(ctx.config.unraidUrl);
  /* Unraid's counters move continuously, so the clock is the only window. */
  return rateFromTotals(`unraid|${base}|${name}`, Date.now(), Number(n.bytesReceived) || 0, Number(n.bytesSent) || 0);
}
