const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  classify,
  splitSeries,
  fallbackRoutes,
  headerRules,
  redirectRules,
  injectScript,
} = require('../../scripts/demo/build');
const { writeRoutes, routePattern } = require('../../scripts/demo/source');

const ok = body => [200, JSON.stringify(body)];

test('an answer that never changed is fixed, one that changed is replayed', () => {
  const frames = [
    { 'GET /api/config': ok({ a: 1 }), 'GET /api/widget-data/w': ok({ cpu: 10 }) },
    { 'GET /api/config': ok({ a: 1 }), 'GET /api/widget-data/w': ok({ cpu: 12 }) },
  ];
  const { fixed, varying } = classify(frames);
  assert.deepEqual(Object.keys(fixed), ['GET /api/config']);
  assert.deepEqual(varying, ['GET /api/widget-data/w']);
});

test('a series is cut into chunks named by their content', () => {
  const frames = Array.from({ length: 5 }, (_, i) => ({ k: ok({ i }) }));
  const chunks = splitSeries(frames, 'k', 2);
  assert.deepEqual(
    chunks.map(c => JSON.parse(c.json).length),
    [2, 2, 1],
  );
  const changed = splitSeries([{ k: ok({ i: 9 }) }, ...frames.slice(1)], 'k', 2);
  assert.notEqual(changed[0].name, chunks[0].name, 'new content must get a new name, or browsers keep the old chunk');
  assert.equal(changed[1].name, chunks[1].name);
});

const ping = {
  method: 'POST',
  route: '/api/ping',
  answer: ok({
    ok: false,
    error: 'Outbound requests are disabled in demo mode',
    kind: 'blocked',
    code: 'blocked.demo',
  }),
};

test('a query the recording never saw falls back only when every recorded query failed', () => {
  const routes = fallbackRoutes({
    fixed: {
      'GET /api/icons/search?q=plex': [502, '{"error":"x"}'],
      'GET /api/icons/variants?ref=a': ok({ variants: ['a'] }),
      'GET /api/icons/variants?ref=b': [404, '{}'],
    },
    writes: [ping],
  });
  const gets = routes.filter(([r]) => r.method === 'GET').map(([r]) => r.path);
  assert.deepEqual(gets, [routePattern('/api/icons/search')]);
});

test('an options lookup answers with the outbound refusal the image gives', () => {
  const routes = fallbackRoutes({
    fixed: {},
    writes: [ping, { method: 'POST', route: '/api/widget-options/:id', answer: [400, '{}'] }],
  });
  const [, [status, body]] = routes.find(([r]) => r.path === routePattern('/api/widget-options/:id'));
  assert.equal(status, 502);
  assert.equal(JSON.parse(body).error, 'Outbound requests are disabled in demo mode');
  assert.throws(() =>
    fallbackRoutes({ fixed: {}, writes: [{ method: 'POST', route: '/api/widget-options/:id', answer: [400, '{}'] }] }),
  );
});

const BASE = {
  'content-security-policy': 'default',
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
};
const WIDGET = { 'content-security-policy': 'widget', 'x-content-type-options': 'nosniff' };

test('header rules start from the main page and group folders that differ', () => {
  const text = headerRules({
    '/index.html': BASE,
    '/js/a.js': BASE,
    '/js/b.js': BASE,
    '/widgets/w/index.html': WIDGET,
    '/widgets/w/data.js': WIDGET,
  });
  assert.match(text, /^\/\*\n {2}Content-Security-Policy: default\n/);
  const widgets = text.split('\n\n').find(r => r.startsWith('/widgets/*'));
  assert.ok(widgets, text);
  assert.match(widgets, /! Content-Security-Policy\n {2}Content-Security-Policy: widget/);
  assert.match(widgets, /! X-Frame-Options\n/);
  assert.doesNotMatch(widgets, /X-Frame-Options: /);
  assert.doesNotMatch(text, /\/js\//, 'a folder with the base headers needs no rule');
});

test('a folder with mixed headers gets one rule per differing file', () => {
  const text = headerRules({
    '/index.html': BASE,
    '/mix/x.js': BASE,
    '/mix/y.js': { ...BASE, 'cache-control': 'no-store' },
  });
  assert.match(text, /^\/mix\/y\.js\n {2}Cache-Control: no-store$/m);
  assert.doesNotMatch(text, /^\/mix\/\*/m);
});

test('a route that needs other headers than its folder rule stops the build', () => {
  const files = { '/index.html': BASE, '/admin/index.html': WIDGET };
  assert.doesNotThrow(() => headerRules(files, { '/admin/': WIDGET, '/admin': WIDGET }));
  assert.throws(() => headerRules(files, { '/admin/': BASE }), /needs other headers/);
});

test('the base is the main page even when most files are widgets', () => {
  const files = { '/index.html': BASE, '/w/a.js': WIDGET, '/w/b.js': WIDGET, '/w/c.js': WIDGET };
  assert.match(headerRules(files), /^\/\*\n {2}Content-Security-Policy: default\n/);
  assert.throws(() => headerRules({ '/w/a.js': WIDGET }), /no \/index.html/);
});

test('more rules than Cloudflare reads stops the build', () => {
  const files = { '/index.html': BASE };
  for (let i = 0; i < 120; i++) files[`/f${i}.js`] = { ...BASE, 'cache-control': `max-age=${i}` };
  assert.throws(() => headerRules(files), /Cloudflare allows 100/);
});

test('each route the image answered serves its folder page', () => {
  assert.equal(
    redirectRules(['/admin/', '/', '/admin']),
    '/ /index.html 200\n/admin /admin/index.html 200\n/admin/ /admin/index.html 200\n',
  );
});

test('the replay script loads before anything else in the page', () => {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><script type="module" src="/js/a.js"></script>';
  const out = injectScript(html, '/demo-replay/replay.1.js');
  assert.ok(out.indexOf('replay.1.js') < out.indexOf('/js/a.js'));
  assert.ok(out.startsWith('<!doctype html><html lang="en"><head><script src="/demo-replay/replay.1.js"></script>'));
  assert.throws(() => injectScript('<p>no head</p>', '/x.js'));
});

test('every write route of the API is found, with its parameters', () => {
  const routes = writeRoutes(path.join(__dirname, '..', '..', 'api', 'src')).map(r => `${r.method} ${r.route}`);
  assert.ok(routes.includes('POST /api/config'));
  assert.ok(routes.includes('POST /api/widget-options/:id'));
  assert.ok(routes.every(r => /^(POST|PUT|PATCH|DELETE) \/api\//.test(r)));
  assert.match('/api/widget-options/w-stats', new RegExp(routePattern('/api/widget-options/:id')));
  assert.doesNotMatch('/api/widget-options/a/b', new RegExp(routePattern('/api/widget-options/:id')));
});
