const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const widget = path.join(__dirname, '..', '..', 'ui', 'widgets', 'upnext');
const items = require(path.join(widget, 'upnext-items.js'));
const data = require(path.join(widget, 'data.js'));
const { errorParts } = require('../test-support/widget-ctx');
const { normalizeBase } = require('../src/widget-data');
const { serviceLink } = require('../../ui/js/service-link.js');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-25T18:00:00Z');

function ctxFor(config, route) {
  const calls = [];
  const ctx = {
    config,
    normalizeBase,
    serviceLink,
    fetchJSON: async (url, opts = {}) => {
      calls.push({ url, opts });
      return route(url, opts);
    },
    ...errorParts(),
  };
  return { ctx, calls };
}

const idOf = title => [...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100000, 7) + 1;
const ep = (title, at, season, episode, extra = {}) => ({
  seriesId: idOf(title),
  series: { title, titleSlug: title.toLowerCase().replace(/ /g, '-'), runtime: 50 },
  airDateUtc: at,
  seasonNumber: season,
  episodeNumber: episode,
  title: 'Name ' + episode,
  ...extra,
});

const sonarrServe = episodes => url => {
  const one = /\/api\/v3\/series\/(\d+)$/.exec(url);
  if (one) {
    const e = episodes.find(x => x.seriesId === Number(one[1]));
    return e ? { status: 200, data: e.series } : { status: 404, data: {} };
  }
  if (url.includes('/api/v3/calendar')) return { status: 200, data: episodes.map(({ series, ...e }) => e) };
  throw new Error('unexpected ' + url);
};

test('Sonarr: an episode keeps its time, code and name; TBA names are dropped', () => {
  const [a, b] = items.sonarrItems([
    ep('Northbound', '2026-10-25T21:00:00Z', 2, 4),
    ep('Fieldwork', '2026-10-26T20:00:00Z', 1, 8, { title: 'TBA' }),
  ]);
  assert.equal(a.at, '2026-10-25T21:00:00.000Z');
  assert.deepEqual([a.season, a.episode, a.name, a.path], [2, 4, 'Name 4', '/series/northbound']);
  assert.equal(a.until, Date.parse('2026-10-25T21:50:00Z'), 'ends after the series runtime');
  assert.equal(b.name, '');
});

test('Sonarr: a season dropped at once is one row with an episode range', () => {
  const t = '2026-10-30T07:00:00Z';
  const out = items.sonarrItems(
    [1, 2, 3, 4].map(n => ep('Small Hours', t, 3, n, n === 4 ? { finaleType: 'season' } : {})),
  );
  assert.equal(out.length, 1);
  assert.deepEqual(
    [out[0].episode, out[0].lastEpisode, out[0].name, out[0].finale, out[0].premiere],
    [1, 4, '', 'season', true],
  );
});

test('Sonarr: a daily show drops its date-based code and name', () => {
  const [a, b] = items.sonarrItems([
    ep('Quiz Hour', '2026-10-26T23:00:00Z', 2026, 178, {
      series: { title: 'Quiz Hour', seriesType: 'daily' },
      title: 'Mon, Oct 26, 2026',
    }),
    ep('Quiz Hour', '2026-10-27T23:00:00Z', 2026, 179, { series: { title: 'Quiz Hour' } }),
  ]);
  assert.deepEqual([a.season, a.episode, a.name, a.premiere], [null, null, '', false]);
  assert.notEqual(a.at, b.at, 'two daily episodes stay two rows');
  assert.deepEqual([b.season, b.name], [null, ''], 'a season numbered by year is date-based too');
  assert.equal(
    items.sonarrItems([ep('Talk', '2026-10-27T23:00:00Z', 3, 9, { title: 'October 27, 2026' })])[0].name,
    '',
  );
});

test('Sonarr: specials are not premieres, and rows with no series or time are skipped', () => {
  const out = items.sonarrItems([
    ep('Northbound', '2026-10-25T21:00:00Z', 0, 1),
    { airDateUtc: '2026-10-25T21:00:00Z', seasonNumber: 1, episodeNumber: 1 },
    ep('Fieldwork', 'not a date', 1, 1),
    null,
    'x',
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].premiere, false);
});

