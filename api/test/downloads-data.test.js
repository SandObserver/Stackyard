const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const widget = path.join(__dirname, '..', '..', 'ui', 'widgets', 'downloads');
const items = require(path.join(widget, 'download-items.js'));
const { errorParts } = require('../test-support/widget-ctx');
const { dispatchProvider } = require('../src/provider-dispatch');
const { normalizeBase } = require('../src/widget-data');
const { serviceLink } = require('../../ui/js/service-link.js');

/* A fresh data.js per test: Transmission and Deluge keep a session per server. */
function freshData() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(widget)) delete require.cache[k];
  return require(path.join(widget, 'data.js'));
}

function ctxFor(config, route) {
  const calls = [];
  const ctx = {
    config,
    normalizeBase,
    serviceLink,
    fetchJSON: async (url, opts = {}) => {
      calls.push({ url, opts });
      return route(url, opts, calls.length);
    },
    ...errorParts(),
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return { ctx, calls };
}

const GB = 1e9;
const NOW = Date.now();

test('qBittorrent: downloading, stalled and failed torrents become items; stopped and queued do not', () => {
  const t = (name, state, extra = {}) => ({ name, state, size: 100, amount_left: 40, dlspeed: 5, eta: 12, ...extra });
  const out = items.qbitItems([
    t('a', 'downloading'),
    t('b', 'stalledDL'),
    t('c', 'missingFiles'),
    t('d', 'error'),
    t('e', 'stoppedDL'),
    t('f', 'queuedDL'),
    t('g', 'metaDL', { eta: 8640000 }),
  ]);
  assert.deepEqual(
    out.map(i => [i.name, i.state, i.reason || '']),
    [
      ['a', 'run', ''],
      ['b', 'stall', 'noPeers'],
      ['c', 'error', 'missingFiles'],
      ['d', 'error', 'error'],
      ['g', 'run', ''],
    ],
  );
  assert.equal(out[0].progress, 0.6);
  assert.equal(out[4].eta, null, 'qBittorrent sends 8640000 for "no estimate"');
});

test('Transmission: reads JSON-RPC 2.0 names and the older camelCase names alike', () => {
  const snake = {
    name: 'a',
    status: 4,
    error: 0,
    eta: 30,
    size_when_done: 200,
    left_until_done: 50,
    rate_download: 9,
    is_stalled: false,
  };
  const camel = {
    name: 'b',
    status: 4,
    error: 0,
    eta: 30,
    sizeWhenDone: 200,
    leftUntilDone: 50,
    rateDownload: 9,
    isStalled: true,
  };
  const [a, b] = items.transmissionItems([snake, camel]);
  assert.deepEqual([a.progress, a.state, a.speed], [0.75, 'run', 9]);
  assert.deepEqual([b.progress, b.state, b.reason], [0.75, 'stall', 'noPeers']);
});

test('Transmission: a local error fails the item; a tracker warning does not', () => {
  const base = { status: 4, size_when_done: 10, left_until_done: 5, eta: 3 };
  const out = items.transmissionItems([
    { ...base, name: 'local', error: 3 },
    { ...base, name: 'tracker', error: 2 },
    { ...base, name: 'paused', status: 0, error: 0 },
  ]);
  assert.deepEqual(
    out.map(i => [i.name, i.state]),
    [
      ['local', 'error'],
      ['tracker', 'run'],
    ],
  );
});

test('Deluge: a downloading torrent with no seeds and no rate is stalled', () => {
  const t = (state, extra) => ({
    name: state,
    state,
    total_wanted: 100,
    total_done: 25,
    download_payload_rate: 0,
    num_seeds: 0,
    eta: 0,
    ...extra,
  });
  const out = items.delugeItems({
    h1: t('Downloading', { download_payload_rate: 50, num_seeds: 3, eta: 9 }),
    h2: t('Downloading'),
    h3: t('Error'),
    h4: t('Paused'),
  });
  assert.deepEqual(
    out.map(i => [i.state, i.eta]),
    [
      ['run', 9],
      ['stall', null],
      ['error', null],
    ],
  );
});

test('SABnzbd: sizes and speed arrive as text; the queue speed goes to the first job', () => {
  const queue = {
    paused: false,
    kbpersec: '2048.00',
    slots: [
      { filename: 'waiting', mb: '9', mbleft: '9', status: 'Propagating', timeleft: '0:00:00' },
      { filename: 'one', mb: '100.00', mbleft: '25.00', status: 'Downloading', timeleft: '0:01:30' },
      { filename: 'two', mb: '50.00', mbleft: '50.00', status: 'Downloading', timeleft: '1:00:00:00' },
      { filename: 'three', mb: '5', mbleft: '5', status: 'Queued', timeleft: '0:00:00' },
    ],
  };
  const out = items.sabItems(queue);
  assert.deepEqual(
    out.map(i => i.name),
    ['one', 'two'],
  );
  assert.deepEqual([out[0].progress, out[0].speed, out[0].eta], [0.75, 2048 * 1024, 90]);
  assert.deepEqual([out[1].speed, out[1].eta], [0, 86400], 'a later job keeps the time SABnzbd gives it');
  assert.equal(items.arrange(out).summary.seconds, 86400);
  assert.deepEqual(
    items.sabItems({ ...queue, kbpersec: '0' }).map(i => i.eta),
    [null, null],
  );
  assert.deepEqual(items.sabItems({ ...queue, paused: true }), []);
});

test('SABnzbd: time left reads h:mm:ss and d:hh:mm:ss', () => {
  assert.equal(items.clockSeconds('0:16:44'), 1004);
  assert.equal(items.clockSeconds('2:01:02:03'), 2 * 86400 + 3600 + 123);
  assert.equal(items.clockSeconds('soon'), null);
});

test('NZBGet: joins 64-bit halves and gives the rate to the downloading job', () => {
  const g = (name, Status, remaining) => ({
    NZBName: name,
    Status,
    FileSizeHi: 1,
    FileSizeLo: 0,
    RemainingSizeHi: 0,
    RemainingSizeLo: remaining,
  });
  const out = items.nzbgetItems([g('big', 'DOWNLOADING', 2 ** 31), g('next', 'QUEUED', 10)], {
    DownloadRate: 1000,
    DownloadRateHi: 0,
    DownloadRateLo: 1000,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].size, 2 ** 32);
  assert.equal(out[0].progress, 0.5);
  assert.equal(out[0].eta, Math.round(2 ** 31 / 1000));
  assert.deepEqual(items.nzbgetItems([g('big', 'DOWNLOADING', 5)], { DownloadPaused: true }), []);
});

test('NZBGet: paused repair files do not count, and a later job finishes after the ones ahead', () => {
  const g = (name, size, remaining, held) => ({
    NZBName: name,
    Status: 'DOWNLOADING',
    FileSizeLo: size,
    RemainingSizeLo: remaining,
    PausedSizeLo: held,
  });
  const out = items.nzbgetItems([g('a', 1100, 100, 100), g('b', 3000, 2000, 0)], { DownloadRate: 100 });
  assert.deepEqual(
    out.map(i => [i.size, i.progress, i.eta]),
    [
      [1000, 1, 0],
      [3000, 0.333, 20],
    ],
  );
  assert.equal(items.arrange(out).summary.seconds, 20);
});

test('items: closest to done first, then stalled, then failed, capped', () => {
  const mk = (name, state, eta, progress = 0.5) => ({ name, state, eta, progress, size: 1, speed: 0 });
  const many = Array.from({ length: 15 }, (_, i) => mk(`run${i}`, 'run', 100 - i));
  const { items: list } = items.arrange([mk('broken', 'error', null), mk('stuck', 'stall', null), ...many]);
  assert.equal(list.length, items.MAX_ITEMS);
  assert.equal(list[0].name, 'run14');
  const small = items.arrange([mk('broken', 'error', null), mk('stuck', 'stall', null), mk('a', 'run', 5)]).items;
  assert.deepEqual(
    small.map(i => i.name),
    ['a', 'stuck', 'broken'],
  );
});

test('the heading summary counts every download, not only the ones shown', () => {
  const mk = (name, state, eta) => ({ name, state, eta, progress: 0.5, size: 1, speed: 1000 });
  const many = Array.from({ length: 15 }, (_, i) => mk(`run${i}`, 'run', 100 + i));
  const { summary } = items.arrange([
    { ...mk('broken', 'error', null), reason: 'missingFiles' },
    mk('stuck', 'stall', null),
    ...many,
  ]);
  assert.deepEqual(summary, { kind: 'time', seconds: 114, moving: 15, speed: 15000, stalled: 1, failed: 1 });
});

test('with no estimate from one moving download, the summary has no time', () => {
  assert.equal(
    items.arrange([{ name: 'a', state: 'run', eta: null, progress: 0, size: 1, speed: 0 }]).summary.seconds,
    null,
  );
});

test('with nothing moving, the summary names the problem; an error wins over a stall', () => {
  const stall = { name: 's', state: 'stall', eta: null, progress: 0, size: 1, speed: 0, reason: 'noPeers' };
  const err = { name: 'e', state: 'error', eta: null, progress: 0, size: 1, speed: 0, reason: 'missingFiles' };
  assert.deepEqual(items.arrange([stall]).summary, { kind: 'stall', reason: 'noPeers' });
  assert.deepEqual(items.arrange([stall, err]).summary, { kind: 'error', reason: 'missingFiles' });
  assert.deepEqual(items.arrange([]).summary, { kind: 'done' });
});

test('SABnzbd: completed history counts as finished', async () => {
  const now = Math.floor(NOW / 1000);
  const { ctx, calls } = ctxFor({ service: 'sabnzbd', url: 'http://s:8080', apiKey: 'k' }, url =>
    url.includes('mode=history')
      ? {
          status: 200,
          data: {
            history: {
              slots: [
                { status: 'Completed', completed: now - 60 },
                { status: 'Failed', completed: now },
              ],
            },
          },
        }
      : { status: 200, data: { queue: { paused: false, kbpersec: '0', slots: [] } } },
  );
  const out = await freshData()(ctx);
  assert.ok(calls.some(c => /mode=history&limit=100&output=json/.test(c.url)));
  assert.equal(out.finished.length, 1);
});

test('a key with a line break or space is refused before it reaches a header', async () => {
  for (const apiKey of ['a\r\nX-Evil: 1', 'two words']) {
    const { ctx } = ctxFor({ service: 'qbittorrent', url: 'http://q', apiKey }, () => assert.fail('no request'));
    await assert.rejects(freshData()(ctx), e => e.kind === 'invalid');
  }
});

test('a username with a colon is refused: it would split the sign-in', async () => {
  const { ctx } = ctxFor({ service: 'nzbget', url: 'http://n', username: 'a:b', password: 'p' }, () =>
    assert.fail('no request'),
  );
  await assert.rejects(freshData()(ctx), e => e.kind === 'invalid');
});

test('names lose direction and control characters that could disguise them', () => {
  const [item] = items.qbitItems([
    {
      name: 'Movie \u202Eevil.exe\u202C\n.mkv\u061C 2023\u0085',
      state: 'downloading',
      size: 1,
      amount_left: 1,
      eta: 1,
    },
  ]);
  assert.equal(item.name, 'Movie evil.exe.mkv 2023');
});

test('finished times keep the last 48 hours, newest first, in milliseconds', () => {
  const s = Math.floor(NOW / 1000);
  assert.deepEqual(items.finishedTimes([s - 60, -1, 0, s - 3 * 86400, s - 7200], NOW), [
    (s - 60) * 1000,
    (s - 7200) * 1000,
  ]);
});

test('qBittorrent: sends the key as a Bearer token and returns items and a link', async () => {
  const { ctx, calls } = ctxFor({ service: 'qbittorrent', url: 'qbit.lan:8080', apiKey: 'qbt_x' }, url => {
    if (url.includes('filter=downloading'))
      return {
        status: 200,
        data: [{ name: 'deb.iso', state: 'downloading', size: 2 * GB, amount_left: GB, dlspeed: 1e6, eta: 1000 }],
      };
    if (url.includes('filter=completed'))
      return { status: 200, data: [{ completion_on: Math.floor(NOW / 1000) - 60 }] };
    return { status: 200, data: [] };
  });
  const out = await freshData()(ctx);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer qbt_x');
  assert.equal(out.items[0].progress, 0.5);
  assert.equal(out.finished.length, 1);
  assert.equal(out.link, 'http://qbit.lan:8080');
});

test('qBittorrent: a refused key is an auth failure that names the version it needs', async () => {
  const { ctx } = ctxFor({ service: 'qbittorrent', url: 'http://q:8080', apiKey: 'old' }, () => ({
    status: 403,
    data: 'Forbidden',
  }));
  await assert.rejects(freshData()(ctx), e => e.kind === 'auth' && /5\.2/.test(e.message));
});

test('SABnzbd: "API Key Incorrect" is an auth failure', async () => {
  const { ctx } = ctxFor({ service: 'sabnzbd', url: 'http://s:8080', apiKey: 'bad' }, () => ({
    status: 403,
    data: 'API Key Incorrect',
  }));
  await assert.rejects(freshData()(ctx), e => e.kind === 'auth');
});

test('NZBGet: reads status, groups and history over GET with Basic auth', async () => {
  const { ctx, calls } = ctxFor({ service: 'nzbget', url: 'http://n:6789', username: 'u', password: 'p' }, url => {
    if (url.endsWith('/status')) return { status: 200, data: { result: { DownloadRate: 0 } } };
    if (url.endsWith('/listgroups')) return { status: 200, data: { result: [] } };
    return { status: 200, data: { result: [] } };
  });
  const out = await freshData()(ctx);
  assert.equal(calls[0].opts.method, undefined);
  assert.equal(calls[0].opts.headers.Authorization, 'Basic ' + Buffer.from('u:p').toString('base64'));
  assert.deepEqual(out.items, []);
});

test('Transmission: answers the 409 with its session id and keeps it for the next poll', async () => {
  const reply = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      torrents: [{ name: 't', status: 4, error: 0, eta: 5, size_when_done: 10, left_until_done: 5, rate_download: 2 }],
    },
  };
  const route = (url, opts) =>
    opts.headers['X-Transmission-Session-Id'] === 'sid1'
      ? { status: 200, data: JSON.stringify(reply), headers: {} }
      : { status: 409, data: '', headers: { 'x-transmission-session-id': 'sid1' } };
  const data = freshData();
  const first = ctxFor({ service: 'transmission', url: 'http://t:9091' }, route);
  const out = await data(first.ctx);
  assert.equal(first.calls.length, 2);
  assert.equal(first.calls[0].url, 'http://t:9091/transmission/rpc');
  assert.equal(out.items[0].progress, 0.5);
  const second = ctxFor({ service: 'transmission', url: 'http://t:9091' }, route);
  await data(second.ctx);
  assert.equal(second.calls.length, 1, 'the second poll reuses the session id');
});

