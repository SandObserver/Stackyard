const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeBase } = require('../src/widget-data');
const { errorParts } = require('../test-support/widget-ctx');

const template = path.join(__dirname, '..', '..', 'docs', 'widget-template');
const dataFn = require(path.join(template, 'data.js'));

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

test('the template leaves the total out when Show total is off', async () => {
  const r = await dataFn(
    ctxFor({ url: 'http://svc', showTotal: false }, { status: 200, data: { items: [{ name: 'a' }], total: 4 } }),
  );
  assert.equal(r.total, null);
});

test('every template field is read by its data module', () => {
  const src = fs.readFileSync(path.join(template, 'data.js'), 'utf8');
  const { fields } = JSON.parse(fs.readFileSync(path.join(template, 'widget.json'), 'utf8'));
  assert.deepEqual(
    fields.map(f => f.key).filter(k => !new RegExp(`\\b${k}\\b`).test(src)),
    [],
  );
});
