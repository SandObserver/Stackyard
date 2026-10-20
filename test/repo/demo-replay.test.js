const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'demo', 'replay.js'), 'utf8');
const ORIGIN = 'https://demo.example';
const STEP = 5000;
const START = 1_700_000_000_000;

const index = {
  start: START,
  step: STEP,
  count: 4,
  chunk: 2,
  fixed: {
    'GET /api/config': [200, '{"items":[]}'],
    'POST /api/config': [403, '{"code":"blocked.read-only"}'],
  },
  series: { '/api/widget-data/w?endpoint=system': ['c0.json', 'c1.json'] },
  routes: [[{ method: 'GET', path: '^/api/icons/search$' }, [502, '{"error":"search"}']]],
  missing: [503, '{"error":"missing"}'],
};
const chunks = {
  'c0.json': [
    [200, '{"cpu":0,"ts":"2023-11-14T22:13:20.000Z"}'],
    [200, '{"cpu":1}'],
  ],
  'c1.json': [
    [200, '{"cpu":2}'],
    [200, '{"cpu":3}'],
  ],
};

function page(now, intercept = () => null) {
  const warnings = [];
  const passed = [];
  const window = {
    fetch: async input => {
      const url = String(input);
      const stubbed = intercept(url);
      if (stubbed) return stubbed;
      if (url === '/demo-replay/index.test.json') return new Response(JSON.stringify(index));
      const name = url.replace('/demo-replay/', '');
      if (chunks[name]) return new Response(JSON.stringify(chunks[name]));
      passed.push(url);
      return new Response('static');
    },
  };
  const ctx = {
    window,
    location: { href: `${ORIGIN}/`, origin: ORIGIN },
    console: { warn: (...a) => warnings.push(a.join(' ')) },
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    URL,
    Request,
    Response,
    Map,
    JSON,
    Math,
    RegExp,
  };
  vm.runInNewContext(SOURCE.replace('__REPLAY_INDEX__', '/demo-replay/index.test.json'), ctx);
  const get = async (url, init) => {
    const r = await window.fetch(url, init);
    return { status: r.status, body: await r.text() };
  };
  return { get, warnings, passed };
}

test('a fixed answer replays as recorded', async () => {
  const { get } = page(START);
  assert.deepEqual(await get('/api/config'), { status: 200, body: '{"items":[]}' });
});

test('a write gets its own recorded answer, by method', async () => {
  const { get } = page(START);
  assert.equal((await get('/api/config', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await get(new Request(`${ORIGIN}/api/config`, { method: 'POST', body: '{}' }))).status, 403);
});

test('a series follows the clock and loops', async () => {
  const at = async ms => JSON.parse((await page(START + ms).get('/api/widget-data/w?endpoint=system')).body).cpu;
  assert.equal(await at(0), 0);
  assert.equal(await at(STEP), 1);
  assert.equal(await at(3 * STEP + 4999), 3);
  assert.equal(await at(4 * STEP), 0, 'the recording must loop');
  assert.equal(await at(-STEP), 3, 'a clock behind the recording start must still land on a frame');
});

test('a recorded timestamp keeps the age it had when recorded', async () => {
  const later = START + 4 * STEP * 10 + 1234;
  const body = JSON.parse((await page(later).get('/api/widget-data/w?endpoint=system')).body);
  assert.equal(Date.parse(body.ts), later);
});

test('an unrecorded query uses its route fallback', async () => {
  assert.deepEqual(await page(START).get('/api/icons/search?q=anything'), { status: 502, body: '{"error":"search"}' });
});

test('an unrecorded request is reported, not hidden', async () => {
  const p = page(START);
  assert.equal((await p.get('/api/nothing')).status, 503);
  assert.match(p.warnings[0], /^\[demo-replay\] not recorded: GET \/api\/nothing$/);
});

test('a failed load is retried on the next request', async () => {
  let fail = 2;
  const p = page(START, url => {
    if (fail > 0) {
      fail--;
      return new Response('', { status: url.endsWith('index.test.json') ? 503 : 404 });
    }
    return null;
  });
  await assert.rejects(p.get('/api/config'));
  await assert.rejects(p.get('/api/widget-data/w?endpoint=system'));
  assert.equal(JSON.parse((await p.get('/api/widget-data/w?endpoint=system')).body).cpu, 0);
});

test('files and other sites go to the network', async () => {
  const p = page(START);
  await p.get('/js/a.js');
  await p.get('https://cdn.example/api/x');
  assert.deepEqual(p.passed, ['/js/a.js', 'https://cdn.example/api/x']);
});
