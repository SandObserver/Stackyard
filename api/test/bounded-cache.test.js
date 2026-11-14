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

const widgetData = name => require(path.join(__dirname, '..', '..', 'ui', 'widgets', name, 'data.js'));

function countingStub(route) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push(url);
    return route(url, opts);
  };
  const count = (host, part) => calls.filter(u => new URL(u).host === host && u.includes(part)).length;
  return { fetch, count };
}

const pollWith = (name, fetch, endpoint, config) =>
  widgetData(name)(dataFnContext(config, endpoint, new URLSearchParams(), fetch));

test('Backup forgets the oldest Duplicati token once more than the cap are polled', async () => {
  const stub = countingStub(url => {
    if (url.endsWith('/auth/login')) return { status: 200, data: { AccessToken: 'a', RefreshNonce: 'n' } };
    if (url.endsWith('/serverstate')) return { status: 200, data: {} };
    return { status: 200, data: [{ Backup: { ID: '1', Name: 'Daily' } }] };
  });
  const host = i => `dup${i}.lan:8200`;
  const poll = i =>
    pollWith('backup', stub.fetch, '', {
      slots: [{ provider: 'duplicati', jobId: '1', dupUrl: `http://${host(i)}`, dupPass: 'p' }],
    });
  for (let i = 0; i <= SERVERS_KEPT; i++) await poll(i);
  const recent = stub.count(host(SERVERS_KEPT), '/auth/login');
  await poll(SERVERS_KEPT);
  assert.equal(stub.count(host(SERVERS_KEPT), '/auth/login'), recent, 'a recent server is still signed in');
  const oldest = stub.count(host(0), '/auth/login');
  await poll(0);
  assert.ok(stub.count(host(0), '/auth/login') > oldest, 'the oldest server signs in again');
});

const PBS_TASKS_KEPT = 2000;
const PBS_MOVES_KEPT = 200;
const pbsSlot = (host, jobId) => ({
  provider: 'pbs',
  jobId,
  pbsUrl: `https://${host}`,
  pbsTokenId: 'root@pam!dash',
  pbsSecret: 'secret',
});
const PBS_GROUP = { 'backup-type': 'vm', 'backup-id': '100', 'last-backup': 1700000000 };

test('Backup forgets the oldest Proxmox Backup Server task namespace past the cap', async () => {
  const stub = countingStub(url => {
    if (url.includes('/groups')) return { status: 200, data: { data: [PBS_GROUP] } };
    if (url.includes('/log?')) {
      return { status: 200, data: { data: [{ t: `starting new backup on datastore 's' from ::1: "vm/100/x"` }] } };
    }
    if (url.includes('/nodes/localhost/tasks?')) {
      return {
        status: 200,
        data: { data: [{ upid: 'UPID:pbs:1', worker_id: 's:vm/100', worker_type: 'backup', status: 'OK' }] },
      };
    }
    return { status: 200, data: { data: [] } };
  });
  const host = i => `pbs-task${i}.lan:8007`;
  const poll = i => pollWith('backup', stub.fetch, '', { slots: [pbsSlot(host(i), 's::vm/100')] });
  for (let i = 0; i <= PBS_TASKS_KEPT; i++) await poll(i);
  const recent = stub.count(host(PBS_TASKS_KEPT), '/log?');
  await poll(PBS_TASKS_KEPT);
  assert.equal(stub.count(host(PBS_TASKS_KEPT), '/log?'), recent, 'a recent task is still cached');
  const oldest = stub.count(host(0), '/log?');
  await poll(0);
  assert.equal(stub.count(host(0), '/log?'), oldest + 1, 'the oldest task log is read again');
});

