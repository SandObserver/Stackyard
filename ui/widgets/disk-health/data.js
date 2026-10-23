module.exports = async function (ctx) {
  if (ctx.endpoint === 'devices') return diskDevices(ctx);
  return diskHealth(ctx);
};

function diskDevices(ctx) {
  return ctx.dispatchProvider(
    {
      scrutiny: scrutinyDeviceOptions,
      truenas: truenasPoolOptions,
      unraid: unraidDiskOptions,
    },
    { field: 'diskProvider', default: 'scrutiny' },
  );
}

/* Scrutiny builds disagree on the device identifier. The fork sends device_id,
   the original sends scrutiny_uuid from 0.9.0 and wwn before it. Each one
   equals that device's key in the summary map. */
function scrutinyDeviceIds(key, device) {
  return [device?.device_id, device?.scrutiny_uuid, device?.wwn, key].filter(v => typeof v === 'string' && v);
}

function scrutinyHeaders(config) {
  return config.scrutinyToken ? { Authorization: 'Bearer ' + config.scrutinyToken } : {};
}

function scrutinyStatus(ctx, r) {
  if (r.status === 401 || r.status === 403) ctx.fail('Scrutiny auth failed, check API token', { kind: ctx.KIND.AUTH });
  if (r.status >= 400) ctx.fail('Scrutiny HTTP ' + r.status);
}

/* Index under every identifier, so a bay saved before an upgrade still
   resolves. Preferred first: an alternate must not shadow another disk. */
function scrutinyIndex(summary) {
  const entries = Object.entries(summary).filter(([, e]) => e?.device);
  const byId = {};
  for (const [key, entry] of entries) byId[scrutinyDeviceIds(key, entry.device)[0]] = entry;
  for (const [key, entry] of entries) {
    for (const id of scrutinyDeviceIds(key, entry.device)) if (!(id in byId)) byId[id] = entry;
  }
  return byId;
}

async function scrutinyDeviceOptions(ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  if (!config.scrutinyUrl) ctx.fail('Enter the Scrutiny URL first.', { kind: ctx.KIND.INVALID });
  const r = await fetchJSON(normalizeBase(config.scrutinyUrl) + '/api/summary', {
    headers: scrutinyHeaders(config),
    timeout: 8000,
  });
  scrutinyStatus(ctx, r);
  const summary = r.data?.data?.summary || {};
  const options = Object.entries(summary)
    .filter(([, e]) => e?.device)
    .map(([key, e]) => {
      const id = scrutinyDeviceIds(key, e.device)[0];
      return { value: id, label: e.device.model_name || e.device.device_name || id };
    });
  return { options };
}

