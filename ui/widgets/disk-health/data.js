module.exports = async function (ctx) {
  if (ctx.endpoint === 'devices') return diskDevices(ctx);
  return diskHealth(ctx);
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

/* Scrutiny builds disagree on the device identifier. The fork sends device_id,
   the original sends scrutiny_uuid from 0.9.0 and wwn before it. Each one
   equals that device's key in the summary map. */
function scrutinyDeviceIds(key, device) {
  return [device?.device_id, device?.scrutiny_uuid, device?.wwn, key].filter(v => typeof v === 'string' && v);
}

function scrutinyStatus(ctx, r) {
  if (r.status === 401 || r.status === 403) ctx.fail('Scrutiny auth failed', { kind: ctx.KIND.AUTH });
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
  const r = await fetchJSON(normalizeBase(config.scrutinyUrl) + '/api/summary', { timeout: 8000 });
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

async function diskHealthScrutiny(ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  const url = config.scrutinyUrl;
  if (!url) ctx.fail('scrutinyUrl not configured', { kind: ctx.KIND.INVALID });
  const bays = config.bays || [];

  const base = normalizeBase(url);
  const r = await fetchJSON(base + '/api/summary', { timeout: 8000 });
  scrutinyStatus(ctx, r);

  const byId = scrutinyIndex(r.data?.data?.summary || {});

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
