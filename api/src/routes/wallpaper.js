const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { on, json, checkOrigin, getIp, readBodyCapped } = require('../router');
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
/* An upload is stored before the config names it. A save inside this window
   must not delete it, or the later wallpaper save points at a missing file. */
const PENDING_MS = 3_600_000;

/* Keep proxy_read_timeout on /api/wallpaper/fetch above this. */
const FETCH_TIMEOUT_MS = 30_000;

const ACCEPTED = 'JPEG, PNG, WebP, AVIF or GIF';
const TOO_LARGE = 'image too large (max 16 MB)';

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
  const newest = files.at(-1);
  return files.filter(f => f !== newest);
}

/** @param {string} dir @returns {{ name: string, at: number }[]} oldest first */
function storedByAge(dir) {
  return fs
    .readdirSync(dir)
    .map(name => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
}

/** Removes every stored wallpaper the saved config no longer points at, except
    uploads younger than PENDING_MS.

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
  const pending = new Set(files.filter(f => Date.now() - f.at < PENDING_MS).map(f => f.name));
  const names = files.map(f => f.name);
  for (const name of wallpapersToDrop(names, referenced).filter(n => !pending.has(n))) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch (e) {
      log.warn('wallpaper could not be removed', { name, error: e.message });
    }
  }
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res
    @returns {boolean} whether the request may write a wallpaper */
function mayWrite(req, res) {
  if (IS_DEMO) {
    json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED, code: 'blocked.read-only' });
    return false;
  }
  if (!checkOrigin(req, res)) return false;
  const limited = rateLimit(getIp(req), 'upload', UPLOADS_PER_HOUR, 3_600_000);
  if (limited) {
    json(res, 429, { error: limited, kind: KIND.BLOCKED, code: 'blocked.rate-limit' });
    return false;
  }
  return true;
}

/* Keep the cache. Without it every request, including one sent by a page on
   another site, spends a call of the key's hourly quota. */
const PHOTO_TTL_MS = 24 * 60 * 60 * 1000;
/** @typedef {{ name: string, profile: string, site: string }} PhotoCredit */
/** @type {{ key: string, at: number, url: string, credit: PhotoCredit|null } | null} */
let _photo = null;
/** @type {{ key: string, promise: Promise<{ url: string|null, credit?: PhotoCredit|null, error?: string }> } | null} */
let _pending = null;

const UTM = 'utm_source=stackyard&utm_medium=referral';
const USERNAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The photographer and Unsplash links the API terms require beside the photo.

    @param {any} photo a `/photos/random` reply @returns {PhotoCredit|null} */
function photoCredit(photo) {
  const username = photo?.user?.username;
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return null;
  const name = typeof photo.user.name === 'string' && photo.user.name.trim() ? photo.user.name.trim() : username;
  return {
    name: name.slice(0, 100),
    profile: `https://unsplash.com/@${username}?${UTM}`,
    site: `https://unsplash.com/?${UTM}`,
  };
}

/** Unsplash counts a photo as used only through this request.

    @param {any} photo @param {string} apiKey */
function reportDownload(photo, apiKey) {
  const loc = photo?.links?.download_location;
  if (typeof loc !== 'string' || !loc.startsWith('https://api.unsplash.com/')) return;
  const u = new URL(loc);
  u.searchParams.set('client_id', apiKey);
  fetchUnchecked(u.href)
    .then(r => {
      if (r.status < 200 || r.status >= 300) log.warn('Unsplash download report failed', { status: r.status });
    })
    .catch(e => log.warn('Unsplash download report failed', { error: e instanceof Error ? e.message : String(e) }));
}