test('Radarr: each selected release date in the window is a day row, read as a calendar day', () => {
  const m = {
    title: 'Glass Harbor',
    titleSlug: 'glass-harbor-2026',
    year: 2026,
    inCinemas: '2026-09-01T00:00:00Z',
    digitalRelease: '2026-10-27T00:00:00Z',
    physicalRelease: '2026-11-20T00:00:00Z',
  };
  const from = NOW - DAY;
  const to = NOW + 14 * DAY;
  const all = items.radarrItems([m], from, to);
  assert.deepEqual(
    all.map(i => [i.release, i.day, i.at]),
    [['digital', '2026-10-27', null]],
  );
  assert.equal(all[0].path, '/movie/glass-harbor-2026');
  assert.deepEqual(
    items.radarrItems([m], from, NOW + 60 * DAY, ['physical']).map(i => i.release),
    ['physical'],
  );
  assert.deepEqual(items.radarrItems([m], from, to, []), [], 'no release types selected shows no films');
});

test('Lidarr: albums carry artist and type, and link by album id', () => {
  const [a] = items.lidarrItems([
    {
      title: 'Low Tide',
      releaseDate: '2026-10-30T00:00:00Z',
      albumType: 'Album',
      foreignAlbumId: 'abc',
      artist: { artistName: 'Marrow Lane' },
    },
  ]);
  assert.deepEqual(
    [a.kind, a.day, a.artist, a.albumType, a.path],
    ['album', '2026-10-30', 'Marrow Lane', 'album', '/album/abc'],
  );
  assert.equal(items.lidarrItems([{ title: 'x', releaseDate: '', albumType: 'Broadcast' }]).length, 0);
});

test('merge: drops what has ended, removes a second instance’s copy, sorts and caps', () => {
  const s1 = items.sonarrItems([
    ep('Northbound', '2026-10-25T21:00:00Z', 2, 4),
    ep('Old', '2026-10-25T10:00:00Z', 1, 1),
  ]);
  const s2 = items.sonarrItems([ep('Northbound', '2026-10-25T21:00:00Z', 2, 4)]);
  const films = items.lidarrItems([
    { title: 'Low Tide', releaseDate: '2026-10-25T00:00:00Z', artist: { artistName: 'A' } },
  ]);
  const out = items.mergeItems([s1, s2, films], NOW);
  assert.deepEqual(
    out.map(i => i.title),
    ['Low Tide', 'Northbound'],
  );
  assert.ok(!('key' in out[0]) && !('until' in out[0]));
  assert.equal(out[1].ends, '2026-10-25T21:50:00.000Z');
  const many = items.sonarrItems(
    Array.from({ length: 30 }, (_, n) => ep('S' + n, new Date(NOW + (n + 1) * HOUR).toISOString(), 1, 2)),
  );
  assert.equal(items.mergeItems([many], NOW).length, items.MAX_ITEMS);
});

test('data: reads every app with its key, merges, and links each row to its page', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const many = Array.from({ length: 9 }, (_, n) => ep('Show ' + n, new Date(NOW + (n + 1) * DAY).toISOString(), 1, 2));
  const { ctx, calls } = ctxFor(
    {
      sources: [
        { app: 'sonarr', url: 'sonarr.lan:8989', apiKey: 'k1' },
        { app: 'radarr', url: 'http://radarr.lan:7878/', apiKey: 'k2', href: 'https://films.example' },
      ],
    },
    url => {
      if (url.includes(':8989/')) return sonarrServe(many)(url);
      if (url.includes(':7878/api/v3/calendar'))
        return {
          status: 200,
          data: [{ title: 'Glass Harbor', titleSlug: 'glass-harbor', digitalRelease: '2026-10-27T00:00:00Z' }],
        };
      throw new Error('unexpected ' + url);
    },
  );
  const out = await data(ctx);
  const calendars = calls.filter(c => c.url.includes('/calendar'));
  assert.equal(calendars.length, 2, 'enough rows in 14 days: no second, longer read');
  assert.equal(calendars[0].opts.headers['X-Api-Key'], 'k1');
  assert.doesNotMatch(calendars[0].url, /includeSeries|unmonitored/);
  assert.equal(
    calls.filter(c => c.url.includes('/api/v3/series/')).length,
    9,
    'one lookup per series that can reach the list',
  );
  assert.equal(out.days, 14);
  assert.deepEqual(out.missing, []);
  const film = out.items.find(i => i.kind === 'film');
  assert.equal(film.link, 'https://films.example/movie/glass-harbor');
  assert.ok(!('path' in film));
  assert.equal(out.items[0].link, 'http://sonarr.lan:8989/series/show-0');
});

