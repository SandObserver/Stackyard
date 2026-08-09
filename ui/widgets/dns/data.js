/* DNS Server widget data function.

   Supports four providers, selected by widgetConfig.provider:
     - "adguard" (default): AdGuard Home  GET /control/stats           (basic auth)
     - "pihole":            Pi-hole v6    session login + summary/history
     - "technitium":        Technitium    GET /api/dashboard/stats/get (token)
     - "nextdns":           NextDNS       cloud analytics API          (api key + profile)

   All are normalized into AdGuard's /control/stats shape so the widget HTML
   renders them identically:
     num_dns_queries, num_blocked_filtering, num_replaced_safebrowsing,
     num_replaced_parental, num_cached, and the per-hour arrays
     dns_queries / blocked_filtering. */

module.exports = async function (ctx) {
  const { config, fetchJSON, normalizeBase } = ctx;
  const provider = config.provider || 'adguard';

  if (provider === 'nextdns') return nextDns(ctx, config, fetchJSON);

  const base = normalizeBase(config.dnsUrl);
  if (!base) ctx.fail('Server URL not configured', { kind: ctx.KIND.INVALID });

  if (provider === 'pihole') return piHole(ctx, base, config, fetchJSON);
  if (provider === 'technitium') return technitium(ctx, base, config, fetchJSON);
  return adGuard(ctx, base, config, fetchJSON);
};

function authErr(r) {
  return r.status === 401 || r.status === 403;
}

async function adGuard(ctx, base, config, fetchJSON) {
  const headers = {};
  /* Only attach Authorization when a credential is set (matches prior behavior). */
  if (config.dnsUser || config.dnsPass) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${config.dnsUser || ''}:${config.dnsPass || ''}`).toString('base64');
  }
  const r = await fetchJSON(base + '/control/stats', { headers, timeout: 8000 });
  if (authErr(r)) ctx.fail(`AdGuard auth failed (${r.status}) — check credentials`, { kind: ctx.KIND.AUTH });
  if (r.status >= 400) ctx.fail('AdGuard HTTP ' + r.status);
  return r.data; /* already in the shape the widget reads */
}

async function piHole(ctx, base, config, fetchJSON) {
  /* v6 uses session auth: POST /api/auth { password } -> session.sid, sent as
     the X-FTL-SID header. If no password is set, the API responds unauthenticated. */
  let sid = '';
  if (config.dnsPiholePassword) {
    const a = await fetchJSON(base + '/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: config.dnsPiholePassword }),
      timeout: 8000,
    });
    const valid = a.data && a.data.session && a.data.session.valid;
    if (a.status === 401 || valid === false) ctx.fail('Pi-hole auth failed — check password', { kind: ctx.KIND.AUTH });
    sid = (a.data && a.data.session && a.data.session.sid) || '';
  }
  const headers = sid ? { 'X-FTL-SID': sid } : {};

  const sum = await fetchJSON(base + '/api/stats/summary', { headers, timeout: 8000 });
  if (sum.status === 401) ctx.fail('Pi-hole auth failed — set a password', { kind: ctx.KIND.AUTH });
  if (sum.status >= 400 || !sum.data || !sum.data.queries) ctx.fail('Pi-hole HTTP ' + sum.status);

  const q = sum.data.queries;
  const out = {
    num_dns_queries: q.total || 0,
    num_blocked_filtering: q.blocked || 0,
    num_cached: q.cached || 0,
    num_forwarded: q.forwarded || 0,
  };

  /* History: Pi-hole returns 10-minute slots with timestamps; the chart expects
     one point per hour, so bucket consecutive slots into hourly sums. */
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
  } catch {
    /* chart is optional; summary numbers already returned */
  }

  /* Release the session. Pi-hole v6 caps concurrent API sessions, and polling
     every interval would otherwise pile up sessions until it locks us out. */
  if (sid) {
    try {
      await fetchJSON(base + '/api/auth', { method: 'DELETE', headers, timeout: 5000 });
    } catch {}
  }

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
  /* NextDNS has no cache breakdown; total = allowed + blocked, no Cached stream. */
  return {
    num_dns_queries: allowed + blocked,
    num_blocked_filtering: blocked,
  };
}