/* Never send the key over http. TrueNAS revokes it. */
function truenasBase(ctx) {
  const raw = String(ctx.config.truenasUrl || '')
    .trim()
    .replace(/[?#].*$/, '');
  if (!raw) ctx.fail('Enter the TrueNAS URL first.', { kind: ctx.KIND.INVALID });
  if (/^http:\/\//i.test(raw))
    ctx.fail('Use an https:// address. TrueNAS revokes an API key sent over http.', { kind: ctx.KIND.INVALID });
  return ctx.normalizeBase(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
}

function truenasKey(ctx) {
  const key = String(ctx.config.truenasKey || '').trim();
  if (!key) ctx.fail('Enter the TrueNAS API key first.', { kind: ctx.KIND.INVALID });
  return key;
}

function truenasRestStatus(ctx, r) {
  if (r.status === 401 || r.status === 403) ctx.fail('TrueNAS refused the API key', { kind: ctx.KIND.AUTH });
  if (r.status === 404) ctx.fail('That address is not TrueNAS');
  if (r.status >= 400) ctx.fail('TrueNAS HTTP ' + r.status);
}

/* Keep the REST read. TrueNAS before 25.04 has no WebSocket API. */
async function truenasPools(ctx) {
  const base = truenasBase(ctx);
  const key = truenasKey(ctx);
  const skipTls = ctx.config.truenasSkipTls === true;
  let pools;
  try {
    pools = await ctx.jsonRpc(`${base}/api/current`, { skipTls }, async session => {
      if ((await session.call('auth.login_with_api_key', [key])) !== true)
        ctx.fail('TrueNAS refused the API key', { kind: ctx.KIND.AUTH });
      return session.call('pool.query');
    });
  } catch (e) {
    if (e?.kind !== 'upstream' || typeof e.status !== 'number') throw e;
    const r = await ctx.fetchJSON(`${base}/api/v2.0/pool`, {
      headers: { Authorization: 'Bearer ' + key },
      skipTls,
      timeout: 8000,
    });
    truenasRestStatus(ctx, r);
    pools = r.data;
  }
  return (Array.isArray(pools) ? pools : []).filter(p => p && typeof p.name === 'string' && p.name);
}

async function truenasPoolOptions(ctx) {
  const pools = await truenasPools(ctx);
  return { options: pools.map(p => ({ value: p.name, label: p.name })) };
}

function diskHealth(ctx) {
  return ctx.dispatchProvider(
    {
      scrutiny: diskHealthScrutiny,
      truenas: diskHealthTrueNas,
      unraid: diskHealthUnraid,
    },
    { field: 'diskProvider', default: 'scrutiny' },
  );
}

async function diskHealthScrutiny(ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  const url = config.scrutinyUrl;
  if (!url) ctx.fail('scrutinyUrl not configured', { kind: ctx.KIND.INVALID });
  const bays = config.bays || [];

  const base = normalizeBase(url);
  const r = await fetchJSON(base + '/api/summary', { headers: scrutinyHeaders(config), timeout: 8000 });
  scrutinyStatus(ctx, r);

  const byId = scrutinyIndex(r.data?.data?.summary || {});

  const result = bays.map(deviceId => {
    if (!deviceId) return null;
    const entry = byId[deviceId];
    if (!entry) return { device_id: deviceId, device_status: 0, hasSmart: false, error: 'not found' };
    const failed = scrutinyFailed(entry.device.device_status);
    return {
      device_id: deviceId,
      device_status: failed ? 2 : 0,
      hasSmart: !!entry.smart && failed !== null,
      model_name: entry.device.model_name || entry.device.device_serial_id || entry.device.device_name,
      device_name: entry.device.device_name,
      temp: entry.smart?.temp ?? null,
      capacity: entry.device.capacity || null,
    };
  });

  return { bays: result, href: ctx.serviceLink(config.scrutinyHref, url), provider: 'scrutiny' };
}

/* Scrutiny's device_status is a bit set: 1 is a failed SMART check, 2 a failed
   Scrutiny threshold. Any set bit is a failed drive. */
function scrutinyFailed(status) {
  return Number.isInteger(status) && status >= 0 ? status !== 0 : null;
}

/* A pool's `healthy` flag becomes the per-bay status, in the codes the widget
   already uses for Scrutiny. */
async function diskHealthTrueNas(ctx) {
  const { config } = ctx;
  const bays = config.bays || [];
  const byName = {};
  for (const p of await truenasPools(ctx)) byName[p.name] = p;

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

  return { bays: result, href: ctx.serviceLink(config.truenasHref, truenasBase(ctx)), provider: 'truenas' };
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
    if (denied) ctx.fail('Unraid refused this API key or its role', { kind: ctx.KIND.AUTH });
    ctx.fail('Unraid could not answer the query');
  }
  if (!r.data?.data) ctx.fail('Unraid returned no data');
  return r.data.data;
}

const UNRAID_DISK = 'name device size status temp';
const UNRAID_ARRAY = `{ array { parities { ${UNRAID_DISK} } disks { ${UNRAID_DISK} } caches { ${UNRAID_DISK} } } }`;

async function unraidSlots(ctx) {
  const array = (await unraidQuery(ctx, UNRAID_ARRAY)).array || {};
  return [...(array.parities || []), ...(array.disks || []), ...(array.caches || [])].filter(
    d => d && typeof d.name === 'string' && d.name && d.status !== 'DISK_NP',
  );
}

async function unraidDiskOptions(ctx) {
  const options = (await unraidSlots(ctx)).map(d => ({
    value: d.name,
    label: d.device ? `${d.name} (${d.device})` : d.name,
  }));
  return { options };
}

const UNRAID_HEALTHY = new Set(['DISK_OK', 'DISK_NEW']);
const UNRAID_FAILED = new Set(['DISK_INVALID', 'DISK_WRONG', 'DISK_DSBL', 'DISK_DSBL_NEW']);

async function diskHealthUnraid(ctx) {
  const { config } = ctx;
  if (!config.unraidUrl) ctx.fail('unraidUrl not configured', { kind: ctx.KIND.INVALID });
  const bays = config.bays || [];

  const byName = {};
  for (const d of await unraidSlots(ctx)) byName[d.name] = d;

  const result = bays.map(name => {
    if (!name) return null;
    const d = byName[name];
    /* Unraid leaves a slot with no drive out of the reply, so a missing
       drive is an absent bay. Reading it as not found hides a degraded array. */
    if (!d)
      return {
        device_id: name,
        device_status: 2,
        hasSmart: true,
        model_name: name,
        device_name: name,
        temp: null,
        capacity: null,
      };
    const known = UNRAID_HEALTHY.has(d.status) || UNRAID_FAILED.has(d.status);
    const kb = Number(d.size);
    return {
      device_id: name,
      device_status: UNRAID_FAILED.has(d.status) ? 2 : 0,
      hasSmart: known,
      model_name: name,
      device_name: name,
      temp: Number.isFinite(d.temp) ? d.temp : null,
      capacity: kb > 0 ? kb * 1024 : null,
    };
  });

  return { bays: result, href: ctx.serviceLink(config.unraidHref, config.unraidUrl), provider: 'unraid' };
}