test('data: a quiet fortnight reads 90 days ahead', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { ctx, calls } = ctxFor(
    { sources: [{ app: 'lidarr', url: 'lidarr.lan', apiKey: 'k' }], unmonitored: true },
    () => ({ status: 200, data: [] }),
  );
  const out = await data(ctx);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/v1\/calendar\?.*unmonitored=true.*includeArtist=true/);
  const end = new URL(calls[1].url).searchParams.get('end');
  assert.equal(Date.parse(end), NOW + 90 * DAY);
  assert.equal(out.days, 90);
  assert.deepEqual(out.items, []);
});

test('data: one app failing leaves the rest and names it; all failing reports the first', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const sources = [
    { app: 'sonarr', url: 'sonarr.lan', apiKey: 'k' },
    { app: 'lidarr', url: 'lidarr.lan', apiKey: 'bad' },
  ];
  const { ctx } = ctxFor({ sources }, url => {
    if (url.includes('lidarr')) return { status: 401, data: {} };
    return sonarrServe([ep('Northbound', '2026-10-25T21:00:00Z', 2, 4)])(url);
  });
  const out = await data(ctx);
  assert.deepEqual(out.missing, [{ app: 'lidarr', kind: 'auth' }]);
  assert.equal(out.items.length, 1);

  const down = ctxFor({ sources }, () => {
    throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
  });
  await assert.rejects(data(down.ctx), /refused/);
});

test('data: a missing app, URL or key, or a key that cannot be a header, is not set up', async () => {
  for (const config of [
    {},
    { sources: [{ app: 'plex', url: 'x', apiKey: 'k' }] },
    { sources: [{ app: 'sonarr', url: '', apiKey: 'k' }] },
    { sources: [{ app: 'sonarr', url: 'x', apiKey: '' }] },
    { sources: [{ app: 'sonarr', url: 'x', apiKey: 'a\r\nb' }] },
  ]) {
    const { ctx, calls } = ctxFor(config, () => ({ status: 200, data: [] }));
    await assert.rejects(data(ctx), e => e.kind === 'invalid', JSON.stringify(config));
    assert.equal(calls.length, 0);
  }
});

test('data: an HTML or object reply is not a calendar', async () => {
  const { ctx } = ctxFor({ sources: [{ app: 'radarr', url: 'r', apiKey: 'k' }] }, () => ({
    status: 200,
    data: '<html>',
  }));
  await assert.rejects(data(ctx), /not a calendar/);
});

test('Sonarr: only the series that can reach the list are looked up, soonest first', () => {
  const eps = [
    ep('Ended', '2026-10-25T10:00:00Z', 1, 1),
    ...Array.from({ length: 20 }, (_, n) => ep('S' + n, new Date(NOW + (n + 1) * HOUR).toISOString(), 1, 1)),
    { ...ep('S0', new Date(NOW + 30 * HOUR).toISOString(), 1, 2) },
    { seriesId: 'x', airDateUtc: new Date(NOW + HOUR).toISOString() },
  ];
  const ids = items.sonarrSeriesIds(eps, NOW, 12);
  assert.equal(ids.length, 12);
  assert.equal(ids[0], idOf('S0'));
  assert.ok(!ids.includes(idOf('Ended')), 'an episode that has ended needs no series');
});