test('Transmission: falls back to the original protocol when the server does not speak JSON-RPC 2.0', async () => {
  const { ctx, calls } = ctxFor({ service: 'transmission', url: 'http://t:9091/transmission/rpc' }, (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.jsonrpc)
      return {
        status: 200,
        data: JSON.stringify({ result: 'method name not recognized', arguments: {} }),
        headers: {},
      };
    assert.ok(body.arguments.fields.includes('sizeWhenDone'));
    return {
      status: 200,
      data: JSON.stringify({
        result: 'success',
        arguments: { torrents: [{ name: 'old', status: 4, eta: 9, sizeWhenDone: 4, leftUntilDone: 1 }] },
      }),
      headers: {},
    };
  });
  const out = await freshData()(ctx);
  assert.equal(calls[0].url, 'http://t:9091/transmission/rpc');
  assert.equal(out.items[0].name, 'old');
});

test('Transmission: a refused password is an auth failure', async () => {
  const { ctx } = ctxFor({ service: 'transmission', url: 'http://t:9091', username: 'u', password: 'x' }, () => ({
    status: 401,
    data: '',
    headers: {},
  }));
  await assert.rejects(freshData()(ctx), e => e.kind === 'auth');
});

function delugeRoute({
  connected = true,
  expireAfterLogin = false,
  hosts = [['hostid', '127.0.0.1', 58846, 'localclient']],
  sessionPaused = false,
} = {}) {
  let logins = 0;
  let served = 0;
  const route = (url, opts) => {
    const { method, params } = JSON.parse(opts.body);
    if (method === 'auth.login') {
      logins++;
      return params[0] === 'deluge'
        ? {
            status: 200,
            data: { result: true, error: null },
            headers: { 'set-cookie': [`_session_id=s${logins}; Expires=x; Path=/json`] },
          }
        : { status: 200, data: { result: false, error: null }, headers: {} };
    }
    if (expireAfterLogin && opts.headers.Cookie === '_session_id=s1' && served++ === 0)
      return { status: 200, data: { result: null, error: { message: 'Not authenticated', code: 1 } }, headers: {} };
    if (method === 'web.connected') return { status: 200, data: { result: connected, error: null }, headers: {} };
    if (method === 'web.get_hosts')
      return {
        status: 200,
        data: { result: hosts, error: null },
        headers: {},
      };
    if (method === 'web.connect') return { status: 200, data: { result: [], error: null }, headers: {} };
    if (method === 'core.is_session_paused')
      return { status: 200, data: { result: sessionPaused, error: null }, headers: {} };
    if (method === 'web.update_ui')
      return {
        status: 200,
        data: {
          result: {
            torrents: {
              h: {
                name: 'deb.iso',
                state: 'Downloading',
                total_wanted: 10,
                total_done: 5,
                download_payload_rate: 3,
                num_seeds: 2,
                eta: 2,
              },
            },
          },
          error: null,
        },
        headers: {},
      };
    return { status: 500, data: {}, headers: {} };
  };
  return { route, logins: () => logins };
}

