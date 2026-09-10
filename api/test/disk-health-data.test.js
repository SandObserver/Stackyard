const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { dispatchProvider } = require(path.join(__dirname, '..', 'src', 'provider-dispatch.js'));
const { normalizeBase } = require(path.join(__dirname, '..', 'src', 'widget-data.js'));

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'disk-health', 'data.js'));

const KIND = { INVALID: 'invalid', AUTH: 'auth' };

function makeCtx(endpoint, config, fetchJSON) {
  const ctx = {
    endpoint,
    config,
    fetchJSON,
    normalizeBase,
    KIND,
    fail: (message, opts) => {
      const e = new Error(message);
      e.kind = opts?.kind;
      throw e;
    },
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return ctx;
}

/* One device, described the way each Scrutiny build describes it. The map key
   is the identifier in all three. */
const FORK = { '2f18a4f8-9ae8': { device: { device_id: '2f18a4f8-9ae8', model_name: 'WD Red', wwn: '0x5001' } } };
const ORIGINAL_UUID = { 'a1b2-c3d4': { device: { scrutiny_uuid: 'a1b2-c3d4', model_name: 'WD Red', wwn: '0x5001' } } };
const ORIGINAL_WWN = { '0x5001': { device: { wwn: '0x5001', model_name: 'WD Red' } } };
const NO_ID = { 'key-only': { device: { model_name: 'WD Red' } } };

const summaryFetch = summary => async () => ({ status: 200, data: { data: { summary } } });

for (const [name, summary, expected] of [
  ['the fork, which sends device_id', FORK, '2f18a4f8-9ae8'],
  ['the original from 0.9.0, which sends scrutiny_uuid', ORIGINAL_UUID, 'a1b2-c3d4'],
  ['the original before 0.9.0, which sends wwn', ORIGINAL_WWN, '0x5001'],
  ['a build that sends no identifier field', NO_ID, 'key-only'],
]) {
  test(`the bay picker offers a device from ${name}`, async () => {
    const ctx = makeCtx('devices', { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local' }, summaryFetch(summary));
    const r = await dataFn(ctx);
    assert.deepEqual(r.options, [{ value: expected, label: 'WD Red' }]);
  });

  test(`a configured bay resolves against ${name}`, async () => {
    const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: [expected] };
    const r = await dataFn(makeCtx('', config, summaryFetch(summary)));
    assert.equal(r.bays[0].device_id, expected);
    assert.equal(r.bays[0].error, undefined);
    assert.equal(r.bays[0].model_name, 'WD Red');
  });
}

test('device_id wins when a build sends more than one identifier', async () => {
  const summary = { key: { device: { device_id: 'the-id', scrutiny_uuid: 'the-uuid', wwn: '0x1', model_name: 'D' } } };
  const ctx = makeCtx('devices', { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local' }, summaryFetch(summary));
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [{ value: 'the-id', label: 'D' }]);
});

test('a bay that no device matches is reported as not found', async () => {
  const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['gone'] };
  const r = await dataFn(makeCtx('', config, summaryFetch(FORK)));
  assert.equal(r.bays[0].error, 'not found');
  assert.equal(r.bays[0].device_status, 0);
});

/* Upgrading Scrutiny changes which identifier it prefers, and the saved bay
   still holds the old one. */
test('a bay saved as a wwn still resolves once the server sends a scrutiny_uuid', async () => {
  const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['0x5001'] };
  const r = await dataFn(makeCtx('', config, summaryFetch(ORIGINAL_UUID)));
  assert.equal(r.bays[0].error, undefined, 'the disk was not found by its older identifier');
  assert.equal(r.bays[0].model_name, 'WD Red');
});

test('a bay saved as a wwn still resolves against the fork, which prefers device_id', async () => {
  const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['0x5001'] };
  const r = await dataFn(makeCtx('', config, summaryFetch(FORK)));
  assert.equal(r.bays[0].error, undefined);
  assert.equal(r.bays[0].model_name, 'WD Red');
});

/* Disk B's wwn must not take the slot disk A answers to by preference. */
test("one disk's alternate identifier never shadows another disk's preferred one", async () => {
  const summary = {
    a: { device: { device_id: 'shared', model_name: 'Disk A' } },
    b: { device: { device_id: 'b-id', wwn: 'shared', model_name: 'Disk B' } },
  };
  const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['shared', 'b-id'] };
  const r = await dataFn(makeCtx('', config, summaryFetch(summary)));
  assert.equal(r.bays[0].model_name, 'Disk A');
  assert.equal(r.bays[1].model_name, 'Disk B');
});

for (const [status, kind, match] of [
  [401, 'auth', /auth failed/],
  [403, 'auth', /auth failed/],
  [500, undefined, /Scrutiny HTTP 500/],
]) {
  /* Without this the bays render as "not found", which reads as missing disks
     rather than an unreachable server. */
  test(`the bay list reports HTTP ${status} instead of an empty summary`, async () => {
    const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['x'] };
    await assert.rejects(
      () => dataFn(makeCtx('', config, async () => ({ status, data: {} }))),
      e => match.test(e.message) && e.kind === kind,
    );
  });

  test(`the bay picker reports HTTP ${status}`, async () => {
    const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local' };
    await assert.rejects(
      () => dataFn(makeCtx('devices', config, async () => ({ status, data: {} }))),
      e => match.test(e.message) && e.kind === kind,
    );
  });
}

test('an entry carrying no device object is skipped', async () => {
  const summary = { a: {}, b: { device: { device_id: 'b1', model_name: 'D' } } };
  const ctx = makeCtx('devices', { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local' }, summaryFetch(summary));
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [{ value: 'b1', label: 'D' }]);
});
