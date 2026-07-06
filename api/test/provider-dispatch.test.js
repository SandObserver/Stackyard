const { test } = require('node:test');
const assert = require('node:assert');
const { dispatchProvider } = require('../src/provider-dispatch');

const handlers = {
  a: async ctx => ({ picked: 'a', cfg: ctx.config }),
  b: async ctx => ({ picked: 'b' }),
};

test('selects the handler named by the default provider field', async () => {
  const r = await dispatchProvider({ config: { provider: 'b' } }, handlers, { default: 'a' });
  assert.equal(r.picked, 'b');
});

test('falls back to the default when the field is empty', async () => {
  const r = await dispatchProvider({ config: {} }, handlers, { default: 'a' });
  assert.equal(r.picked, 'a');
});

test('falls back to the default when the field names an unknown provider', async () => {
  const r = await dispatchProvider({ config: { provider: 'zzz' } }, handlers, { default: 'a' });
  assert.equal(r.picked, 'a');
});

test('reads the provider from a custom field', async () => {
  const r = await dispatchProvider({ config: { diskProvider: 'b' } }, handlers, { field: 'diskProvider', default: 'a' });
  assert.equal(r.picked, 'b');
});

test('passes ctx through to the handler', async () => {
  const cfg = { provider: 'a', token: 'x' };
  const r = await dispatchProvider({ config: cfg }, handlers, { default: 'a' });
  assert.strictEqual(r.cfg, cfg);
});

test('returns an { error } when no handler matches and no default is given', async () => {
  const r = await dispatchProvider({ config: { provider: 'zzz' } }, handlers, {});
  assert.match(r.error, /Unknown provider: zzz/);
});

test('onError wraps a thrown handler error into the widget error shape', async () => {
  const throwing = { a: async () => { throw new Error('boom'); } };
  const r = await dispatchProvider({ config: { provider: 'a' } }, throwing,
    { default: 'a', onError: e => ({ items: [], error: e.message }) });
  assert.deepEqual(r, { items: [], error: 'boom' });
});

test('without onError, a thrown handler error propagates', async () => {
  const throwing = { a: async () => { throw new Error('boom'); } };
  await assert.rejects(
    () => dispatchProvider({ config: { provider: 'a' } }, throwing, { default: 'a' }),
    /boom/,
  );
});
