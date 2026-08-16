/* Two endpoints: "vpn" for single-tunnel status, "map" for the per-service geo
   data. Errors are reported inside the result, never thrown. */

const COUNTRY_TO_ISO2 = {
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  canada: 'CA',
  mexico: 'MX',
  'united kingdom': 'GB',
  uk: 'GB',
  ireland: 'IE',
  netherlands: 'NL',
  germany: 'DE',
  france: 'FR',
  spain: 'ES',
  portugal: 'PT',
  italy: 'IT',
  switzerland: 'CH',
  austria: 'AT',
  belgium: 'BE',
  luxembourg: 'LU',
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
  finland: 'FI',
  iceland: 'IS',
  poland: 'PL',
  czechia: 'CZ',
  'czech republic': 'CZ',
  romania: 'RO',
  bulgaria: 'BG',
  hungary: 'HU',
  greece: 'GR',
  ukraine: 'UA',
  estonia: 'EE',
  latvia: 'LV',
  lithuania: 'LT',
  moldova: 'MD',
  russia: 'RU',
  turkey: 'TR',
  israel: 'IL',
  'united arab emirates': 'AE',
  japan: 'JP',
  'south korea': 'KR',
  korea: 'KR',
  singapore: 'SG',
  'hong kong': 'HK',
  taiwan: 'TW',
  india: 'IN',
  indonesia: 'ID',
  malaysia: 'MY',
  thailand: 'TH',
  vietnam: 'VN',
  philippines: 'PH',
  australia: 'AU',
  'new zealand': 'NZ',
  brazil: 'BR',
  argentina: 'AR',
  chile: 'CL',
  colombia: 'CO',
  'south africa': 'ZA',
  egypt: 'EG',
  serbia: 'RS',
  croatia: 'HR',
  slovakia: 'SK',
  slovenia: 'SI',
};
const nameToIso2 = name => (name ? COUNTRY_TO_ISO2[String(name).trim().toLowerCase()] || '' : '');
/* A configured address as a fetchable base URL, or '' when there is nothing
   usable. Callers must check for '' and report it rather than attempting a
   request: an empty field otherwise fetches http://undefined and reports itself
   as a network fault. */
const normBase = u => {
  const v = String(u ?? '').trim();
  if (!v) return '';
  return v.includes('://') ? v : `http://${v}`;
};

const MAP_DEFAULT_COLOR = {
  conduit: '#DB34F2',
  gluetun: '#30D158',
  netbird: '#FF9230',
  plausible: '#6D7CFF',
  umami: '#3CD3FE',
};

/* Conduit exposes Prometheus-style text, so the body must stay unparsed. */
/* This string travels in a successful response, so the api-error sanitiser
   never sees it. A caught error's message names the host and port it failed to
   reach, so use it only when this file wrote it. */
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT']);
function errorText(e) {
  if (e && e.vouchedMessage) return e.vouchedMessage;
  /* Already a sentence this repo wrote. */
  if (e && e.name === 'SsrfBlockedError') return e.message;
  const code = e && e.code;
  if (code === 'ECONNREFUSED') return 'Connection refused';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Host not found';
  if (TIMEOUT_CODES.has(code)) return 'Timed out';
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'Connection lost';
  if (typeof code === 'string' && (code.startsWith('CERT_') || code.includes('_CERT_'))) return 'Certificate rejected';
  return 'Unreachable';
}

function authErr(r) {
  return r.status === 401 || r.status === 403;
}

function parseConduitText(raw) {
  const regions = {};
  let limit = 0,
    connected = 0,
    live = 0;
  String(raw)
    .split('\n')
    .forEach(line => {
      let m = line.match(/^conduit_region_connected_clients\{region="([A-Z]{2})",scope="common"\}\s+([\d.eE+]+)/);
      if (m) {
        const v = Math.round(parseFloat(m[2]));
        if (v > 0) regions[m[1]] = v;
        return;
      }
      m = line.match(/^conduit_max_common_clients\s+([\d.eE+]+)/);
      if (m) {
        limit = parseFloat(m[1]);
        return;
      }
      m = line.match(/^conduit_connected_clients\s+([\d.eE+]+)/);
      if (m) {
        connected = parseFloat(m[1]);
        return;
      }
      m = line.match(/^conduit_is_live\s+([\d.eE+]+)/);
      if (m) live = parseFloat(m[1]);
    });
  return { regions, limit, connected, live };
}

