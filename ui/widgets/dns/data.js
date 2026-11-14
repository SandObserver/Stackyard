/* Every provider is normalised into AdGuard's /control/stats shape, which is
   what the widget HTML renders. */

module.exports = async function (ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  const provider = config.provider || 'adguard';

  if (provider === 'nextdns') {
    const stats = await nextDns(ctx, config, fetchJSON);
    return {
      ...stats,
      link: config.dnsHref || `https://my.nextdns.io/${encodeURIComponent(config.dnsNextdnsProfile)}/analytics`,
    };
  }

  const base = normalizeBase(config.dnsUrl);
  if (!base) ctx.fail('Server URL not configured', { kind: ctx.KIND.INVALID });

  const read = provider === 'pihole' ? piHole : provider === 'technitium' ? technitium : adGuard;
  const stats = await read(ctx, base, config, fetchJSON);
  return { ...stats, link: ctx.serviceLink(config.dnsHref, config.dnsUrl) };
};

function authErr(r) {
  return r.status === 401 || r.status === 403;
}

async function adGuard(ctx, base, config, fetchJSON) {
  const headers = {};
  if (config.dnsUser || config.dnsPass) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${config.dnsUser || ''}:${config.dnsPass || ''}`).toString('base64');
  }
  const r = await fetchJSON(base + '/control/stats', { headers, timeout: 8000 });
  if (authErr(r)) ctx.fail(`AdGuard auth failed (${r.status}) — check credentials`, { kind: ctx.KIND.AUTH });
  if (r.status >= 400) ctx.fail('AdGuard HTTP ' + r.status);
  const d = r.data;
  if (typeof d?.num_dns_queries !== 'number') ctx.fail('AdGuard sent a reply without query counts');
  return {
    num_dns_queries: d.num_dns_queries,
    num_blocked_filtering: d.num_blocked_filtering,
    num_replaced_safebrowsing: d.num_replaced_safebrowsing,
    num_replaced_parental: d.num_replaced_parental,
    num_cached: d.num_cached,
  };
}

/* Do not sign in per poll. Pi-hole v6 caps open sessions and then refuses this
   client. */
const _piHoleSessions = new Map();

const piHoleKey = (base, password) => JSON.stringify([base, password]);

function piHoleSession(ctx, base, password, fetchJSON, spent) {
  const key = piHoleKey(base, password);
  const known = _piHoleSessions.get(key);
  if (known && known !== spent && Date.now() < known.expiresAt) return known.ready;
  const session = { sid: '', lifetimeMs: Infinity, expiresAt: Infinity };
  session.ready = (async () => {
    const sentAt = Date.now();
    const a = await fetchJSON(base + '/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      timeout: 8000,
    });
    const reply = a.data && a.data.session;
    if (a.status === 401 || (reply && reply.valid === false))
      ctx.fail('Pi-hole auth failed — check password', { kind: ctx.KIND.AUTH });
    session.sid = (reply && typeof reply.sid === 'string' && reply.sid) || '';
    if (reply && Number.isFinite(reply.validity) && reply.validity > 0) session.lifetimeMs = reply.validity * 1000;
    session.expiresAt = session.sid ? sentAt + session.lifetimeMs : 0;
    return session;
  })().catch(e => {
    if (_piHoleSessions.get(key) === session) _piHoleSessions.delete(key);
    throw e;
  });
  ctx.remember(_piHoleSessions, key, session);
  return session.ready;
}

async function piHole(ctx, base, config, fetchJSON) {
  const password = config.dnsPiholePassword;
  if (!password) return piHoleStats(ctx, base, {}, fetchJSON);
  let session = await piHoleSession(ctx, base, password, fetchJSON);
  for (let attempt = 0; ; attempt++) {
    const sentAt = Date.now();
    const out = await piHoleStats(ctx, base, session.sid ? { 'X-FTL-SID': session.sid } : {}, fetchJSON, attempt === 0);
    if (out) {
      if (session.sid) session.expiresAt = sentAt + session.lifetimeMs;
      return out;
    }
    session = await piHoleSession(ctx, base, password, fetchJSON, session);
  }
}

async function piHoleStats(ctx, base, headers, fetchJSON, mayRetry = false) {
  const sum = await fetchJSON(base + '/api/stats/summary', { headers, timeout: 8000 });
  if (sum.status === 401 && mayRetry && headers['X-FTL-SID']) return null;
  if (sum.status === 401) ctx.fail('Pi-hole auth failed — set a password', { kind: ctx.KIND.AUTH });
  if (sum.status >= 400 || !sum.data || !sum.data.queries) ctx.fail('Pi-hole HTTP ' + sum.status);

  const q = sum.data.queries;
  const out = {
    num_dns_queries: q.total || 0,
    num_blocked_filtering: q.blocked || 0,
    num_cached: q.cached || 0,
    num_forwarded: q.forwarded || 0,
  };

  /* Pi-hole returns 10-minute slots. The chart expects one point per hour. */
  try {
    const h = await fetchJSON(base + '/api/history', { headers, timeout: 8000 });
    const slots = h.data && Array.isArray(h.data.history) ? h.data.history : [];
    if (slots.length) {
      const byHour = new Map();
      for (const s of slots) {
        const hr = Math.floor((s.timestamp || 0) / 3600);
        const cur = byHour.get(hr) || { total: 0, blocked: 0 };
        cur.total += s.total || 0;
        cur.blocked += s.blocked || 0;
        byHour.set(hr, cur);
      }
      const hours = [...byHour.keys()].sort((a, b) => a - b);
      out.dns_queries = hours.map(hr => byHour.get(hr).total);
      out.blocked_filtering = hours.map(hr => byHour.get(hr).blocked);
    }
  } catch {}

  return out;
}

async function technitium(ctx, base, config, fetchJSON) {
  if (!config.dnsTechnitiumToken) ctx.fail('API token not configured', { kind: ctx.KIND.INVALID });
  const url =
    base +
    '/api/dashboard/stats/get' +
    '?token=' +
    encodeURIComponent(config.dnsTechnitiumToken) +
    '&type=LastDay&utc=true';
  const r = await fetchJSON(url, { timeout: 8000 });
  if (r.status >= 400) ctx.fail('Technitium HTTP ' + r.status);
  /* Technitium wraps stats under response.stats and reports status as a string. */
  if (r.data && r.data.status && r.data.status !== 'ok') {
    ctx.fail('Technitium rejected the request — check the API token');
  }
  const s = (r.data && (r.data.stats || (r.data.response && r.data.response.stats))) || r.data || {};
  if (typeof s.totalQueries !== 'number') ctx.fail('Technitium sent a reply without query counts');
  return {
    num_dns_queries: +s.totalQueries || 0,
    num_blocked_filtering: (+s.totalBlocked || 0) + (+s.totalDropped || 0),
    num_cached: +s.totalCached || 0,
  };
}

async function nextDns(ctx, config, fetchJSON) {
  if (!config.dnsNextdnsApiKey) ctx.fail('API key not configured', { kind: ctx.KIND.INVALID });
  if (!config.dnsNextdnsProfile) ctx.fail('Profile ID not configured', { kind: ctx.KIND.INVALID });
  const url = 'https://api.nextdns.io/profiles/' + encodeURIComponent(config.dnsNextdnsProfile) + '/analytics/status';
  const r = await fetchJSON(url, { headers: { 'X-Api-Key': config.dnsNextdnsApiKey }, timeout: 8000 });
  if (authErr(r)) ctx.fail('NextDNS auth failed — check API key', { kind: ctx.KIND.AUTH });
  if (r.status === 404) ctx.fail('NextDNS profile not found', { kind: ctx.KIND.INVALID });
  if (r.status >= 400) ctx.fail('NextDNS HTTP ' + r.status);

  const rows = r.data && Array.isArray(r.data.data) ? r.data.data : [];
  let blocked = 0,
    allowed = 0;
  for (const row of rows) {
    const q = +row.queries || 0;
    if (row.status === 'blocked') blocked += q;
    else allowed += q; /* 'allowed' and 'default' both count as allowed */
  }
  /* NextDNS has no cache breakdown. */
  return {
    num_dns_queries: allowed + blocked,
    num_blocked_filtering: blocked,
  };
}