test('Backup forgets the oldest moved Proxmox Backup Server group past the cap', async () => {
  const stub = countingStub(url => {
    if (url.endsWith('/namespace')) return { status: 200, data: { data: [{ ns: '' }, { ns: 'moved' }] } };
    if (url.includes('/groups?ns=moved')) return { status: 200, data: { data: [PBS_GROUP] } };
    return { status: 200, data: { data: [] } };
  });
  const host = i => `pbs-move${i}.lan:8007`;
  const poll = i => pollWith('backup', stub.fetch, '', { slots: [pbsSlot(host(i), 's::vm/100')] });
  for (let i = 0; i <= PBS_MOVES_KEPT; i++) await poll(i);
  const recent = stub.count(host(PBS_MOVES_KEPT), '/namespace');
  await poll(PBS_MOVES_KEPT);
  assert.equal(stub.count(host(PBS_MOVES_KEPT), '/namespace'), recent, 'a recent move is still cached');
  const oldest = stub.count(host(0), '/namespace');
  await poll(0);
  assert.equal(stub.count(host(0), '/namespace'), oldest + 1, 'the oldest group is searched for again');
});

test('System Summary forgets the oldest Glances API version once more than the cap are polled', async () => {
  const stub = countingStub(url => {
    if (url.endsWith('/network'))
      return { status: 200, data: [{ interface_name: 'eth0', bytes_recv_rate_per_sec: 1 }] };
    return { status: 200, data: {} };
  });
  const host = i => `glances${i}.lan:61208`;
  const poll = i =>
    pollWith('system-summary', stub.fetch, 'throughput', {
      statProvider: 'glances',
      glancesUrl: `http://${host(i)}`,
      network: { interface: 'eth0' },
    });
  for (let i = 0; i <= SERVERS_KEPT; i++) await poll(i);
  await poll(SERVERS_KEPT);
  assert.equal(stub.count(host(SERVERS_KEPT), '/uptime'), 1, 'a recent server is not probed again');
  await poll(0);
  assert.equal(stub.count(host(0), '/uptime'), 2, 'the oldest server is probed again');
});

test('System Summary forgets the oldest Beszel session once more than the cap are polled', async () => {
  const created = new Date(Date.now() - 60 * 1000).toISOString();
  const stub = countingStub(url => {
    if (url.includes('auth-with-password')) return { status: 200, data: { token: 'tok' } };
    return { status: 200, data: { items: [{ stats: { b: [1, 2] }, created }] } };
  });
  const host = i => `beszel${i}.lan:8090`;
  const poll = i =>
    pollWith('system-summary', stub.fetch, 'throughput', {
      statProvider: 'beszel',
      beszelUrl: `http://${host(i)}`,
      beszelUser: 'u',
      beszelPass: 'p',
      beszelSystem: 'sys1',
      network: { interface: '*' },
    });
  for (let i = 0; i <= SERVERS_KEPT; i++) await poll(i);
  await poll(SERVERS_KEPT);
  assert.equal(stub.count(host(SERVERS_KEPT), 'auth-with-password'), 1, 'a recent server is still signed in');
  await poll(0);
  assert.equal(stub.count(host(0), 'auth-with-password'), 2, 'the oldest server signs in again');
});

test('System Summary forgets the oldest network totals once more than the cap are polled', async () => {
  let total = 0;
  const stub = countingStub(() => {
    total += 1000;
    return {
      status: 200,
      data: { data: { metrics: { network: [{ name: 'eth0', bytesReceived: total, bytesSent: total }] } } },
    };
  });
  const poll = i =>
    pollWith('system-summary', stub.fetch, 'throughput', {
      statProvider: 'unraid',
      unraidUrl: `http://unraid${i}.lan`,
      unraidApiKey: 'k',
      network: { interface: 'eth0' },
    });
  for (let i = 0; i <= SERVERS_KEPT; i++) assert.equal(await poll(i), null);
  await new Promise(r => setTimeout(r, 5));
  assert.notEqual(await poll(SERVERS_KEPT), null, 'a recent interface has a rate');
  assert.equal(await poll(0), null, 'the oldest interface starts over');
});
