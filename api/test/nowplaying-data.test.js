const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'nowplaying', 'data.js'));

/* Minimal stand-in for the ctx widget-data.js builds. */
function ctxFor(config, payload) {
  return {
    config,
    normalizeBase,
    fetchJSON: async () => ({ status: 200, data: payload }),
  };
}

test('plex names the player from the device title', async () => {
  const r = await dataFn(ctxFor(
    { provider: 'plex', plexUrl: 'https://plex.example.com', plexToken: 't' },
    { MediaContainer: { Metadata: [{
      type: 'movie', title: 'Arrival', duration: 6000, viewOffset: 3000,
      Player: { state: 'playing', title: 'Living Room TV', product: 'Plex for Apple TV' },
    }] } },
  ));
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].player, 'Living Room TV');
  assert.equal(r.sessions[0].progress, 0.5);
});

test('plex falls back to the product when the device is unnamed', async () => {
  const r = await dataFn(ctxFor(
    { provider: 'plex', plexUrl: 'https://plex.example.com', plexToken: 't' },
    { MediaContainer: { Metadata: [{ type: 'movie', title: 'Arrival', Player: { product: 'Plex Web' } }] } },
  ));
  assert.equal(r.sessions[0].player, 'Plex Web');
});

test('plex tolerates a session with no Player at all', async () => {
  const r = await dataFn(ctxFor(
    { provider: 'plex', plexUrl: 'https://plex.example.com', plexToken: 't' },
    { MediaContainer: { Metadata: [{ type: 'movie', title: 'Arrival' }] } },
  ));
  assert.equal(r.sessions[0].player, '');
});

test('jellyfin prefers DeviceName over Client', async () => {
  const r = await dataFn(ctxFor(
    { provider: 'jellyfin', jellyfinUrl: 'https://jf.example.com', jellyfinKey: 'k' },
    [{
      DeviceName: 'Bedroom iPad', Client: 'Jellyfin Web',
      NowPlayingItem: { Type: 'Movie', Name: 'Dune', RunTimeTicks: 100 },
      PlayState: { PositionTicks: 25, IsPaused: true },
    }],
  ));
  assert.equal(r.sessions[0].player, 'Bedroom iPad');
  assert.equal(r.sessions[0].state, 'paused');
  assert.equal(r.sessions[0].progress, 0.25);
});

test('jellyfin falls back to Client when DeviceName is missing', async () => {
  const r = await dataFn(ctxFor(
    { provider: 'jellyfin', jellyfinUrl: 'https://jf.example.com', jellyfinKey: 'k' },
    [{ Client: 'Jellyfin Web', NowPlayingItem: { Type: 'Movie', Name: 'Dune' }, PlayState: {} }],
  ));
  assert.equal(r.sessions[0].player, 'Jellyfin Web');
});

test('navidrome names the player from playerName', async () => {
  const r = await dataFn(ctxFor(
    { provider: 'navidrome', navidromeUrl: 'https://nd.example.com', navidromeUser: 'u', navidromePassword: 'p' },
    { 'subsonic-response': { status: 'ok', nowPlaying: { entry: [
      { title: 'Time', artist: 'Hans Zimmer', playerName: 'Kitchen Speaker', duration: 100, positionMs: 50000, state: 'playing' },
    ] } } },
  ));
  assert.equal(r.sessions[0].player, 'Kitchen Speaker');
  assert.equal(r.sessions[0].progress, 0.5);
});

test('navidrome leaves player empty when the entry omits it', async () => {
  const r = await dataFn(ctxFor(
    { provider: 'navidrome', navidromeUrl: 'https://nd.example.com', navidromeUser: 'u', navidromePassword: 'p' },
    { 'subsonic-response': { status: 'ok', nowPlaying: { entry: [{ title: 'Time', artist: 'Hans Zimmer' }] } } },
  ));
  assert.equal(r.sessions[0].player, '');
  assert.equal(r.sessions[0].progress, null);
});

test('progress never leaves 0..1 even when the source overruns', async () => {
  const r = await dataFn(ctxFor(
    { provider: 'plex', plexUrl: 'https://plex.example.com', plexToken: 't' },
    { MediaContainer: { Metadata: [{ type: 'movie', title: 'Arrival', duration: 100, viewOffset: 400 }] } },
  ));
  assert.equal(r.sessions[0].progress, 1);
});
