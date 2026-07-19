/* Connections widget data function. Two endpoints:
     endpoint=vpn  → single-tunnel status (gluetun control server or NetBird mesh)
     endpoint=map  → per-service geo/region data for the dot-matrix world map
   Self-contained: carries its own helpers so it doesn't depend on routes.js.
   Returns a result object (errors are reported inside it, never thrown). */

const COUNTRY_TO_ISO2 = {
  'united states':'US','united states of america':'US','usa':'US','canada':'CA','mexico':'MX',
  'united kingdom':'GB','uk':'GB','ireland':'IE','netherlands':'NL','germany':'DE','france':'FR',
  'spain':'ES','portugal':'PT','italy':'IT','switzerland':'CH','austria':'AT','belgium':'BE',
  'luxembourg':'LU','sweden':'SE','norway':'NO','denmark':'DK','finland':'FI','iceland':'IS',
  'poland':'PL','czechia':'CZ','czech republic':'CZ','romania':'RO','bulgaria':'BG','hungary':'HU',
  'greece':'GR','ukraine':'UA','estonia':'EE','latvia':'LV','lithuania':'LT','moldova':'MD',
  'russia':'RU','turkey':'TR','israel':'IL','united arab emirates':'AE','japan':'JP','south korea':'KR',
  'korea':'KR','singapore':'SG','hong kong':'HK','taiwan':'TW','india':'IN','indonesia':'ID',
  'malaysia':'MY','thailand':'TH','vietnam':'VN','philippines':'PH','australia':'AU','new zealand':'NZ',
  'brazil':'BR','argentina':'AR','chile':'CL','colombia':'CO','south africa':'ZA','egypt':'EG',
  'serbia':'RS','croatia':'HR','slovakia':'SK','slovenia':'SI',
};
const nameToIso2 = name => name ? (COUNTRY_TO_ISO2[String(name).trim().toLowerCase()] || '') : '';
const normBase   = u => u ? (u.includes('://') ? u : `http://${u}`) : '';

const MAP_DEFAULT_COLOR = { conduit:'#AF52DE', gluetun:'#30D158', netbird:'#FF9F0A', plausible:'#5E5CE6', umami:'#64D2FF' };
const mapNormBase = u => (u && u.includes('://')) ? u : ('http://' + u);

/* Services array; falls back to synthesizing one from legacy single-instance config. */
function mapServices(wc){
  if (Array.isArray(wc.services) && wc.services.length) return wc.services;
  const out = [];
  if (wc.conduit?.url) out.push({ id:'conduit', type:'conduit', name:wc.conduit.name||'Conduit', color:wc.conduit.color||MAP_DEFAULT_COLOR.conduit, url:wc.conduit.url, adminUrl:wc.conduit.adminUrl||'', enabled:wc.conduit.enabled!==false });
  if (wc.gluetun?.url) out.push({ id:'gluetun', type:'gluetun', name:wc.gluetun.name||'Gluetun', color:wc.gluetun.color||MAP_DEFAULT_COLOR.gluetun, url:wc.gluetun.url, adminUrl:wc.gluetun.adminUrl||'', enabled:wc.gluetun.enabled!==false });
  return out;
}

/* Raw GET: Conduit exposes Prometheus-style text that needs the unparsed body. */
function parseConduitText(raw){
  const regions = {}; let limit = 0, connected = 0, live = 0;
  String(raw).split('\n').forEach(line => {
    let m = line.match(/^conduit_region_connected_clients\{region="([A-Z]{2})",scope="common"\}\s+([\d.eE+]+)/);
    if (m) { const v = Math.round(parseFloat(m[2])); if (v > 0) regions[m[1]] = v; return; }
    m = line.match(/^conduit_max_common_clients\s+([\d.eE+]+)/);
    if (m) { limit = parseFloat(m[1]); return; }
    m = line.match(/^conduit_connected_clients\s+([\d.eE+]+)/);
    if (m) { connected = parseFloat(m[1]); return; }
    m = line.match(/^conduit_is_live\s+([\d.eE+]+)/);
    if (m) live = parseFloat(m[1]);
  });
  return { regions, limit, connected, live };
}

