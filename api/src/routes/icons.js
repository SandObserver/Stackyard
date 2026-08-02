const fs = require('fs');
const path = require('path');
const { on, json, checkOrigin, getIp } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { loadConfig, ICONS_PATH } = require('../config');
const { fetchUnchecked } = require('../proxy');
const log = require('../log');
const { fail, KIND, errorBody } = require('../api-error');

/* The icon itself, and the whole multipart request that carries it. The stream
   limit is the larger of the two because the request also contains boundaries
   and headers, so cutting it off at exactly the file limit would reject a file
   that is within it. */
const ICON_MAX_BYTES = 2 * 1024 * 1024;
const ICON_STREAM_MAX_BYTES = Math.round(ICON_MAX_BYTES * 1.25);
const { rateLimit } = require('../auth');
const { sanitizeSvg } = require('../svg-sanitize');
const { sniffIconType } = require('../icon-sniff');
const { parseMultipartFile } = require('../parse-multipart');

on('GET', '/api/wallpaper', async(_, res) => {
  const cfg = loadConfig(), bg = cfg.settings?.background || {};
  if (bg.type !== 'unsplash') return json(res, 200, { url:null });
  try {
    const p = new URLSearchParams({ orientation:'landscape', content_filter:'high', client_id:bg.apiKey||'' });
    if (bg.collection) p.set('collections', bg.collection);
    const r   = await fetchUnchecked(`https://api.unsplash.com/photos/random?${p}`);
    const raw = r.data?.urls?.raw;
    if (!raw) return json(res, 200, { url:null, error: r.data?.errors?.[0] || 'No image returned' });
    json(res, 200, { url:`${raw}&w=2800&h=1800&q=85&fm=jpg&fit=crop&crop=entropy` });
  } catch(e) { json(res, 200, Object.assign({ url:null }, errorBody(e))); }
});

let _iconCache = null, _iconCacheAt = 0;
const ICON_CACHE_TTL = 24 * 60 * 60 * 1000;

on('GET', '/api/icons/search', async(req, res) => {
  const q = (new URL(req.url,'http://x').searchParams.get('q')||'').toLowerCase().trim();
  if (!q) return json(res, 200, { results:[] });
  try {
    if (!_iconCache || (Date.now() - _iconCacheAt) > ICON_CACHE_TTL) {
      const r = await fetchUnchecked('https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/metadata/icons.json');
      _iconCache = Array.isArray(r.data) ? r.data : []; _iconCacheAt = Date.now();
    }
    json(res, 200, { results:_iconCache
      .filter(ic => (ic.name||ic.slug||'').toLowerCase().includes(q))
      .slice(0,20)
      .map(ic => ({ name:ic.name||ic.slug, slug:ic.slug||ic.name,
        svgUrl:`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${ic.slug||ic.name}.svg`,
        pngUrl:`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${ic.slug||ic.name}.png` })) });
  } catch(e) { fail(res, e, { status:502 }); }
});

on('GET', '/api/icons/local', (_, res) => {
  try {
    fs.mkdirSync(ICONS_PATH, { recursive:true });
    json(res, 200, { files:fs.readdirSync(ICONS_PATH).filter(f => /\.(svg|png|ico)$/i.test(f)) });
  } catch(e) { fail(res, e, { status:500 }); }
});

on('POST', '/api/icons/upload', async(req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'upload', 20, 3_600_000);
    if (limited) return json(res, 429, { error:limited, kind: KIND.BLOCKED });
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) return json(res, 400, { error:'multipart/form-data required', kind: KIND.INVALID });
    const bMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
    if (!bMatch) return json(res, 400, { error:'missing boundary', kind: KIND.INVALID });
    const boundary = bMatch[1] || bMatch[2];
    const buf = await new Promise((resolve, reject) => {
      const chunks = []; let total = 0;
      req.on('data', c => { total += c.length; if (total > ICON_STREAM_MAX_BYTES) { req.destroy(); return reject(new Error('file too large (max 2 MB)')); } chunks.push(c); });
      req.on('end',  () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    const { filename, data, fileParts } = parseMultipartFile(buf, boundary);
    let fileData = data;
    if (!filename || !fileData?.length)       return json(res, 400, { error:'no file found in upload', kind: KIND.INVALID });
    if (fileParts > 1)                        return json(res, 400, { error:'only one file per upload', kind: KIND.INVALID });
    if (!/\.(svg|png|ico)$/i.test(filename))  return json(res, 400, { error:'only .svg, .png, .ico files allowed', kind: KIND.INVALID });
    /* Every icon shipped with Stackyard is under 34 KB, and most are under 9 KB,
       so 2 MB is generous by a wide margin. It is kept there rather than
       tightened because the cost of being wrong is asymmetric: a rejected icon
       is a support question, while the memory saved by a lower cap is
       negligible at these sizes. See BODY_LIMIT in router.js. */
    if (fileData.length > ICON_MAX_BYTES)     return json(res, 400, { error:'file too large (max 2 MB)', kind: KIND.INVALID });
    if (/\.svg$/i.test(filename)) {
      fileData = Buffer.from(sanitizeSvg(fileData.toString('utf8')), 'utf8');
    } else if (!sniffIconType(fileData)) {
      return json(res, 400, { error:'file is not a valid PNG or ICO image', kind: KIND.INVALID });
    }
    fs.mkdirSync(ICONS_PATH, { recursive:true });
    fs.writeFileSync(path.join(ICONS_PATH, filename), fileData);
    log.audit('icon uploaded', { filename });
    json(res, 200, { ok:true, filename });
  } catch(e) { fail(res, e, { status:500 }); }
});