const run = async function (ctx) {
  if (ctx.endpoint === 'vpn') return vpnView(ctx);
  return mapView(ctx);
};

/* ── VPN view ── */
async function vpnView(ctx) {
  const { config, fetchJSON } = ctx;
  const vpn = config.vpn || {};
  const svc = vpn.service || 'gluetun';
  const out = {
    service: svc,
    name: vpn.name || '',
    href: vpn.href || '',
    color: vpn.color || '#30D158',
    connected: false,
    status: 'unknown',
  };

  try {
    if (svc === 'gluetun') {
      const base = normBase(vpn.url);
      if (!base) ctx.fail('No control server URL configured', { kind: ctx.KIND.INVALID });
      const headers = vpn.apiKey ? { 'X-API-Key': vpn.apiKey } : {};
      let ipRes = null;
      try {
        ipRes = await fetchJSON(base + '/v1/publicip/ip', { headers, timeout: 7000 });
      } catch (e) {
        out.error = errorText(e);
      }
      if (ipRes) {
        if (authErr(ipRes)) out.error = 'Auth required — set the API key';
        else if (ipRes.status >= 400) out.error = 'Control server HTTP ' + ipRes.status;
        else {
          const d = ipRes.data || {};
          out.ip = d.public_ip || d.ip || '';
          out.city = d.city || '';
          out.region = d.region || '';
          out.country = d.country || '';
          out.countryCode = (d.country_code || nameToIso2(d.country) || '').toUpperCase();
          out.org = d.organization || d.org || '';
          {
            const L = d.location || d.loc;
            if (L) {
              const p = String(L).split(',');
              out.lat = +p[0];
              out.lng = +p[1];
            }
          }
        }
      }
      if (!out.error) {
        try {
          let s = await fetchJSON(base + '/v1/vpn/status', { headers, timeout: 6000 });
          if (s.status === 404) s = await fetchJSON(base + '/v1/openvpn/status', { headers, timeout: 6000 });
          if (s.status < 400 && s.data && s.data.status) out.status = s.data.status;
        } catch {}
        out.connected = !!out.ip || out.status === 'running';
      }
    } else {
      const base = normBase(vpn.url).replace(/\/+$/, '');
      if (!base) ctx.fail('No management API URL configured', { kind: ctx.KIND.INVALID });
      const apiBase = /\/api$/.test(base) ? base : base + '/api';
      const headers = { Authorization: `Token ${vpn.token || ''}`, Accept: 'application/json' };
      const r = await fetchJSON(apiBase + '/peers', { headers, timeout: 8000 });
      if (authErr(r)) ctx.fail('Auth failed — check the access token', { kind: ctx.KIND.AUTH });
      if (r.status >= 400) ctx.fail('Management API HTTP ' + r.status);
      const peers = Array.isArray(r.data) ? r.data : [];
      const connected = peers.filter(p => p && p.connected);
      out.peersTotal = peers.length;
      out.peersConnected = connected.length;
      out.connected = connected.length > 0;
      out.status = out.connected ? 'running' : 'stopped';
      const rep =
        connected
          .slice()
          .sort((a, b) => new Date(b.last_seen || 0) - new Date(a.last_seen || 0))
          .find(p => p.city_name || p.country_code) ||
        connected[0] ||
        null;
      if (rep) {
        out.city = rep.city_name || '';
        out.countryCode = (rep.country_code || '').toUpperCase();
        out.country = out.countryCode;
        out.hostname = rep.hostname || rep.name || '';
      }
    }
  } catch (e) {
    out.error = errorText(e);
  }

  return out;
}