module.exports = async function ({ config, endpoint, fetchJSON }) {
  if (endpoint === 'vpn') return vpnView(config, fetchJSON);
  return mapView(config, fetchJSON);
};

/* ── VPN view ── */
async function vpnView(config, fetchJSON) {
  const vpn = config.vpn || {};
  const svc = vpn.service || 'gluetun';
  const out = { service: svc, name: vpn.name || '', href: vpn.href || '', color: vpn.color || '#30D158', connected:false, status:'unknown' };

  try {
    if (svc === 'gluetun') {
      const base = normBase(vpn.url);
      if (!base) throw new Error('No control server URL configured');
      const headers = vpn.apiKey ? { 'X-API-Key': vpn.apiKey } : {};
      let ipRes = null;
      try { ipRes = await fetchJSON(base + '/v1/publicip/ip', { headers, timeout:7000 }); }
      catch(e) { out.error = e.code || e.message || 'unreachable'; }
      if (ipRes) {
        if (ipRes.status === 401 || ipRes.status === 403) out.error = 'Auth required — set the API key';
        else if (ipRes.status >= 400) out.error = 'Control server HTTP ' + ipRes.status;
        else {
          const d = ipRes.data || {};
          out.ip = d.public_ip || d.ip || '';
          out.city = d.city || ''; out.region = d.region || ''; out.country = d.country || '';
          out.countryCode = (d.country_code || nameToIso2(d.country) || '').toUpperCase();
          out.org = d.organization || d.org || '';
          { const L = d.location || d.loc; if (L) { const p = String(L).split(','); out.lat = +p[0]; out.lng = +p[1]; } }
        }
      }
      if (!out.error) {
        try {
          let s = await fetchJSON(base + '/v1/vpn/status', { headers, timeout:6000 });
          if (s.status === 404) s = await fetchJSON(base + '/v1/openvpn/status', { headers, timeout:6000 });
          if (s.status < 400 && s.data && s.data.status) out.status = s.data.status;
        } catch { /* ignore: publicip already decided */ }
        out.connected = !!out.ip || out.status === 'running';
      }
    } else {
      const base = normBase(vpn.url).replace(/\/+$/,'');
      if (!base) throw new Error('No management API URL configured');
      const apiBase = /\/api$/.test(base) ? base : base + '/api';
      const headers = { 'Authorization': `Token ${vpn.token || ''}`, 'Accept':'application/json' };
      const r = await fetchJSON(apiBase + '/peers', { headers, timeout:8000 });
      if (r.status === 401 || r.status === 403) throw new Error('Auth failed — check the access token');
      if (r.status >= 400) throw new Error('Management API HTTP ' + r.status);
      const peers = Array.isArray(r.data) ? r.data : [];
      const connected = peers.filter(p => p && p.connected);
      out.peersTotal = peers.length;
      out.peersConnected = connected.length;
      out.connected = connected.length > 0;
      out.status = out.connected ? 'running' : 'stopped';
      const rep = connected.slice()
        .sort((a,b) => new Date(b.last_seen||0) - new Date(a.last_seen||0))
        .find(p => p.city_name || p.country_code) || connected[0] || null;
      if (rep) {
        out.city = rep.city_name || '';
        out.countryCode = (rep.country_code || '').toUpperCase();
        out.country = out.countryCode;
        out.hostname = rep.hostname || rep.name || '';
      }
    }
  } catch(e) { out.error = e.message; }

  return out;
}