test('Deluge: logs in, connects the web UI to its daemon when needed, and reads the torrents', async () => {
  const d = delugeRoute({ connected: false });
  const { ctx, calls } = ctxFor({ service: 'deluge', url: 'http://d:8112', password: 'deluge' }, d.route);
  const out = await freshData()(ctx);
  const methods = calls.map(c => JSON.parse(c.opts.body).method);
  assert.deepEqual(methods, [
    'auth.login',
    'web.connected',
    'web.get_hosts',
    'web.connect',
    'web.update_ui',
    'core.is_session_paused',
  ]);
  assert.equal(calls[1].opts.headers.Cookie, '_session_id=s1');
  assert.equal(out.items[0].progress, 0.5);
});

test('Deluge: with several daemons listed, the widget connects to none of them', async () => {
  const d = delugeRoute({
    connected: false,
    hosts: [
      ['a', '10.0.0.1', 58846, 'x'],
      ['b', '10.0.0.2', 58846, 'x'],
    ],
  });
  const { ctx, calls } = ctxFor({ service: 'deluge', url: 'http://d:8112', password: 'deluge' }, d.route);
  await assert.rejects(freshData()(ctx), e => e.kind === 'upstream' && /not connected/.test(e.message));
  assert.ok(!calls.some(c => JSON.parse(c.opts.body).method === 'web.connect'));
});

