const { startApp } = require('../test-support/app');
const app = startApp({ label: 'csp-report' });

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../src/auth');
const report = require('../src/routes/csp-report');

async function captured(fn) {
  const lines = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    if (/^\d{4}-\d\d-\d\dT\S+ WRN msg=/.test(String(chunk))) lines.push(String(chunk));
    return write.call(process.stdout, chunk, ...rest);
  };
  try {
    await fn();
  } finally {
    process.stdout.write = write;
  }
  return lines;
}

const send = (body, type, headers = {}) =>
  app.request('POST', '/api/csp-report', {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    origin: null,
    headers: { 'Content-Type': type, ...headers },
  });

const modern = (over = {}) => [
  {
    type: 'csp-violation',
    age: 10,
    url: 'http://nas.local:8700/widgets/mine/index.html?id=w1&token=abc#x',
    user_agent: 'Test',
    body: {
      documentURL: 'http://nas.local:8700/widgets/mine/index.html?id=w1&token=abc#x',
      blockedURL: 'inline',
      effectiveDirective: 'script-src-elem',
      sample: 'console.log("a very long inline script that goes on and on")',
      lineNumber: 12,
      columnNumber: 3,
      disposition: 'report',
      ...over,
    },
  },
];

beforeEach(() => {
  auth._resetRateLimits();
  report._resetLogged();
});

test('a modern report is answered 204 with no session and no Origin', async () => {
  const r = await send(modern(), 'application/reports+json');
  assert.equal(r.status, 204);
  assert.equal(r.text, '');
});

test('a violation is logged once with the page path, never the query', async () => {
  const lines = await captured(async () => {
    await send(modern(), 'application/reports+json');
    await send(modern(), 'application/reports+json');
  });
  assert.equal(lines.length, 1, 'a repeat within the hour is not logged again');
  const line = lines[0];
  assert.match(line, /msg="content security policy violation"/);
  assert.match(line, /directive=script-src-elem/);
  assert.match(line, /blocked=inline/);
  assert.match(line, /page=\/widgets\/mine\/index\.html /);
  assert.match(line, /line=12 column=3/);
  assert.match(line, /disposition=report/);
  assert.ok(line.includes('sample="console.log(\\"a very long inline script t"'), line);
  assert.doesNotMatch(line, /token|id=w1|#x|nas\.local/);
});

test('the legacy application/csp-report format is read the same way', async () => {
  const body = {
    'csp-report': {
      'document-uri': 'http://nas.local/?secret=1',
      'blocked-uri': 'https://cdn.example/lib.js?key=2',
      'violated-directive': "script-src-elem 'self'",
      'effective-directive': 'script-src-elem',
      'script-sample': 'not kept for a URL',
      'line-number': 4,
      disposition: 'enforce',
    },
  };
  const lines = await captured(async () => {
    assert.equal((await send(body, 'application/csp-report')).status, 204);
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /blocked=https:\/\/cdn\.example\/lib\.js /);
  assert.match(lines[0], /page=\/ /);
  assert.match(lines[0], /disposition=enforce/);
  assert.doesNotMatch(lines[0], /secret|key=2|sample=/);
});

test('a Trusted Types report keeps its sample, an eval report does not', () => {
  const [tt] = report.parseReports(
    'application/reports+json',
    JSON.stringify(
      modern({
        blockedURL: 'trusted-types-sink',
        effectiveDirective: 'require-trusted-types-for',
        sample: 'Element innerHTML|<b>',
      }),
    ),
  );
  assert.equal(tt.blocked, 'trusted-types-sink');
  assert.equal(tt.sample, 'Element innerHTML|<b>');
  const [ev] = report.parseReports('application/reports+json', JSON.stringify(modern({ blockedURL: 'eval' })));
  assert.equal(ev.blocked, 'eval');
  assert.equal(ev.sample, undefined);
});

test('a body that is not a report is answered 204 and logs nothing', async () => {
  const lines = await captured(async () => {
    for (const [body, type] of [
      ['not json', 'application/reports+json'],
      ['{"x":1}', 'application/reports+json'],
      ['[{"type":"deprecation","body":{}}]', 'application/reports+json'],
      ['{"csp-report":"x"}', 'application/csp-report'],
      [JSON.stringify(modern()), 'application/json'],
      [JSON.stringify(modern({ effectiveDirective: 'bad<directive' })), 'application/reports+json'],
    ]) {
      assert.equal((await send(body, type)).status, 204, body);
    }
  });
  assert.deepEqual(lines, []);
});

test('a body over the cap is answered 204 and not read', async () => {
  const big = JSON.stringify(modern({ sample: 'x'.repeat(report.REPORT_BODY_MAX_BYTES) }));
  const lines = await captured(async () => {
    assert.equal((await send(big, 'application/reports+json')).status, 204);
  });
  assert.deepEqual(lines, []);
});

test('one client is limited per minute, and every client together has a cap', async () => {
  const distinct = i => modern({ lineNumber: i });
  const lines = await captured(async () => {
    for (let i = 0; i < report.PER_CLIENT_PER_MINUTE + 5; i++) {
      assert.equal((await send(distinct(i), 'application/reports+json')).status, 204);
    }
  });
  assert.equal(lines.length, report.PER_CLIENT_PER_MINUTE);

  auth._resetRateLimits();
  report._resetLogged();
  for (let i = 0; i < report.ALL_PER_MINUTE; i++) auth.rateLimit('all', 'csp-report', report.ALL_PER_MINUTE, 60_000);
  const after = await captured(async () => {
    await send(distinct(1), 'application/reports+json');
  });
  assert.deepEqual(after, [], 'the global cap holds even for a client under its own limit');
});

test('the repeat window ends, and the record of logged reports stays bounded', () => {
  const v = { directive: 'script-src-elem', blocked: 'inline', page: '/x', disposition: 'report' };
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try {
    assert.equal(report.logOnce(v, 1_000), true);
    assert.equal(report.logOnce(v, 1_000 + report.REPEAT_MS - 1), false);
    assert.equal(report.logOnce(v, 1_000 + report.REPEAT_MS), true);
    for (let i = 0; i < 2_000; i++) report.logOnce({ ...v, line: i }, 5_000);
    assert.equal(report.logOnce({ ...v, line: 1_999 }, 5_001), false, 'the newest entries are kept');
    assert.equal(report.logOnce({ ...v, line: 0 }, 5_001), true, 'the oldest entries are dropped');
  } finally {
    process.stdout.write = write;
  }
});