/* ── Map view ── */
async function mapView(config, fetchJSON) {
  const wc = config || {};
  const services = mapServices(wc).filter(s => s && s.enabled !== false && s.url);
  const results = await Promise.all(services.map(async (s, idx) => {
    const base = mapNormBase(s.url);
    const o = { id: s.id || (s.type + '-' + idx), type: s.type,
      name: s.name || (s.type.charAt(0).toUpperCase() + s.type.slice(1)),
      color: s.color || MAP_DEFAULT_COLOR[s.type] || '#AF52DE', adminUrl: s.adminUrl || '' };
    try {
      if (s.type === 'conduit') {
        const r = await fetchJSON(new URL('/metrics', base).href, { raw: true });
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        Object.assign(o, { kind:'regions' }, parseConduitText(r.data));
      } else if (s.type === 'gluetun') {
        const r = await fetchJSON(base + '/v1/publicip/ip', { headers: s.apiKey ? { 'X-API-Key': s.apiKey } : {} });
        if (r.status === 401) throw new Error('Auth required — set the API key');
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        const d = r.data || {}; const L = d.location || d.loc;
        o.kind = 'point'; o.city = d.city || ''; o.country = d.country || '';
        if (L) { const p = String(L).split(','); o.lat = +p[0]; o.lng = +p[1]; }
      } else if (s.type === 'netbird') {
        const r = await fetchJSON(base + '/api/peers', { headers: s.token ? { 'Authorization': 'Token ' + s.token } : {} });
        if (r.status === 401 || r.status === 403) throw new Error('Auth required — check the token');
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        const peers = Array.isArray(r.data) ? r.data : [];
        const regions = {}; let conn = 0;
        peers.forEach(p => { if (p && p.connected) { conn++; const cc = (p.country_code || '').toUpperCase(); if (cc) regions[cc] = (regions[cc] || 0) + 1; } });
        o.kind = 'regions'; o.regions = regions; o.connected = conn; o.peersTotal = peers.length; o.limit = 0;
      } else if (s.type === 'plausible') {
        const body = JSON.stringify({ site_id: s.siteId || '', metrics: ['visitors'], date_range: '7d', dimensions: ['visit:country'] });
        const r = await fetchJSON(base + '/api/v2/query', { method:'POST', headers: { 'Content-Type':'application/json', 'Authorization': s.apiKey ? ('Bearer ' + s.apiKey) : '' }, body });
        if (r.status === 401 || r.status === 403) throw new Error('Auth required — check the API key');
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        const rows = (r.data && r.data.results) || [];
        const regions = {}; let total = 0;
        rows.forEach(row => { const cc = (row.dimensions && row.dimensions[0] || '').toUpperCase(); const v = (row.metrics && +row.metrics[0]) || 0; if (cc && v > 0) { regions[cc] = (regions[cc] || 0) + v; total += v; } });
        o.kind = 'regions'; o.regions = regions; o.connected = total; o.limit = 0;
      } else if (s.type === 'umami') {
        const lg = await fetchJSON(base + '/api/auth/login', { method:'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ username: s.username || '', password: s.password || '' }) });
        if (lg.status === 401 || lg.status === 403) throw new Error('Auth required — check username/password');
        if (lg.status >= 400) throw new Error('Login HTTP ' + lg.status);
        const token = lg.data && lg.data.token;
        if (!token) throw new Error('Login failed');
        const end = Date.now(), start = end - 7*24*3600*1000;
        const r = await fetchJSON(base + '/api/websites/' + encodeURIComponent(s.websiteId || '') + '/metrics?type=country&startAt=' + start + '&endAt=' + end, { headers: { 'Authorization': 'Bearer ' + token } });
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        const rows = Array.isArray(r.data) ? r.data : [];
        const regions = {}; let total = 0;
        rows.forEach(row => { const cc = (row.x || '').toUpperCase(); const v = +row.y || 0; if (cc && v > 0) { regions[cc] = (regions[cc] || 0) + v; total += v; } });
        o.kind = 'regions'; o.regions = regions; o.connected = total; o.limit = 0;
      } else {
        o.error = 'Unsupported service type';
      }
    } catch(e) { o.error = e.message || String(e); }
    return o;
  }));
  return { services: results, meta: { showLegend: wc.showLegend !== false } };
}
