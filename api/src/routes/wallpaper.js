const fs = require('fs');
const path = require('path');
const { on, json, checkOrigin, getIp } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { loadConfig, ICONS_PATH } = require('../config');
const { fetchChecked, fetchUnchecked, SsrfBlockedError } = require('../proxy');
const { rateLimit } = require('../auth');
const { sniffImageType } = require('../image-sniff');
const { parseMultipartFile } = require('../parse-multipart');
const log = require('../log');
const { fail, KIND, errorBody } = require('../api-error');

/** Wallpapers live under the icons mount, in their own directory: the icon
    picker lists the top level, and a wallpaper is not an icon. */
const WALLPAPER_DIR = () => path.join(ICONS_PATH, 'wallpaper');
const WALLPAPER_URL_BASE = '/icons/wallpaper/';

/* A 4K wallpaper is the size to carry. Keep client_max_body_size on
   /api/wallpaper/upload in nginx/dashboard.conf at or above this. */
const UPLOAD_MAX_BYTES = 16 * 1024 * 1024;
const UPLOAD_STREAM_MAX_BYTES = Math.round(UPLOAD_MAX_BYTES * 1.25);

/* A photo over a slow link takes longer than a widget's JSON poll. Keep
   proxy_read_timeout on /api/wallpaper/fetch in nginx above this. */
const FETCH_TIMEOUT_MS = 30_000;

/** The stored name is generated, never the submitted one: it is served from
    this origin, and the extension follows the sniffed bytes.

    @param {string} ext @returns {string} */
function wallpaperName(ext) {
  return `wallpaper-${Date.now().toString(36)}${ext}`;
}

/** Write the image and drop the one it replaces. One wallpaper is stored at a
    time, so the directory cannot grow without bound.

    @param {Buffer} data @param {string} ext @returns {string} the served URL */
function storeWallpaper(data, ext) {
  const dir = WALLPAPER_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const saved = wallpaperName(ext);
  fs.writeFileSync(path.join(dir, saved), data);
  for (const f of fs.readdirSync(dir)) {
    if (f !== saved) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {}
    }
  }
  return WALLPAPER_URL_BASE + saved;
}

on('GET', '/api/wallpaper', async (_, res) => {
  const cfg = loadConfig(),
    bg = cfg.settings?.background || {};
  if (bg.type !== 'unsplash') return json(res, 200, { url: null });
  try {
    const p = new URLSearchParams({ orientation: 'landscape', content_filter: 'high', client_id: bg.apiKey || '' });
    if (bg.collection) p.set('collections', bg.collection);
    const r = await fetchUnchecked(`https://api.unsplash.com/photos/random?${p}`);
    const raw = r.data?.urls?.raw;
    if (!raw) return json(res, 200, { url: null, error: r.data?.errors?.[0] || 'No image returned' });
    json(res, 200, { url: `${raw}&w=2800&h=1800&q=85&fm=jpg&fit=crop&crop=entropy` });
  } catch (e) {
    json(res, 200, Object.assign({ url: null }, errorBody(e)));
  }
});

on('POST', '/api/wallpaper/upload', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  try {
    const limited = rateLimit(getIp(req), 'upload', 20, 3_600_000);
    if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED });
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data'))
      return json(res, 400, { error: 'multipart/form-data required', kind: KIND.INVALID });
    const bMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
    if (!bMatch) return json(res, 400, { error: 'missing boundary', kind: KIND.INVALID });
    const buf = await new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      req.on('data', c => {
        total += c.length;
        if (total > UPLOAD_STREAM_MAX_BYTES) {
          req.destroy();
          return reject(new Error('image too large (max 16 MB)'));
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    const { filename, data, fileParts } = parseMultipartFile(buf, bMatch[1] || bMatch[2]);
    if (!filename || !data?.length) return json(res, 400, { error: 'no file found in upload', kind: KIND.INVALID });
    if (fileParts > 1) return json(res, 400, { error: 'only one file per upload', kind: KIND.INVALID });
    if (data.length > UPLOAD_MAX_BYTES)
      return json(res, 400, { error: 'image too large (max 16 MB)', kind: KIND.INVALID });
    const kind = sniffImageType(data);
    if (!kind) return json(res, 400, { error: 'file is not a JPEG, PNG, WebP, AVIF or GIF image', kind: KIND.INVALID });
    const url = storeWallpaper(data, kind.ext);
    log.audit('wallpaper uploaded', { url, type: kind.type, bytes: data.length });
    json(res, 200, { ok: true, url });
  } catch (e) {
    fail(res, e, { status: 500 });
  }
});

on('POST', '/api/wallpaper/fetch', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  try {
    const limited = rateLimit(getIp(req), 'upload', 20, 3_600_000);
    if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED });
    const body = await new Promise((resolve, reject) => {
      let s = '';
      req.on('data', c => {
        s += c;
        if (s.length > 4096) {
          req.destroy();
          reject(new Error('request too large'));
        }
      });
      req.on('end', () => resolve(s));
      req.on('error', reject);
    });
    let url = '';
    try {
      url = String(JSON.parse(body || '{}').url || '').trim();
    } catch {
      return json(res, 400, { error: 'invalid JSON body', kind: KIND.INVALID });
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return json(res, 400, { error: 'that is not a valid URL', kind: KIND.INVALID });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return json(res, 400, { error: 'only http and https links can be fetched', kind: KIND.INVALID });

    const r = await fetchChecked(url, { binary: true, maxBytes: UPLOAD_MAX_BYTES, timeout: FETCH_TIMEOUT_MS });
    if (r.status !== 200)
      return json(res, 502, { error: `the image could not be fetched (HTTP ${r.status})`, kind: KIND.UPSTREAM });
    const data = Buffer.isBuffer(r.data) ? r.data : Buffer.alloc(0);
    const kind = sniffImageType(data);
    if (!kind)
      return json(res, 400, { error: 'that link is not a JPEG, PNG, WebP, AVIF or GIF image', kind: KIND.INVALID });
    const saved = storeWallpaper(data, kind.ext);
    log.audit('wallpaper fetched', { url: parsed.origin + parsed.pathname, type: kind.type, bytes: data.length });
    json(res, 200, { ok: true, url: saved });
  } catch (e) {
    if (e instanceof SsrfBlockedError) return json(res, 403, { error: e.message, kind: KIND.BLOCKED });
    fail(res, e, { status: 502 });
  }
});

module.exports = { storeWallpaper, WALLPAPER_URL_BASE };
