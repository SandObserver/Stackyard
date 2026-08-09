/* P13-1: widgets reported failures two ways, and the two behaved differently.

   Four data.js files threw and four returned { error }. A throw becomes a 502,
   so fetchData rejects and the shared poll() lifecycle treats it as a failure:
   it counts toward staleAfter, keeps the last good render, and shows how long
   ago the data was fresh. A returned { error } arrives as HTTP 200, so poll()
   records a success, resets the failure count, and hands { error } to render()
   as though it were data. Two widgets did both.

   Everything throws now. The obstacle was that a thrown message is replaced by
   a generic one, which is right for a caught exception and wrong for "Set a
   Pi-hole password", so WidgetError carries a message its author vouched for.
   ctx.fail is how a data.js throws one. */

const path = require('node:path');
const fs = require('node:fs');
const { tmpDir, tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('werr'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WidgetError, errorBody, hasVouchedMessage, KIND } = require('../src/api-error');
const { dataFnContext } = require('../src/widget-data');

test('a WidgetError message reaches the browser intact', () => {
  const body = errorBody(new WidgetError('Set a Pi-hole password', { kind: KIND.AUTH }));
  assert.equal(body.error, 'Set a Pi-hole password');
  assert.equal(body.kind, KIND.AUTH);
});

/* The rule it is an exception to: anything else is replaced, because an
   arbitrary message may name a host, a path or an upstream body. */
test('a plain Error is still sanitised', () => {
  const body = errorBody(new Error('connect ECONNREFUSED 172.17.0.2:8181'));
  assert.equal(body.error, 'Something went wrong.');
  assert.ok(!body.error.includes('172.17.0.2'));
});

test('a network failure keeps its classification and stays generic', () => {
  const e = Object.assign(new Error('getaddrinfo ENOTFOUND nas.internal.lan'), { code: 'ENOTFOUND' });
  const body = errorBody(e);
  assert.equal(body.kind, KIND.NETWORK);
  assert.ok(!body.error.includes('nas.internal.lan'), 'the hostname must not be forwarded');
});

test('an explicit override still wins over everything', () => {
  const body = errorBody(new WidgetError('vouched'), { error: 'chosen by the route' });
  assert.equal(body.error, 'chosen by the route');
});

test('WidgetError defaults to upstream, since it usually reports one', () => {
  assert.equal(errorBody(new WidgetError('anything')).kind, KIND.UPSTREAM);
});

/* Recognised by a field rather than by instanceof: a widget's data.js is loaded
   with require() from the widgets directory, so a constructor comparison across
   that boundary is a hazard. */
test('a vouched message is recognised without instanceof', () => {
  assert.equal(hasVouchedMessage(new WidgetError('x')), true);
  assert.equal(hasVouchedMessage({ vouchedMessage: 'from another realm' }), true);
  assert.equal(hasVouchedMessage(new Error('x')), false);
  assert.equal(hasVouchedMessage({ vouchedMessage: '' }), false, 'an empty message vouches for nothing');
  assert.equal(hasVouchedMessage(null), false);
  assert.equal(hasVouchedMessage(undefined), false);
});

/* ── the ctx a data.js actually receives ─────────────────────────────────── */

const ctx = () => dataFnContext({}, '', new URLSearchParams(), async () => ({ status: 200, data: {} }));

test('ctx.fail throws rather than returning', () => {
  assert.throws(() => ctx().fail('Enter the Scrutiny URL first.'), /Enter the Scrutiny URL first/);
});

test('what ctx.fail throws carries the message through to the response', () => {
  let thrown;
  try { ctx().fail('TrueNAS auth failed, check API key', { kind: KIND.AUTH }); }
  catch (e) { thrown = e; }
  assert.ok(thrown);
  const body = errorBody(thrown);
  assert.equal(body.error, 'TrueNAS auth failed, check API key');
  assert.equal(body.kind, KIND.AUTH);
});

test('ctx exposes the kinds so a widget can classify without importing', () => {
  const c = ctx();
  assert.equal(c.KIND.AUTH, KIND.AUTH);
  assert.equal(c.KIND.INVALID, KIND.INVALID);
});

/* ── every bundled widget reports the same way ───────────────────────────── */

const WIDGETS = path.join(__dirname, '..', '..', 'ui', 'widgets');
const dataFiles = fs.readdirSync(WIDGETS)
  .map(n => [n, path.join(WIDGETS, n, 'data.js')])
  .filter(([, p]) => fs.existsSync(p));

test('the scan finds the widgets it is meant to check', () => {
  assert.ok(dataFiles.length >= 8, `only ${dataFiles.length} data functions found`);
});

/* The finding itself: no widget may report its own failure by returning it,
   because that reaches the browser as a success and bypasses the poll
   lifecycle.

   What is matched is a whole-response error, `return { error: ... }` and
   nothing else. An error field alongside real fields is a different thing: the
   connections map reports per-service status and disk-health reports per-bay
   status inside a response that succeeded, where one service or bay being down
   is data rather than a widget failure. */
test('no widget returns an error instead of throwing', () => {
  const offenders = [];
  for (const [name, p] of dataFiles) {
    const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/return\s*\{\s*error\s*:[^}]*\}/g)) {
      offenders.push(`${name}: ${m[0].slice(0, 60)}`);
    }
  }
  assert.deepEqual(offenders, [],
    `Whole-response error returned instead of thrown. Use ctx.fail(message) so the failure reaches the poll lifecycle:\n${offenders.join('\n')}`);
});

/* A caught exception re-reported as a returned field skipped sanitisation
   entirely: the raw message went to the browser in a 200 body. There were 17. */
test('no widget forwards a raw caught message to the browser', () => {
  const offenders = [];
  for (const [name, p] of dataFiles) {
    const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/error:\s*e\.message/.test(src)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `Raw caught message sent as data: ${offenders.join(', ')}`);
});

/* The frontend half of the same rule. A data.js can vouch for "Enter the
   Scrutiny URL first." and the browser still show "HTTP 503", because a
   hand-rolled fetch throws on the status and never reads the body. fetchData
   reads it; a hand-rolled fetch must read `.error` itself. */
const frontendFiles = fs.readdirSync(WIDGETS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .flatMap(d => fs.readdirSync(path.join(WIDGETS, d.name))
    .filter(n => n.endsWith('.html'))
    .map(n => [`${d.name}/${n}`, path.join(WIDGETS, d.name, n)]));

test('every widget frontend shows the message the server vouched for', () => {
  const offenders = [];
  for (const [name, p] of frontendFiles) {
    const src = fs.readFileSync(p, 'utf8');
    if (!src.includes('/widget-data/') && !/\bfetchData\s*\(/.test(src)) continue;
    const usesToolbox = /\bfetchData\s*\(/.test(src);
    const readsError = /\.error\s*\|\||\berror:\s*\w+\.error\b/.test(src);
    if (!usesToolbox && !readsError) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    `Widget-data failure reported without the server's message. Use fetchData from widget-toolbox, or read .error off the response body:\n${offenders.join('\n')}`);
});
