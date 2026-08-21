const fs = require('fs');
const path = require('path');
const { on, json, checkOrigin, getIp } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { ICONS_PATH } = require('../config');
const { fetchUnchecked } = require('../proxy');
const log = require('../log');
const { fail, KIND } = require('../api-error');

/* A safe, unused filename for an upload. Never reuse the submitted name: it
   overwrites an icon other apps still reference. Strip backslashes as well as
   slashes, because path.basename does not treat one as a separator on Linux.

   @param {string} dir @param {string} raw @returns {string} */
function safeIconName(dir, raw) {
  const ext = path.extname(String(raw).split(/[\\/]/).pop() || '').toLowerCase();
  const lastPart = String(raw).split(/[\\/]/).pop() || '';
  const stem =
    lastPart
      .slice(0, lastPart.length - path.extname(lastPart).length)
      /* Drop control characters and the characters that are awkward in a URL or
       on a filesystem. */
      .split('')
      .filter(ch => {
        const code = ch.charCodeAt(0);
        return code > 0x1f && code !== 0x7f && !'<>:"|?*'.includes(ch);
      })
      .join('')
      .replace(/^\.+/, '') /* no leading dots: not hidden, not '..' */
      .trim()
      .slice(0, 100) || 'icon';

  let candidate = `${stem}${ext}`;
  /* Bounded. An unbounded loop here is a way to spend the server's time. */
  for (let n = 2; n <= 999 && fs.existsSync(path.join(dir, candidate)); n++) {
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}

const ICON_MAX_BYTES = 2 * 1024 * 1024;
const ICON_STREAM_MAX_BYTES = Math.round(ICON_MAX_BYTES * 1.25);
const { rateLimit } = require('../auth');
const { sanitizeSvg } = require('../svg-sanitize');
const { sniffIconType } = require('../icon-sniff');
const { parseMultipartFile } = require('../parse-multipart');

let _iconCache = null,
  _iconCacheAt = 0;
const ICON_CACHE_TTL = 24 * 60 * 60 * 1000;

on('GET', '/api/icons/search', async (req, res) => {
  const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').toLowerCase().trim();
  if (!q) return json(res, 200, { results: [] });
  try {
    if (!_iconCache || Date.now() - _iconCacheAt > ICON_CACHE_TTL) {
      const r = await fetchUnchecked(
        'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/metadata/icons.json',
      );
      _iconCache = Array.isArray(r.data) ? r.data : [];
      _iconCacheAt = Date.now();
    }
    json(res, 200, {
      results: _iconCache
        .filter(ic => (ic.name || ic.slug || '').toLowerCase().includes(q))
        .slice(0, 20)
        .map(ic => ({
          name: ic.name || ic.slug,
          slug: ic.slug || ic.name,
          svgUrl: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${ic.slug || ic.name}.svg`,
          pngUrl: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${ic.slug || ic.name}.png`,
        })),
    });
  } catch (e) {
    fail(res, e, { status: 502 });
  }
});

const CDN_ICON_BASE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons';
/* The catalogue's slug form. Anything else is refused rather than passed into a
   CDN path. */
const CDN_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CDN_ICON_MAX_BYTES = 512 * 1024;
const CDN_CACHE_MAX = 300;

/** @typedef {{at:number, status:number, body?:Buffer, type?:string}} CdnIconEntry */

/** @type {Map<string, CdnIconEntry>} */
const _cdnIcons = new Map();

/** @param {string} key @param {CdnIconEntry} entry */
function cdnCachePut(key, entry) {
  _cdnIcons.delete(key);
  _cdnIcons.set(key, entry);
  /* Bounded. Icon names come from config an admin writes, but the map would
     otherwise grow for the life of the process. */
  while (_cdnIcons.size > CDN_CACHE_MAX) _cdnIcons.delete(_cdnIcons.keys().next().value);
}

/* Held in memory only. A restart refetches, so a changed upstream icon is never
   served from a file nobody knows is there. */
on('GET', '/api/icons/cdn', async (req, res) => {
  const p = new URL(req.url, 'http://x').searchParams;
  const name = p.get('name') || '';
  const ext = (p.get('ext') || 'svg').toLowerCase();
  if (!CDN_NAME_RE.test(name) || (ext !== 'svg' && ext !== 'png'))
    return json(res, 400, { error: 'Unknown icon', kind: KIND.INVALID });

  const key = `${ext}:${name}`;
  const hit = _cdnIcons.get(key);
  const fresh = hit && Date.now() - hit.at < ICON_CACHE_TTL;
  if (fresh) return sendIcon(res, hit);

  /** @type {CdnIconEntry} */
  let entry;
  try {
    const r = await fetchUnchecked(`${CDN_ICON_BASE}/${ext}/${name}.${ext}`, { binary: true });
    const body = Buffer.isBuffer(r.data) ? r.data : Buffer.alloc(0);
    /* Anything other than a hit or a miss is the CDN being unwell, and caching
       it would keep every icon missing for a day. */
    if (r.status !== 200 && r.status !== 404)
      return json(res, 502, { error: 'Icon could not be fetched', kind: KIND.UPSTREAM });
    if (r.status === 404 || !body.length || body.length > CDN_ICON_MAX_BYTES) {
      entry = { at: Date.now(), status: 404 };
    } else if (ext === 'svg') {
      /* Served from this origin, where opening the URL directly runs whatever
         the file contains. */
      entry = {
        at: Date.now(),
        status: 200,
        body: Buffer.from(sanitizeSvg(body.toString('utf8'))),
        type: 'image/svg+xml',
      };
    } else if (sniffIconType(body) === 'png') {
      entry = { at: Date.now(), status: 200, body, type: 'image/png' };
    } else {
      entry = { at: Date.now(), status: 404 };
    }
  } catch {
    /* Not cached. The browser falls back to the CDN for this load and the next
       one can still succeed. */
    return json(res, 502, { error: 'Icon could not be fetched', kind: KIND.UPSTREAM });
  }
  cdnCachePut(key, entry);
  sendIcon(res, entry);
});

/** @param {import('http').ServerResponse} res @param {CdnIconEntry} entry */
function sendIcon(res, entry) {
  if (entry.status !== 200 || !entry.body) return json(res, 404, { error: 'Icon not found', kind: KIND.INVALID });
  res.writeHead(200, {
    'Content-Type': entry.type,
    'Content-Length': entry.body.length,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(entry.body);
}

on('GET', '/api/icons/local', (_, res) => {
  try {
    fs.mkdirSync(ICONS_PATH, { recursive: true });
    json(res, 200, { files: fs.readdirSync(ICONS_PATH).filter(f => /\.(svg|png|ico)$/i.test(f)) });
  } catch (e) {
    fail(res, e, { status: 500 });
  }
});

on('POST', '/api/icons/upload', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'upload', 20, 3_600_000);
    if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED });
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data'))
      return json(res, 400, { error: 'multipart/form-data required', kind: KIND.INVALID });
    const bMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
    if (!bMatch) return json(res, 400, { error: 'missing boundary', kind: KIND.INVALID });
    const boundary = bMatch[1] || bMatch[2];
    const buf = await new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      req.on('data', c => {
        total += c.length;
        if (total > ICON_STREAM_MAX_BYTES) {
          req.destroy();
          return reject(new Error('file too large (max 2 MB)'));
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    const { filename, data, fileParts } = parseMultipartFile(buf, boundary);
    let fileData = data;
    if (!filename || !fileData?.length) return json(res, 400, { error: 'no file found in upload', kind: KIND.INVALID });
    if (fileParts > 1) return json(res, 400, { error: 'only one file per upload', kind: KIND.INVALID });
    if (!/\.(svg|png|ico)$/i.test(filename))
      return json(res, 400, { error: 'only .svg, .png, .ico files allowed', kind: KIND.INVALID });
    if (fileData.length > ICON_MAX_BYTES)
      return json(res, 400, { error: 'file too large (max 2 MB)', kind: KIND.INVALID });
    if (/\.svg$/i.test(filename)) {
      fileData = Buffer.from(sanitizeSvg(fileData.toString('utf8')), 'utf8');
    } else if (!sniffIconType(fileData)) {
      return json(res, 400, { error: 'file is not a valid PNG or ICO image', kind: KIND.INVALID });
    }
    fs.mkdirSync(ICONS_PATH, { recursive: true });
    /* Never the submitted name directly. See safeIconName. */
    const saved = safeIconName(ICONS_PATH, filename);
    fs.writeFileSync(path.join(ICONS_PATH, saved), fileData);
    log.audit('icon uploaded', { filename: saved });
    json(res, 200, { ok: true, filename: saved });
  } catch (e) {
    fail(res, e, { status: 500 });
  }
});

module.exports = { safeIconName };