test('Deluge: an expired session logs in again once', async () => {
  const d = delugeRoute({ expireAfterLogin: true });
  const { ctx } = ctxFor({ service: 'deluge', url: 'http://d:8112', password: 'deluge' }, d.route);
  const out = await freshData()(ctx);
  assert.equal(d.logins(), 2);
  assert.equal(out.items.length, 1);
});

test('Deluge: a wrong password is an auth failure', async () => {
  const d = delugeRoute();
  const { ctx } = ctxFor({ service: 'deluge', url: 'http://d:8112', password: 'nope' }, d.route);
  await assert.rejects(freshData()(ctx), e => e.kind === 'auth');
});

test('every client needs an address', async () => {
  for (const service of ['qbittorrent', 'sabnzbd', 'nzbget', 'transmission', 'deluge']) {
    const { ctx } = ctxFor({ service, apiKey: 'k', password: 'p' }, () => assert.fail('no request without an address'));
    await assert.rejects(freshData()(ctx), e => e.kind === 'invalid', service);
  }
});

/* ── A client paused as a whole ───────────────────────────────────────────── */

test('a paused client shows its downloads as paused, not stalled; failures stay failed', () => {
  const out = items.arrange(
    [
      { name: 'a', size: 10, progress: 0.5, speed: 0, eta: null, state: 'stall', reason: 'noPeers' },
      { name: 'b', size: 10, progress: 0.2, speed: 4, eta: 9, state: 'run' },
      { name: 'c', size: 10, progress: 0.1, speed: 0, eta: null, state: 'error', reason: 'error' },
    ],
    true,
  );
  assert.deepEqual(out.summary, { kind: 'paused' });
  assert.deepEqual(
    out.items.map(i => [i.name, i.state, i.reason, i.eta, i.speed]),
    [
      ['a', 'pause', 'paused', null, 0],
      ['b', 'pause', 'paused', null, 0],
      ['c', 'error', 'error', null, 0],
    ],
  );
});

