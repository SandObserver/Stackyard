const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeBase } = require('../src/widget-data');
const { serviceLink } = require('../../ui/js/service-link.js');
const { errorParts } = require('../test-support/widget-ctx');

const template = path.join(__dirname, '..', '..', 'docs', 'widget-template');
const dataFn = require(path.join(template, 'data.js'));

const ctxFor = (config, reply) => ({
  config,
  normalizeBase,
  serviceLink,
  fetchJSON: async () => reply,
  ...errorParts(),
});

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

test('the template fails on a reply without a count', async () => {
  await assert.rejects(dataFn(ctxFor({ url: 'http://svc' }, { status: 200, data: {} })), /no count/);
});

test('the template returns the count from a good reply', async () => {
  const r = await dataFn(ctxFor({ url: 'http://svc:8080' }, { status: 200, data: { count: 4 } }));
  assert.equal(r.count, 4);
});

test('the template links to the Link URL, else to a server URL a browser can reach', async () => {
  const reply = { status: 200, data: { count: 1 } };
  const link = async config => (await dataFn(ctxFor(config, reply))).link;
  assert.equal(await link({ url: '192.168.1.5:8080' }), 'http://192.168.1.5:8080');
  assert.equal(await link({ url: 'svc:8080' }), '');
  assert.equal(await link({ url: 'svc:8080', href: 'https://svc.example' }), 'https://svc.example');
});

test('every template field is read by its data module', () => {
  const src = fs.readFileSync(path.join(template, 'data.js'), 'utf8');
  const { fields } = JSON.parse(fs.readFileSync(path.join(template, 'widget.json'), 'utf8'));
  assert.deepEqual(
    fields.map(f => f.key).filter(k => !new RegExp(`\\b${k}\\b`).test(src)),
    [],
  );
});

test('the template demo returns the shape data.js returns', () => {
  const demoFn = require(path.join(template, 'demo.js'));
  const { helpers } = require('../src/demo-data');
  const body = demoFn({ config: {}, demo: helpers });
  assert.equal(typeof body.count, 'number');
  assert.equal(typeof body.link, 'string');
});
