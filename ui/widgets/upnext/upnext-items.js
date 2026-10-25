const DAY_MS = 24 * 3600 * 1000;
const MAX_ITEMS = 12;
const DEFAULT_RUNTIME_MIN = 60;
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})/;
const RELEASES = Object.freeze([
  ['inCinemas', 'cinema'],
  ['digitalRelease', 'digital'],
  ['physicalRelease', 'physical'],
]);

const str = v => (typeof v === 'string' ? v.trim() : '');
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []);
const whole = v => (Number.isInteger(v) && v >= 0 ? v : null);
const ms = v => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
/* Radarr and Lidarr dates are calendar days sent as midnight UTC. Keep the day,
   not the instant, or a reader west of UTC sees the day before. */
const dayOf = v => {
  const m = DATE_ONLY.exec(str(v));
  return m ? m[1] : '';
};
const dayStartMs = day => Date.parse(day + 'T00:00:00Z');
const slugPath = (prefix, slug) => (slug ? `${prefix}/${encodeURIComponent(slug)}` : '');

/* "Mon, Oct 26, 2026" as an episode name. Engines parse loose text as dates too,
   so only a date near the air date counts. */
const namesItsDate = (name, at) => {
  const d = Date.parse(name);
  return Number.isFinite(d) && Math.abs(d - at) < 2 * DAY_MS;
};

/** One row. `at` is an ISO instant for a timed item, or null. `day` is the
    calendar day for an item with no time. `until` is when it stops being next. */
function makeItem({ kind, title, at = null, day = '', until, path = '', ...rest }) {
  return { kind, title, at, day, until, path, ...rest };
}

/** The series of the soonest episodes still to come, at most `limit`, soonest first.
    @param {unknown} episodes @param {number} now @param {number} limit @returns {number[]} */
function sonarrSeriesIds(episodes, now, limit) {
  const ids = [];
  const coming = list(episodes)
    .map(e => ({ id: e.seriesId, t: ms(e.airDateUtc), runtime: whole(e.runtime) || DEFAULT_RUNTIME_MIN }))
    .filter(e => Number.isSafeInteger(e.id) && e.id > 0 && e.t != null && e.t + e.runtime * 60000 > now)
    .sort((a, b) => a.t - b.t);
  for (const e of coming) {
    if (ids.length >= limit) break;
    if (!ids.includes(e.id)) ids.push(e.id);
  }
  return ids;
}

/** Episodes. Several episodes of one series at one time become one row. An
    episode whose series is unknown is left out.
    @param {unknown} episodes Sonarr /api/v3/calendar
    @param {(e: any) => any} [seriesOf] the series record for an episode */
function sonarrItems(episodes, seriesOf = e => e.series) {
  const rows = [];
  for (const e of list(episodes)) {
    const found = seriesOf(e);
    const s = found && typeof found === 'object' ? found : {};
    const title = str(s.title);
    const t = ms(e.airDateUtc);
    if (!title || t == null) continue;
    /* A daily show numbers by air date, often with the year as its season and the date as its
       name. Both repeat the date the row already shows. */
    const daily = str(s.seriesType) === 'daily' || whole(e.seasonNumber) >= 1900;
    const season = daily ? null : whole(e.seasonNumber);
    const episode = daily ? null : whole(e.episodeNumber);
    const runtime = whole(e.runtime) || whole(s.runtime) || DEFAULT_RUNTIME_MIN;
    const name = str(e.title);
    rows.push(
      makeItem({
        kind: 'episode',
        title,
        at: new Date(t).toISOString(),
        until: t + runtime * 60000,
        season,
        episode,
        lastEpisode: episode,
        name: name && name.toUpperCase() !== 'TBA' && !daily && !namesItsDate(name, t) ? name : '',
        premiere: episode === 1 && season !== 0,
        finale: ['season', 'series'].includes(str(e.finaleType)) ? str(e.finaleType) : '',
        path: slugPath('/series', str(s.titleSlug)),
        key: `episode|${title.toLowerCase()}|${daily ? t : `${season}|${episode}`}`,
      }),
    );
  }
  rows.sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) || a.title.localeCompare(b.title) || (a.episode ?? 0) - (b.episode ?? 0),
  );
  const merged = [];
  for (const r of rows) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.title === r.title &&
      prev.at === r.at &&
      prev.season === r.season &&
      prev.lastEpisode != null &&
      r.episode === prev.lastEpisode + 1
    ) {
      prev.lastEpisode = r.episode;
      prev.name = '';
      prev.finale = r.finale || prev.finale;
      prev.until = Math.max(prev.until, r.until);
      continue;
    }
    merged.push(r);
  }
  return merged;
}

/** Films. Each release date that falls in the window is its own row.
    @param {unknown} movies Radarr /api/v3/calendar @param {number} from @param {number} to
    @param {string[]} [types] release kinds to keep: cinema, digital, physical */
function radarrItems(movies, from, to, types) {
  const keep = new Set(Array.isArray(types) ? types : RELEASES.map(([, k]) => k));
  const out = [];
  for (const m of list(movies)) {
    const title = str(m.title);
    if (!title) continue;
    for (const [field, release] of RELEASES) {
      if (!keep.has(release)) continue;
      const day = dayOf(m[field]);
      if (!day) continue;
      const start = dayStartMs(day);
      if (start + DAY_MS <= from || start > to) continue;
      out.push(
        makeItem({
          kind: 'film',
          title,
          day,
          until: start + DAY_MS,
          release,
          year: whole(m.year),
          path: slugPath('/movie', str(m.titleSlug)),
          key: `film|${title.toLowerCase()}|${release}|${day}`,
        }),
      );
    }
  }
  return out;
}

const ALBUM_TYPES = new Set(['album', 'ep', 'single']);
/** Albums. @param {unknown} albums Lidarr /api/v1/calendar with includeArtist */
function lidarrItems(albums) {
  const out = [];
  for (const a of list(albums)) {
    const title = str(a.title);
    const day = dayOf(a.releaseDate);
    if (!title || !day) continue;
    const artist = a.artist && typeof a.artist === 'object' ? str(a.artist.artistName) : '';
    const type = str(a.albumType).toLowerCase();
    out.push(
      makeItem({
        kind: 'album',
        title,
        day,
        until: dayStartMs(day) + DAY_MS,
        artist,
        albumType: ALBUM_TYPES.has(type) ? type : '',
        path: slugPath('/album', str(a.foreignAlbumId)),
        key: `album|${title.toLowerCase()}|${artist.toLowerCase()}|${day}`,
      }),
    );
  }
  return out;
}

const sortKey = i => (i.at ? Date.parse(i.at) : dayStartMs(i.day));

/** Every source's rows, ended ones dropped, duplicates from a second instance
    removed, soonest first. @param {object[][]} groups @param {number} now */
function mergeItems(groups, now) {
  const seen = new Set();
  const out = [];
  for (const i of groups.flat()) {
    if (!(i.until > now) || seen.has(i.key)) continue;
    seen.add(i.key);
    out.push(i);
  }
  out.sort((a, b) => sortKey(a) - sortKey(b) || a.title.localeCompare(b.title));
  return out.slice(0, MAX_ITEMS).map(({ key, until, ...rest }) => ({ ...rest, ends: new Date(until).toISOString() }));
}

module.exports = { sonarrSeriesIds, sonarrItems, radarrItems, lidarrItems, mergeItems, MAX_ITEMS, DAY_MS };