function qbitRoute(maindata) {
  const asked = [];
  const route = url => {
    if (url.includes('/sync/maindata')) {
      const rid = Number(new URL(url).searchParams.get('rid'));
      asked.push(rid);
      return maindata(rid);
    }
    if (url.includes('filter=downloading'))
      return { status: 200, data: [{ name: 'deb.iso', state: 'stalledDL', size: 10, amount_left: 5, eta: 8640000 }] };
    return { status: 200, data: [] };
  };
  return { route, asked };
}

test('qBittorrent: a paused session reads as paused, and later polls ask for changes only', async () => {
  const q = qbitRoute(rid =>
    rid === 0
      ? { status: 200, data: { rid: 7, full_update: true, server_state: { session_state: true } } }
      : { status: 200, data: { rid: rid + 1, server_state: { dl_info_speed: 0 } } },
  );
  const data = freshData();
  const { ctx } = ctxFor({ service: 'qbittorrent', url: 'http://q:8080', apiKey: 'k' }, q.route);
  const first = await data(ctx);
  assert.equal(first.summary.kind, 'paused');
  assert.equal(first.items[0].state, 'pause');
  const second = await data(ctx);
  assert.equal(second.summary.kind, 'paused', 'a change list without the field keeps the last state');
  assert.deepEqual(q.asked, [0, 7]);
});

