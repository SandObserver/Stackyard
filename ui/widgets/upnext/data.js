/* Keep every request a GET. The key has full control of each app. */

const items = require('./upnext-items');

const FETCH_MS = 8000;
const SHORT_DAYS = 14;
const LONG_DAYS = 90;
const ENOUGH = 8;
const MAX_SOURCES = 6;
const DEFAULT_RELEASES = Object.freeze(['cinema', 'digital']);
const SERIES_TTL_MS = 6 * 3600 * 1000;
/* Keep the bound. A preview can name any address. */
const SERIES_KEPT = 500;

const NAMES = Object.freeze({ sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr' });

const HEADER_SAFE = /^[\x21-\x7e]+$/;
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT']);

function kindOf(e, ctx) {
  if (e && typeof e.kind === 'string') return e.kind;
  if (e && e.name === 'SsrfBlockedError') return ctx.KIND.BLOCKED;
  const code = e && e.code;
  if (TIMEOUT_CODES.has(code)) return ctx.KIND.TIMEOUT;
  if (typeof code === 'string' && code) return ctx.KIND.NETWORK;
  return ctx.KIND.UPSTREAM;
}

function sourcesOf(ctx) {
  const rows = Array.isArray(ctx.config.sources) ? ctx.config.sources.slice(0, MAX_SOURCES) : [];
  const out = rows
    .filter(r => r && typeof r === 'object' && Object.hasOwn(NAMES, r.app))
    .map(r => ({
      app: r.app,
      url: typeof r.url === 'string' ? r.url.trim() : '',
      apiKey: typeof r.apiKey === 'string' ? r.apiKey.trim() : '',
      skipTls: r.skipTls === true,
      href: typeof r.href === 'string' ? r.href : '',
      releases: Array.isArray(r.releases) ? r.releases.filter(x => typeof x === 'string') : DEFAULT_RELEASES,
    }));
  if (!out.length) ctx.fail('No app configured', { kind: ctx.KIND.INVALID });
  return out;
}

async function get(ctx, row, path) {
  const name = NAMES[row.app];
  const r = await ctx.fetchJSON(ctx.normalizeBase(row.url) + path, {
    headers: { 'X-Api-Key': row.apiKey, Accept: 'application/json' },
    skipTls: row.skipTls,
    timeout: FETCH_MS,
  });
  if (r.status === 401 || r.status === 403) ctx.fail(`${name} auth failed (check API key)`, { kind: ctx.KIND.AUTH });
  return r;
}

async function calendar(ctx, row, path, from, to, extra = '') {
  const unmonitored = ctx.config.unmonitored === true ? '&unmonitored=true' : '';
  const range = `start=${encodeURIComponent(new Date(from).toISOString())}&end=${encodeURIComponent(new Date(to).toISOString())}`;
  const r = await get(ctx, row, `${path}?${range}${unmonitored}${extra}`);
  if (r.status >= 400) ctx.fail(`${NAMES[row.app]} HTTP ${r.status}`);
  if (!Array.isArray(r.data)) ctx.fail(`${NAMES[row.app]} reply is not a calendar`);
  return r.data;
}

const seriesCache = new Map();
function remember(key, value) {
  seriesCache.delete(key);
  seriesCache.set(key, { value, at: Date.now() });
  if (seriesCache.size > SERIES_KEPT) seriesCache.delete(seriesCache.keys().next().value);
}

/* Do not add includeSeries. Each episode then carries its whole series record,
   and a large library passes the reply size cap. */
async function sonarr(ctx, row, from, to, now) {
  const episodes = await calendar(ctx, row, '/api/v3/calendar', from, to);
  const base = ctx.normalizeBase(row.url);
  const series = new Map();
  await Promise.all(
    items.sonarrSeriesIds(episodes, now, items.MAX_ITEMS).map(async id => {
      const key = `${base}|${id}`;
      const hit = seriesCache.get(key);
      if (hit && Date.now() - hit.at < SERIES_TTL_MS) return series.set(id, hit.value);
      const r = await get(ctx, row, `/api/v3/series/${id}`);
      if (r.status === 404) return;
      if (r.status >= 400) ctx.fail(`Sonarr HTTP ${r.status}`);
      const s = r.data && typeof r.data === 'object' ? r.data : null;
      if (!s) return;
      const kept = { title: s.title, titleSlug: s.titleSlug, runtime: s.runtime, seriesType: s.seriesType };
      remember(key, kept);
      series.set(id, kept);
    }),
  );
  return items.sonarrItems(episodes, e => series.get(e.seriesId));
}

const READERS = {
  sonarr,
  radarr: async (ctx, row, from, to) =>
    items.radarrItems(await calendar(ctx, row, '/api/v3/calendar', from, to), from, to, row.releases),
  lidarr: async (ctx, row, from, to) =>
    items.lidarrItems(await calendar(ctx, row, '/api/v1/calendar', from, to, '&includeArtist=true')),
};

async function readSource(ctx, row, from, to, now) {
  const name = NAMES[row.app];
  if (!row.url) ctx.fail(`${name} URL not configured`, { kind: ctx.KIND.INVALID });
  if (!row.apiKey) ctx.fail(`${name} API key not configured`, { kind: ctx.KIND.INVALID });
  if (!HEADER_SAFE.test(row.apiKey))
    ctx.fail('The API key has characters a key cannot hold', { kind: ctx.KIND.INVALID });
  const found = await READERS[row.app](ctx, row, from, to, now);
  return found.map(({ path, ...i }) => ({ ...i, link: path ? ctx.serviceLink(row.href, row.url, path) : '' }));
}

async function readAll(ctx, rows, now, days) {
  const from = now - items.DAY_MS;
  const to = now + days * items.DAY_MS;
  return Promise.all(
    rows.map(async row => {
      try {
        return { row, found: await readSource(ctx, row, from, to, now) };
      } catch (e) {
        return { row, error: e };
      }
    }),
  );
}

module.exports = async function (ctx) {
  const rows = sourcesOf(ctx);
  const now = Date.now();
  let days = SHORT_DAYS;
  let results = await readAll(ctx, rows, now, days);
  const ok = results.filter(r => !r.error);
  if (!ok.length) throw results[0].error;
  if (
    items.mergeItems(
      ok.map(r => r.found),
      now,
    ).length < ENOUGH
  ) {
    days = LONG_DAYS;
    const longer = await readAll(
      ctx,
      ok.map(r => r.row),
      now,
      days,
    );
    results = longer.map((r, i) => (r.error ? ok[i] : r)).concat(results.filter(r => r.error));
  }
  const first = rows.find(r => ctx.serviceLink(r.href, r.url, '/calendar'));
  return {
    items: items.mergeItems(
      results.filter(r => !r.error).map(r => r.found),
      now,
    ),
    missing: results.filter(r => r.error).map(r => ({ app: r.row.app, kind: kindOf(r.error, ctx) })),
    days,
    calendar: first ? ctx.serviceLink(first.href, first.url, '/calendar') : '',
  };
};
