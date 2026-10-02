const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { normalizeBase } = require('../src/widget-data');
const { errorParts } = require('../test-support/widget-ctx');

const dataFn = require(path.join(__dirname, '..', '..', 'docs', 'widget-template', 'data.js'));

const ctxFor = (config, reply) => ({ config, normalizeBase, fetchJSON: async () => reply, ...errorParts() });

test('the template refuses an unset URL as a failure, not as data', async () => {
  await assert.rejects(dataFn(ctxFor({}, null)), err => err.kind === 'invalid');
});

for (const [status, kind] of [
  [401, 'auth'],
  [404, 'upstream'],
  [500, 'upstream'],
]) {
  test(`the template fails on an upstream ${status}`, async () => {
    await assert.rejects(dataFn(ctxFor({ url: 'http://svc' }, { status, data: null })), err => err.kind === kind);
  });
}

test('the template fails on a reply without items', async () => {
  await assert.rejects(dataFn(ctxFor({ url: 'http://svc' }, { status: 200, data: {} })), /no items/);
});

test('the template returns items from a good reply', async () => {
  const r = await dataFn(ctxFor({ url: 'http://svc' }, { status: 200, data: { items: [{ name: 'a' }], total: 4 } }));
  assert.deepEqual(r, { items: [{ name: 'a' }], total: 4 });
});