test('data: series lookups are cached per server, and a series that is gone is skipped', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const eps = [ep('Kept', '2026-10-25T21:00:00Z', 1, 2), ep('Gone', '2026-10-25T22:00:00Z', 1, 3)];
  const serve = sonarrServe(eps);
  const route = url => (url.endsWith('/series/' + idOf('Gone')) ? { status: 404, data: {} } : serve(url));
  const first = ctxFor({ sources: [{ app: 'sonarr', url: 'cache.lan', apiKey: 'k' }] }, route);
  const out = await data(first.ctx);
  assert.deepEqual(
    out.items.map(i => i.title),
    ['Kept'],
  );
  const again = ctxFor({ sources: [{ app: 'sonarr', url: 'cache.lan', apiKey: 'k' }] }, route);
  await data(again.ctx);
  assert.equal(again.calls.filter(c => c.url.endsWith('/series/' + idOf('Kept'))).length, 0, 'served from the cache');
});

test('data: the card links to the first app calendar a browser can open', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { ctx } = ctxFor(
    {
      sources: [
        { app: 'sonarr', url: 'http://sonarr:8989', apiKey: 'k' },
        { app: 'radarr', url: 'http://radarr.lan:7878', apiKey: 'k' },
      ],
    },
    url => (url.includes('8989') ? sonarrServe([])(url) : { status: 200, data: [] }),
  );
  const out = await data(ctx);
  assert.equal(out.calendar, 'http://radarr.lan:7878/calendar', 'a bare container name is not a browser address');
});

test('worst case: a large calendar is cut to the list without a series lookup per episode', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const eps = Array.from({ length: 20000 }, (_, n) =>
    ep('Show ' + (n % 400), new Date(NOW + (n + 1) * 60000).toISOString(), 1 + (n % 9), 1 + (n % 30)),
  );
  const { ctx, calls } = ctxFor({ sources: [{ app: 'sonarr', url: 'big.lan', apiKey: 'k' }] }, sonarrServe(eps));
  const out = await data(ctx);
  assert.equal(out.items.length, items.MAX_ITEMS);
  assert.ok(calls.filter(c => c.url.includes('/series/')).length <= items.MAX_ITEMS);
});

test('worst case: a timeout or refusal names that app, and a failed longer read keeps the shorter one', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  let radarrReads = 0;
  const { ctx } = ctxFor(
    {
      sources: [
        { app: 'radarr', url: 'slow.lan', apiKey: 'k' },
        { app: 'lidarr', url: 'down.lan', apiKey: 'k' },
      ],
    },
    url => {
      if (url.includes('down.lan')) throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      radarrReads++;
      if (radarrReads > 1) throw Object.assign(new Error('slow'), { code: 'ETIMEDOUT' });
      return { status: 200, data: [{ title: 'Glass Harbor', digitalRelease: '2026-10-27T00:00:00Z' }] };
    },
  );
  const out = await data(ctx);
  assert.deepEqual(out.missing, [{ app: 'lidarr', kind: 'network' }]);
  assert.equal(out.days, 90);
  assert.deepEqual(
    out.items.map(i => i.title),
    ['Glass Harbor'],
    'the 14-day read stands in for the failed 90-day one',
  );
});

test('bad config: more than six apps are cut to six, and unknown apps are ignored', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const sources = [
    { app: 'plex', url: 'x', apiKey: 'k' },
    ...Array.from({ length: 9 }, (_, n) => ({ app: 'radarr', url: `r${n}.lan`, apiKey: 'k' })),
  ];
  const { ctx, calls } = ctxFor({ sources }, () => ({ status: 200, data: [] }));
  await data(ctx);
  const hosts = new Set(calls.map(c => new URL(c.url).hostname));
  assert.equal(hosts.size, 5, 'six rows read, one of them unknown');
});

test('bad data: wrong types in a reply never throw', () => {
  const junk = [
    null,
    1,
    'x',
    [],
    {},
    { airDateUtc: 5 },
    { series: 'x', airDateUtc: '2026-10-25T21:00:00Z' },
    { title: {}, digitalRelease: 7 },
  ];
  assert.deepEqual(items.sonarrItems(junk), []);
  assert.deepEqual(items.radarrItems(junk, 0, Infinity), []);
  assert.deepEqual(items.lidarrItems(junk), []);
  assert.deepEqual(items.sonarrSeriesIds(junk, NOW, 12), []);
  assert.deepEqual(items.sonarrItems('nope'), []);
});