test('qBittorrent: resuming the session clears the pause', async () => {
  const q = qbitRoute(rid =>
    rid === 0
      ? { status: 200, data: { rid: 1, full_update: true, server_state: { session_state: true } } }
      : { status: 200, data: { rid: 2, server_state: { session_state: false } } },
  );
  const data = freshData();
  const { ctx } = ctxFor({ service: 'qbittorrent', url: 'http://q:8080', apiKey: 'k' }, q.route);
  await data(ctx);
  assert.equal((await data(ctx)).summary.kind, 'stall');
});

test('qBittorrent: a version without the session state is never paused', async () => {
  const q = qbitRoute(() => ({ status: 200, data: { rid: 1, full_update: true, server_state: {} } }));
  const { ctx } = ctxFor({ service: 'qbittorrent', url: 'http://q:8080', apiKey: 'k' }, q.route);
  assert.equal((await freshData()(ctx)).summary.kind, 'stall');
});

/* Every poll would download the whole list again and fail again. */
test('qBittorrent: a torrent list too large to read is not asked for again on the next poll', async () => {
  const q = qbitRoute(() => {
    throw Object.assign(new Error('Response too large'), { responseTooLarge: true });
  });
  const data = freshData();
  const { ctx } = ctxFor({ service: 'qbittorrent', url: 'http://q:8080', apiKey: 'k' }, q.route);
  assert.equal((await data(ctx)).summary.kind, 'stall');
  await data(ctx);
  assert.deepEqual(q.asked, [0]);
});

test('SABnzbd and NZBGet: a paused queue reads as paused', async () => {
  const sab = ctxFor({ service: 'sabnzbd', url: 'http://s:8080', apiKey: 'k' }, url =>
    url.includes('mode=history')
      ? { status: 200, data: { history: { slots: [] } } }
      : { status: 200, data: { queue: { paused: true, kbpersec: '0', slots: [] } } },
  );
  assert.equal((await freshData()(sab.ctx)).summary.kind, 'paused');
  const nzb = ctxFor({ service: 'nzbget', url: 'http://n:6789', username: 'u', password: 'p' }, url =>
    url.endsWith('/status')
      ? { status: 200, data: { result: { DownloadRate: 0, DownloadPaused: true } } }
      : { status: 200, data: { result: [] } },
  );
  assert.equal((await freshData()(nzb.ctx)).summary.kind, 'paused');
});

test('Deluge: a paused session reads as paused; a daemon without the call does not', async () => {
  const paused = delugeRoute({ sessionPaused: true });
  const a = ctxFor({ service: 'deluge', url: 'http://d:8112', password: 'deluge' }, paused.route);
  assert.equal((await freshData()(a.ctx)).summary.kind, 'paused');
  const old = delugeRoute();
  const route = (url, opts) =>
    JSON.parse(opts.body).method === 'core.is_session_paused'
      ? { status: 200, data: { result: null, error: { message: 'Unknown method', code: 2 } }, headers: {} }
      : old.route(url, opts);
  const b = ctxFor({ service: 'deluge', url: 'http://d:8112', password: 'deluge' }, route);
  assert.equal((await freshData()(b.ctx)).summary.kind, 'time');
});