/** @param {{ apiKey?: string, collection?: string }} bg */
function randomPhoto(bg) {
  const key = `${bg.apiKey || ''}\n${bg.collection || ''}`;
  if (_photo && _photo.key === key && Date.now() - _photo.at < PHOTO_TTL_MS)
    return Promise.resolve({ url: _photo.url, credit: _photo.credit });
  if (_pending?.key === key) return _pending.promise;
  const promise = (async () => {
    const p = new URLSearchParams({ orientation: 'landscape', content_filter: 'high', client_id: bg.apiKey || '' });
    if (bg.collection) p.set('collections', bg.collection);
    const r = await fetchUnchecked(`https://api.unsplash.com/photos/random?${p}`);
    const raw = r.data?.urls?.raw;
    if (!raw) {
      log.warn('Unsplash returned no image', { status: r.status });
      return { url: null, error: 'No image returned' };
    }
    const url = `${raw}&w=2800&h=1800&q=85&fm=jpg&fit=crop&crop=entropy`;
    const credit = photoCredit(r.data);
    _photo = { key, at: Date.now(), url, credit };
    reportDownload(r.data, bg.apiKey || '');
    return { url, credit };
  })().finally(() => {
    if (_pending?.promise === promise) _pending = null;
  });
  _pending = { key, promise };
  return promise;
}

on('GET', '/api/wallpaper', async (_, res) => {
  const cfg = loadConfig(),
    bg = cfg.settings?.background || {};
  if (bg.type !== 'unsplash') return json(res, 200, { url: null });
  try {
    json(res, 200, await randomPhoto(bg));
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
    if (data.length > UPLOAD_MAX_BYTES)
      return json(res, 400, { error: TOO_LARGE, kind: KIND.INVALID, code: 'invalid.too-large' });
    const kind = sniffImageType(data);
    if (!kind)
      return json(res, 400, {
        error: `file is not a ${ACCEPTED} image`,
        kind: KIND.INVALID,
        code: 'invalid.file-type',
      });

    const url = storeWallpaper(data, kind.ext);
    log.audit('wallpaper uploaded', { url, type: kind.type, bytes: data.length });
    json(res, 200, { ok: true, url });
  } catch (e) {
    if (e.oversize) return json(res, 400, { error: TOO_LARGE, kind: KIND.INVALID, code: 'invalid.too-large' });
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
      return json(res, 400, { error: 'that is not a valid URL', kind: KIND.INVALID, code: 'invalid.url' });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return json(res, 400, {
        error: 'only http and https links can be fetched',
        kind: KIND.INVALID,
        code: 'invalid.url',
      });

    const r = await fetchChecked(url, { binary: true, maxBytes: UPLOAD_MAX_BYTES, timeout: FETCH_TIMEOUT_MS });
    if (r.status !== 200)
      return json(res, 502, { error: `the image could not be fetched (HTTP ${r.status})`, kind: KIND.UPSTREAM });
    const data = Buffer.isBuffer(r.data) ? r.data : Buffer.alloc(0);
    const kind = sniffImageType(data);
    if (!kind)
      return json(res, 400, {
        error: `that link is not a ${ACCEPTED} image`,
        kind: KIND.INVALID,
        code: 'invalid.file-type',
      });

    const saved = storeWallpaper(data, kind.ext);
    log.audit('wallpaper fetched', { url: parsed.origin + parsed.pathname, type: kind.type, bytes: data.length });
    json(res, 200, { ok: true, url: saved });
  } catch (e) {
    if (e.oversize) return json(res, 400, { error: 'request too large', kind: KIND.INVALID, code: 'invalid.url' });
    if (e.responseTooLarge) return json(res, 502, { error: TOO_LARGE, kind: KIND.INVALID, code: 'invalid.too-large' });
    if (e instanceof SsrfBlockedError) return json(res, 403, errorBody(e));
    fail(res, e, { status: 502 });
  }
});

module.exports = {
  storeWallpaper,
  pruneWallpapers,
  wallpapersToDrop,
  WALLPAPER_URL_BASE,
  PENDING_MS,
  _resetPhoto: () => {
    _photo = null;
    _pending = null;
  },
};
