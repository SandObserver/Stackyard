const fs = require('fs');
const path = require('path');
const { on, json, checkOrigin, getIp } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { loadConfig, ICONS_PATH } = require('../config');
const { fetchJSON } = require('../proxy');
const log = require('../log');
const { rateLimit } = require('../auth');
const { sanitizeSvg } = require('../svg-sanitize');

on('GET', '/api/wallpaper', async(_, res) => {
  const cfg = loadConfig(), bg = cfg.settings?.background || {};
  if (bg.type !== 'unsplash') return json(res, 200, { url:null });
  try {
    const p = new URLSearchParams({ orientation:'landscape', content_filter:'high', client_id:bg.apiKey||'' });
    if (bg.collection) p.set('collections', bg.collection);
    const r   = await fetchJSON(`https://api.unsplash.com/photos/random?${p}`);
    const raw = r.data?.urls?.raw;
    if (!raw) return json(res, 200, { url:null, error: r.data?.errors?.[0] || 'No image returned' });
    json(res, 200, { url:`${raw}&w=2800&h=1800&q=85&fm=jpg&fit=crop&crop=entropy` });
  } catch(e) { json(res, 200, { url:null, error:e.message }); }
});

let _iconCache = null, _iconCacheAt = 0;
const ICON_CACHE_TTL = 24 * 60 * 60 * 1000;

on('GET', '/api/icons/search', async(req, res) => {
  const q = (new URL(req.url,'http://x').searchParams.get('q')||'').toLowerCase().trim();
  if (!q) return json(res, 200, { results:[] });
  try {
    if (!_iconCache || (Date.now() - _iconCacheAt) > ICON_CACHE_TTL) {
      const r = await fetchJSON('https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/metadata/icons.json');
      _iconCache = Array.isArray(r.data) ? r.data : []; _iconCacheAt = Date.now();
    }
    json(res, 200, { results:_iconCache
      .filter(ic => (ic.name||ic.slug||'').toLowerCase().includes(q))
      .slice(0,20)
      .map(ic => ({ name:ic.name||ic.slug, slug:ic.slug||ic.name,
        svgUrl:`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${ic.slug||ic.name}.svg`,
        pngUrl:`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${ic.slug||ic.name}.png` })) });
  } catch(e) { json(res, 502, { error:e.message }); }
});

on('GET', '/api/icons/local', (_, res) => {
  try {
    fs.mkdirSync(ICONS_PATH, { recursive:true });
    json(res, 200, { files:fs.readdirSync(ICONS_PATH).filter(f => /\.(svg|png|ico)$/i.test(f)) });
  } catch(e) { json(res, 500, { error:e.message }); }
});

on('POST', '/api/icons/upload', async(req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG });
  if (!checkOrigin(req, res)) return;
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'upload', 20, 3_600_000);
    if (limited) return json(res, 429, { error:limited });
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) return json(res, 400, { error:'multipart/form-data required' });
    const bMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
    if (!bMatch) return json(res, 400, { error:'missing boundary' });
    const boundary = bMatch[1] || bMatch[2];
    const buf = await new Promise((resolve, reject) => {
      const chunks = []; let total = 0;
      req.on('data', c => { total += c.length; if (total > 2.5*1024*1024) { req.destroy(); return reject(new Error('file too large (max 2 MB)')); } chunks.push(c); });
      req.on('end',  () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    const delim = Buffer.from('--' + boundary), CRLFCRLF = Buffer.from('\r\n\r\n');
    let filename = '', fileData = null, searchFrom = 0;
    while (true) {
      const delimPos = buf.indexOf(delim, searchFrom);
      if (delimPos === -1) break;
      const afterDelim = delimPos + delim.length;
      if (buf[afterDelim] === 0x2d && buf[afterDelim+1] === 0x2d) break;
      const headerStart = afterDelim + (buf[afterDelim] === 0x0d ? 2 : 0);
      const headerEnd   = buf.indexOf(CRLFCRLF, headerStart);
      if (headerEnd === -1) break;
      const headerStr  = buf.slice(headerStart, headerEnd).toString('latin1');
      const bodyStart  = headerEnd + 4;
      const nextDelim  = buf.indexOf(Buffer.from('\r\n--' + boundary), bodyStart);
      const bodyEnd    = nextDelim === -1 ? buf.length : nextDelim;
      const fnMatch    = headerStr.match(/filename="([^"]+)"/i);
      if (fnMatch) { filename = path.basename(fnMatch[1]); fileData = buf.slice(bodyStart, bodyEnd); }
      searchFrom = bodyEnd + 2;
    }
    if (!filename || !fileData?.length)       return json(res, 400, { error:'no file found in upload' });
    if (!/\.(svg|png|ico)$/i.test(filename))  return json(res, 400, { error:'only .svg, .png, .ico files allowed' });
    if (fileData.length > 2*1024*1024)        return json(res, 400, { error:'file too large (max 2 MB)' });
    if (/\.svg$/i.test(filename)) {
      fileData = Buffer.from(sanitizeSvg(fileData.toString('utf8')), 'utf8');
    }
    fs.mkdirSync(ICONS_PATH, { recursive:true });
    fs.writeFileSync(path.join(ICONS_PATH, filename), fileData);
    log.audit('icon uploaded', { filename });
    json(res, 200, { ok:true, filename });
  } catch(e) { json(res, 500, { error:e.message }); }
});

