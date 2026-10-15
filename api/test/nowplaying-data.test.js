const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'nowplaying', 'data.js'));
const { browserLink } = require('../../ui/js/service-link.js');

/* Minimal stand-in for the ctx widget-data.js builds. */
function ctxFor(config, payload) {
  return {
    config,
    normalizeBase,
    browserLink,
    fetchJSON: async () => ({ status: 200, data: payload }),
  };
}

test('plex names the player from the device title', async () => {
  const r = await dataFn(
    ctxFor(
      { provider: 'plex', plexUrl: 'https://plex.example.com', plexToken: 't' },
      {
        MediaContainer: {
          Metadata: [
            {
              type: 'movie',
              title: 'Arrival',
              duration: 6000,
              viewOffset: 3000,
              Player: { state: 'playing', title: 'Living Room TV', product: 'Plex for TV' },
            },
          ],
        },
      },
    ),
  );
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].player, 'Living Room TV');
  assert.equal(r.sessions[0].progress, 0.5);
});

test('plex falls back to the product when the device is unnamed', async () => {
  const r = await dataFn(
    ctxFor(
      { provider: 'plex', plexUrl: 'https://plex.example.com', plexToken: 't' },
      { MediaContainer: { Metadata: [{ type: 'movie', title: 'Arrival', Player: { product: 'Plex Web' } }] } },
    ),
  );
  assert.equal(r.sessions[0].player, 'Plex Web');
});

test('plex tolerates a session with no Player at all', async () => {
  const r = await dataFn(
    ctxFor(
      { provider: 'plex', plexUrl: 'https://plex.example.com', plexToken: 't' },
      { MediaContainer: { Metadata: [{ type: 'movie', title: 'Arrival' }] } },
    ),
  );
  assert.equal(r.sessions[0].player, '');
});

test('jellyfin prefers DeviceName over Client', async () => {
  const r = await dataFn(
    ctxFor({ provider: 'jellyfin', jellyfinUrl: 'https://jf.example.com', jellyfinKey: 'k' }, [
      {
        DeviceName: 'Bedroom Tablet',
        Client: 'Jellyfin Web',
        NowPlayingItem: { Type: 'Movie', Name: 'Dune', RunTimeTicks: 100 },
        PlayState: { PositionTicks: 25, IsPaused: true },
      },
    ]),
  );
  assert.equal(r.sessions[0].player, 'Bedroom Tablet');
  assert.equal(r.sessions[0].state, 'paused');
  assert.equal(r.sessions[0].progress, 0.25);
});

test('jellyfin falls back to Client when DeviceName is missing', async () => {
  const r = await dataFn(
    ctxFor({ provider: 'jellyfin', jellyfinUrl: 'https://jf.example.com', jellyfinKey: 'k' }, [
      { Client: 'Jellyfin Web', NowPlayingItem: { Type: 'Movie', Name: 'Dune' }, PlayState: {} },
    ]),
  );
  assert.equal(r.sessions[0].player, 'Jellyfin Web');
});

test('navidrome names the player from playerName', async () => {
  const r = await dataFn(
    ctxFor(
      { provider: 'navidrome', navidromeUrl: 'https://nd.example.com', navidromeUser: 'u', navidromePassword: 'p' },
      {
        'subsonic-response': {
          status: 'ok',
          nowPlaying: {
            entry: [
              {
                title: 'Time',
                artist: 'Hans Zimmer',
                playerName: 'Kitchen Speaker',
                duration: 100,
                positionMs: 50000,
                state: 'playing',
              },
            ],
          },
        },
      },
    ),
  );
  assert.equal(r.sessions[0].player, 'Kitchen Speaker');
  assert.equal(r.sessions[0].progress, 0.5);
});

test('navidrome leaves player empty when the entry omits it', async () => {
  const r = await dataFn(
    ctxFor(
      { provider: 'navidrome', navidromeUrl: 'https://nd.example.com', navidromeUser: 'u', navidromePassword: 'p' },
      { 'subsonic-response': { status: 'ok', nowPlaying: { entry: [{ title: 'Time', artist: 'Hans Zimmer' }] } } },
    ),
  );
  assert.equal(r.sessions[0].player, '');
  assert.equal(r.sessions[0].progress, null);
});

test('progress never leaves 0..1 even when the source overruns', async () => {
  const r = await dataFn(
    ctxFor(
      { provider: 'plex', plexUrl: 'https://plex.example.com', plexToken: 't' },
      { MediaContainer: { Metadata: [{ type: 'movie', title: 'Arrival', duration: 100, viewOffset: 400 }] } },
    ),
  );
  assert.equal(r.sessions[0].progress, 1);
});

test('a plex session links to its item on the server that is playing it', async () => {
  const ctx = ctxFor({ provider: 'plex', plexUrl: 'http://10.0.0.5:32400', plexToken: 't' }, null);
  ctx.fetchJSON = async url =>
    url.endsWith('/identity')
      ? { status: 200, data: { MediaContainer: { machineIdentifier: 'abc123' } } }
      : { status: 200, data: { MediaContainer: { Metadata: [{ type: 'movie', title: 'Arrival', ratingKey: '42' }] } } };
  const r = await dataFn(ctx);
  assert.equal(
    r.sessions[0].link,
    'http://10.0.0.5:32400/web/index.html#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F42',
  );
  assert.equal(r.link, 'http://10.0.0.5:32400');
});

test('jellyfin, emby and navidrome sessions link to their item pages', async () => {
  const session = [{ ServerId: 's1', DeviceName: 'TV', NowPlayingItem: { Id: 'i9', Name: 'Arrival', Type: 'Movie' } }];
  const jf = await dataFn(
    ctxFor({ provider: 'jellyfin', jellyfinUrl: 'http://10.0.0.5:8096', jellyfinKey: 'k' }, session),
  );
  assert.equal(jf.sessions[0].link, 'http://10.0.0.5:8096/web/#/details?id=i9&serverId=s1');
  const em = await dataFn(ctxFor({ provider: 'emby', embyUrl: 'http://10.0.0.5:8920', embyKey: 'k' }, session));
  assert.equal(em.sessions[0].link, 'http://10.0.0.5:8920/web/index.html#!/item?id=i9&serverId=s1');
  const nd = await dataFn(
    ctxFor(
      { provider: 'navidrome', navidromeUrl: 'http://10.0.0.5:4533', navidromeUser: 'u', navidromePassword: 'p' },
      { 'subsonic-response': { status: 'ok', nowPlaying: { entry: [{ title: 'Song', albumId: 'al7' }] } } },
    ),
  );
  assert.equal(nd.sessions[0].link, 'http://10.0.0.5:4533/app/#/album/al7/show');
});

test('a media server only the server can reach gives no link', async () => {
  const r = await dataFn(
    ctxFor({ provider: 'jellyfin', jellyfinUrl: 'http://jellyfin:8096', jellyfinKey: 'k' }, [
      { NowPlayingItem: { Id: 'i9', Name: 'Arrival', Type: 'Movie' } },
    ]),
  );
  assert.equal(r.sessions[0].link, '');
  assert.equal(r.link, '');
});
