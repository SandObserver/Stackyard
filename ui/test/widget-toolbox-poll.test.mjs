import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

/* widget-toolbox imports a peer by its served path ('/js/html.js?v=...') and
   reads location.search at module load, so map the path and stub location
   before loading it. */
register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };
const { poll } = await import('../js/widget-toolbox.js');

const tick = ms => new Promise(r => setTimeout(r, ms));

test('a failure within tolerance leaves the last good render in place', async () => {
  const rendered = [];
  const errors = [];
  let call = 0;
  const p = poll({
    interval: 5,
    fetch: async () => { call++; if (call === 2) throw new Error('blip'); return { call }; },
    render: d => rendered.push(d.call),
    onError: info => errors.push(info),
  });
  await tick(60);
  p.stop();

  assert.ok(rendered.includes(1), 'first success rendered');
  assert.ok(!rendered.includes(2), 'the failed fetch did not render');
  assert.equal(errors.length, 1, 'one failure reported');
  assert.equal(errors[0].stale, false, 'a single failure is not stale');
  assert.equal(errors[0].everOk, true);
});

test('consecutive failures past staleAfter report stale', async () => {
  const errors = [];
  const p = poll({
    interval: 5, staleAfter: 2,
    fetch: async () => { throw new Error('down'); },
    onError: info => errors.push(info),
  });
  await tick(40);
  p.stop();

  assert.equal(errors[0].stale, false);
  assert.equal(errors[0].everOk, false);
  assert.ok(errors.some(e => e.stale), 'goes stale once past the threshold');
});

test('interval can be a function of the last successful result', async () => {
  const seen = [];
  const p = poll({
    interval: d => { seen.push(d); return 5; },
    fetch: async () => ({ n: seen.length }),
    render: () => {},
    onError: () => {},
  });
  await tick(40);
  p.stop();

  assert.equal(seen[0].n, 0, 'first delay sees the first result');
  assert.ok(seen.length > 1, 'keeps polling');
});

test('stop halts further fetches', async () => {
  let calls = 0;
  const p = poll({
    interval: 5,
    fetch: async () => { calls++; return {}; },
    render: () => {}, onError: () => {},
  });
  await tick(30);
  p.stop();
  const atStop = calls;
  await tick(30);
  assert.equal(calls, atStop, 'no fetches after stop');
});

test('esc is re-exported and escapes single quotes', async () => {
  const { esc } = await import('../js/widget-toolbox.js');
  assert.equal(esc(`<a href='x'>&"`), '&lt;a href=&#39;x&#39;&gt;&amp;&quot;');
});
