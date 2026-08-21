const crypto = require('crypto');
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

const WALLPAPER_DIR = () => path.join(ICONS_PATH, 'wallpaper');
const WALLPAPER_URL_BASE = '/icons/wallpaper/';

/* Keep client_max_body_size on /api/wallpaper/upload at or above this. nginx
   refuses a larger body before the request reaches this code. */
const UPLOAD_MAX_BYTES = 16 * 1024 * 1024;
const UPLOAD_STREAM_MAX_BYTES = Math.round(UPLOAD_MAX_BYTES * 1.25);
const LINK_BODY_MAX_BYTES = 4096;
const UPLOADS_PER_HOUR = 20;

/* Keep proxy_read_timeout on /api/wallpaper/fetch above this. */
const FETCH_TIMEOUT_MS = 30_000;

const ACCEPTED = 'JPEG, PNG, WebP, AVIF or GIF';
const TOO_LARGE = 'image too large (max 16 MB)';

/* A message only reaches the browser when the route hands it over itself. See
   docs/api-errors.md. */
const oversize = () => Object.assign(new Error('body over the limit'), { oversize: true });

/** @param {string} ext @returns {string} */
function wallpaperName(ext) {
  return `wallpaper-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext}`;
}

/** Writes the image under a generated name and returns the URL it is served at.
    Deletes nothing: until a config write names the new file, the file it
    replaces is still the wallpaper on screen.

    @param {Buffer} data @param {string} ext @returns {string} */
function storeWallpaper(data, ext) {
  const dir = WALLPAPER_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const saved = wallpaperName(ext);
  fs.writeFileSync(path.join(dir, saved), data);
  return WALLPAPER_URL_BASE + saved;
}

/** @param {string[]} files names in the directory, oldest first
    @param {string} referenced the name the config points at, or ''
    @returns {string[]} the names to delete */
function wallpapersToDrop(files, referenced) {
  if (referenced && files.includes(referenced)) return files.filter(f => f !== referenced);
  const newest = files[files.length - 1];
  return files.filter(f => f !== newest);
}

/** @param {string} dir @returns {string[]} names, oldest first */
function storedByAge(dir) {
  return fs
    .readdirSync(dir)
    .map(name => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .map(f => f.name);
}

/** Removes every stored wallpaper the saved config no longer points at.

    @param {unknown} url `settings.background.url` @returns {void} */
function pruneWallpapers(url) {
  const dir = WALLPAPER_DIR();
  let files;
  try {
    files = storedByAge(dir);
  } catch {
    return;
  }
  const referenced = typeof url === 'string' && url.startsWith(WALLPAPER_URL_BASE) ? path.basename(url) : '';
  for (const name of wallpapersToDrop(files, referenced)) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch (e) {
      log.warn('wallpaper could not be removed', { name, error: e.message });
    }
  }
}

/** @param {import('http').IncomingMessage} req @param {number} max
    @returns {Promise<Buffer>} */
function readBodyCapped(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > max) {
        req.destroy();
        return reject(oversize());
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res
    @returns {boolean} whether the request may write a wallpaper */
function mayWrite(req, res) {
  if (IS_DEMO) {
    json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
    return false;
  }
  if (!checkOrigin(req, res)) return false;
  const limited = rateLimit(getIp(req), 'upload', UPLOADS_PER_HOUR, 3_600_000);
  if (limited) {
    json(res, 429, { error: limited, kind: KIND.BLOCKED });
    return false;
  }
  return true;
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
  if (!mayWrite(req, res)) return;
  try {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data'))
      return json(res, 400, { error: 'multipart/form-data required', kind: KIND.INVALID });
    const bMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
    if (!bMatch) return json(res, 400, { error: 'missing boundary', kind: KIND.INVALID });

    const buf = await readBodyCapped(req, UPLOAD_STREAM_MAX_BYTES);
    const { filename, data, fileParts } = parseMultipartFile(buf, bMatch[1] || bMatch[2]);
    if (!filename || !data?.length) return json(res, 400, { error: 'no file found in upload', kind: KIND.INVALID });
    if (fileParts > 1) return json(res, 400, { error: 'only one file per upload', kind: KIND.INVALID });
    if (data.length > UPLOAD_MAX_BYTES) return json(res, 400, { error: TOO_LARGE, kind: KIND.INVALID });
    const kind = sniffImageType(data);
    if (!kind) return json(res, 400, { error: `file is not a ${ACCEPTED} image`, kind: KIND.INVALID });

    const url = storeWallpaper(data, kind.ext);
    log.audit('wallpaper uploaded', { url, type: kind.type, bytes: data.length });
    json(res, 200, { ok: true, url });
  } catch (e) {
    if (e.oversize) return json(res, 400, { error: TOO_LARGE, kind: KIND.INVALID });
    fail(res, e, { status: 500 });
  }
});

on('POST', '/api/wallpaper/fetch', async (req, res) => {
  if (!mayWrite(req, res)) return;
  try {
    const body = await readBodyCapped(req, LINK_BODY_MAX_BYTES);
    let url = '';
    try {
      url = String(JSON.parse(body.toString('utf8') || '{}').url || '').trim();
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
    if (!kind) return json(res, 400, { error: `that link is not a ${ACCEPTED} image`, kind: KIND.INVALID });

    const saved = storeWallpaper(data, kind.ext);
    log.audit('wallpaper fetched', { url: parsed.origin + parsed.pathname, type: kind.type, bytes: data.length });
    json(res, 200, { ok: true, url: saved });
  } catch (e) {
    if (e.oversize) return json(res, 400, { error: 'request too large', kind: KIND.INVALID });
    if (e instanceof SsrfBlockedError) return json(res, 403, { error: e.message, kind: KIND.BLOCKED });
    fail(res, e, { status: 502 });
  }
});

module.exports = { storeWallpaper, pruneWallpapers, wallpapersToDrop, WALLPAPER_URL_BASE };