/* ── Map view ── */
async function mapView(ctx) {
  const { config, fetchJSON } = ctx;
  const wc = config || {};
  const services = (Array.isArray(wc.services) ? wc.services : []).filter(s => s && s.enabled !== false && s.url);
  const results = await Promise.all(
    services.map(async (s, idx) => {
      const base = normBase(s.url);
      const o = {
        id: s.id || s.type + '-' + idx,
        type: s.type,
        name: s.name || s.type.charAt(0).toUpperCase() + s.type.slice(1),
        color: s.color || MAP_DEFAULT_COLOR[s.type] || '#DB34F2',
        adminUrl: s.adminUrl || '',
      };
      try {
        /* Say the address is missing rather than letting a doomed request
           report itself as a network fault. */
        if (!base) ctx.fail('No URL configured', { kind: ctx.KIND.INVALID });
        if (s.type === 'conduit') {
          const r = await fetchJSON(new URL('/metrics', base).href, { raw: true });
          if (r.status >= 400) ctx.fail('HTTP ' + r.status);
          Object.assign(o, { kind: 'regions' }, parseConduitText(r.data));
        } else if (s.type === 'gluetun') {
          const r = await fetchJSON(base + '/v1/publicip/ip', { headers: s.apiKey ? { 'X-API-Key': s.apiKey } : {} });
          if (r.status === 401) ctx.fail('Auth required — set the API key', { kind: ctx.KIND.AUTH });
          if (r.status >= 400) ctx.fail('HTTP ' + r.status);
          const d = r.data || {};
          const L = d.location || d.loc;
          o.kind = 'point';
          o.city = d.city || '';
          o.country = d.country || '';
          if (L) {
            const p = String(L).split(',');
            o.lat = +p[0];
            o.lng = +p[1];
          }
        } else if (s.type === 'netbird') {
          const r = await fetchJSON(base + '/api/peers', {
            headers: s.token ? { Authorization: 'Token ' + s.token } : {},
          });
          if (authErr(r)) ctx.fail('Auth required — check the token', { kind: ctx.KIND.AUTH });
          if (r.status >= 400) ctx.fail('HTTP ' + r.status);
          const peers = Array.isArray(r.data) ? r.data : [];
          const regions = {};
          let conn = 0;
          peers.forEach(p => {
            if (p && p.connected) {
              conn++;
              const cc = (p.country_code || '').toUpperCase();
              if (cc) regions[cc] = (regions[cc] || 0) + 1;
            }
          });
          o.kind = 'regions';
          o.regions = regions;
          o.connected = conn;
          o.peersTotal = peers.length;
          o.limit = 0;
        } else if (s.type === 'plausible') {
          const body = JSON.stringify({
            site_id: s.siteId || '',
            metrics: ['visitors'],
            date_range: '7d',
            dimensions: ['visit:country'],
          });
          const r = await fetchJSON(base + '/api/v2/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: s.apiKey ? 'Bearer ' + s.apiKey : '' },
            body,
          });
          if (authErr(r)) ctx.fail('Auth required — check the API key', { kind: ctx.KIND.AUTH });
          if (r.status >= 400) ctx.fail('HTTP ' + r.status);
          const rows = (r.data && r.data.results) || [];
          const regions = {};
          let total = 0;
          rows.forEach(row => {
            const cc = ((row.dimensions && row.dimensions[0]) || '').toUpperCase();
            const v = (row.metrics && +row.metrics[0]) || 0;
            if (cc && v > 0) {
              regions[cc] = (regions[cc] || 0) + v;
              total += v;
            }
          });
          o.kind = 'regions';
          o.regions = regions;
          o.connected = total;
          o.limit = 0;
        } else if (s.type === 'umami') {
          const lg = await fetchJSON(base + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: s.username || '', password: s.password || '' }),
          });
          if (authErr(lg)) ctx.fail('Auth required — check username/password', { kind: ctx.KIND.AUTH });
          if (lg.status >= 400) ctx.fail('Login HTTP ' + lg.status);
          const token = lg.data && lg.data.token;
          if (!token) ctx.fail('Login failed', { kind: ctx.KIND.AUTH });
          const end = Date.now(),
            start = end - 7 * 24 * 3600 * 1000;
          const r = await fetchJSON(
            base +
              '/api/websites/' +
              encodeURIComponent(s.websiteId || '') +
              '/metrics?type=country&startAt=' +
              start +
              '&endAt=' +
              end,
            { headers: { Authorization: 'Bearer ' + token } },
          );
          if (r.status >= 400) ctx.fail('HTTP ' + r.status);
          const rows = Array.isArray(r.data) ? r.data : [];
          const regions = {};
          let total = 0;
          rows.forEach(row => {
            const cc = (row.x || '').toUpperCase();
            const v = +row.y || 0;
            if (cc && v > 0) {
              regions[cc] = (regions[cc] || 0) + v;
              total += v;
            }
          });
          o.kind = 'regions';
          o.regions = regions;
          o.connected = total;
          o.limit = 0;
        } else {
          o.error = 'Unsupported service type';
        }
      } catch (e) {
        o.error = errorText(e);
      }
      return o;
    }),
  );
  return { services: results, meta: { showLegend: wc.showLegend !== false } };
}

module.exports = run;
module.exports.normBase = normBase;
