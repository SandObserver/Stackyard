const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('bounded-cache'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { remember, SERVERS_KEPT } = require('../src/bounded-cache');
const { dataFnContext } = require('../src/widget-data');
const { fetchUnchecked } = require('../src/proxy');

test('remember drops the least recently stored entry past the cap', () => {
  const m = new Map();
  remember(m, 'a', 1, 2);
  remember(m, 'b', 2, 2);
  remember(m, 'a', 3, 2);
  remember(m, 'c', 4, 2);
  assert.deepEqual(
    [...m],
    [
      ['a', 3],
      ['c', 4],
    ],
  );
});

test('remember returns the stored value and defaults to the per-server cap', () => {
  const m = new Map();
  for (let i = 0; i <= SERVERS_KEPT; i++) assert.equal(remember(m, i, `v${i}`), `v${i}`);
  assert.equal(m.size, SERVERS_KEPT);
  assert.equal(m.has(0), false);
});

/* Plex /identity and /status/sessions shapes from the Plex Media Server API. */
test('Now Playing forgets the oldest Plex server once more than the cap are polled', async t => {
  let identity = 0;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url.endsWith('/identity')) {
      identity++;
      return res.end(JSON.stringify({ MediaContainer: { size: 0, claimed: true, machineIdentifier: 'm1' } }));
    }
    const movie = {
      key: '/library/metadata/1',
      type: 'movie',
      title: 'Arrival',
      duration: 6000,
      viewOffset: 3000,
      Player: { state: 'playing', title: 'TV' },
    };
    res.end(JSON.stringify({ MediaContainer: { size: 1, Metadata: [movie] } }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'nowplaying', 'data.js'));
  const poll = i =>
    dataFn(
      dataFnContext(
        {
          provider: 'plex',
          plexUrl: `http://127.0.0.1:${server.address().port}/srv${i}`,
          plexToken: 't',
          href: `http://plex${i}.lan/`,
        },
        '',
        new URLSearchParams(),
        fetchUnchecked,
      ),
    );
  for (let i = 0; i <= SERVERS_KEPT; i++) await poll(i);
  const first = identity;
  await poll(SERVERS_KEPT);
  assert.equal(identity, first, 'a recent server is still cached');
  await poll(0);
  assert.equal(identity, first + 1, 'the oldest server was dropped');
});
