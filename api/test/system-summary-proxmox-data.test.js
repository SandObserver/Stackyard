const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { dispatchProvider } = require('../src/provider-dispatch');
const { errorParts } = require('../test-support/widget-ctx');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');

const GB = 1024 ** 3;
const TOKEN = 'stackyard@pve!dash';
const SECRET = '0b5f7c2e-1d3a-4c6b-9e8f-2a7d4b1c0e9f';

const REPLIES = {
  '/nodes': [
    { node: 'pve', status: 'online', uptime: 86400, cpu: 0.1 },
    { node: 'pve2', status: 'online', uptime: 3600, cpu: 0.2 },
  ],
  '/nodes/pve/status': {
    cpu: 0.125,
    wait: 0.02,
    uptime: 90000,
    memory: { used: 8 * GB, total: 32 * GB, free: 24 * GB },
    rootfs: { used: 25 * GB, total: 100 * GB, free: 75 * GB, avail: 70 * GB },
  },
  '/nodes/pve/storage': [
    { storage: 'local-lvm', used: 300 * GB, total: 400 * GB },
    { storage: 'local', used: 10 * GB, total: 100 * GB },
  ],
};

function ctxFor(config, reply, endpoint = 'system') {
  const sent = [];
  const ctx = {
    endpoint,
    config: {
      statProvider: 'proxmox',
      proxmoxUrl: 'pve.local:8006',
      proxmoxTokenId: TOKEN,
      proxmoxSecret: SECRET,
      proxmoxNode: 'pve',
      ...config,
    },
    normalizeBase,
    serviceBase,
    serviceLink,
    fetchJSON: async (url, opts) => {
      sent.push({ url, opts });
      if (reply) return reply(url);
      const p = new URL(url).pathname.replace('/api2/json', '');
      return p in REPLIES ? { status: 200, data: { data: REPLIES[p] } } : { status: 404, data: null };
    },
    ...errorParts(),
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return { ctx, sent };
}

const SLOTS = [{ type: 'cpu' }, { type: 'ram' }, { type: 'disk', primary: '', secondary: 'local-lvm' }];

test('a bare host is reached over HTTPS with the token header', async () => {
  const { ctx, sent } = ctxFor({ slots: SLOTS });
  await dataFn(ctx);
  assert.ok(sent.every(s => s.url.startsWith('https://pve.local:8006/api2/json/')));
  assert.equal(sent[0].opts.headers.Authorization, `PVEAPIToken=${TOKEN}=${SECRET}`);
});

test('the node status maps onto the shape the widget renders', async () => {
  const { ctx } = ctxFor({ slots: SLOTS });
  const r = await dataFn(ctx);
  assert.equal(r.cpu, 12.5);
  assert.equal(r.ram, 25);
  assert.equal(r.temp, null);
  assert.equal(r.iowait, 2);
  assert.equal(r.uptime, 90000);
  assert.deepEqual(r.disks, [
    { mount: '', usedPct: 25, totalGb: 100 },
    { mount: 'local-lvm', usedPct: 75, totalGb: 400 },
  ]);
  assert.equal(r.link, 'https://pve.local:8006');
});

test('a chosen node is read with one request, or two with storage', async () => {
  const { ctx, sent } = ctxFor({ slots: SLOTS });
  await dataFn(ctx);
  assert.deepEqual(sent.map(x => new URL(x.url).pathname).sort(), [
    '/api2/json/nodes/pve/status',
    '/api2/json/nodes/pve/storage',
  ]);
});

test('a chosen node that is gone is named', async () => {
  const { ctx } = ctxFor({ proxmoxNode: 'old', slots: SLOTS });
  await assert.rejects(() => dataFn(ctx), /no node called old/);
});

test('an address copied from the Proxmox tab drops the view after #', async () => {
  const { ctx, sent } = ctxFor({ proxmoxUrl: 'https://pve.local:8006/#v1:0:18:4:::::::', slots: SLOTS });
  const r = await dataFn(ctx);
  assert.ok(sent.every(x => x.url.startsWith('https://pve.local:8006/api2/json/')));
  assert.equal(r.link, 'https://pve.local:8006');
});

test('storage is only asked for when a slot names one', async () => {
  const { ctx, sent } = ctxFor({ slots: [{ type: 'cpu' }, { type: 'disk', primary: '/' }] });
  await dataFn(ctx);
  assert.ok(!sent.some(s => s.url.includes('/storage')));
});

test('the only node is used when none is chosen', async () => {
  const one = url => {
    const p = new URL(url).pathname.replace('/api2/json', '');
    const data = p === '/nodes' ? [REPLIES['/nodes'][0]] : REPLIES[p];
    return { status: 200, data: { data } };
  };
  const { ctx } = ctxFor({ proxmoxNode: '', slots: SLOTS }, one);
  assert.equal((await dataFn(ctx)).cpu, 12.5);
});

test('a cluster with no node chosen asks for one', async () => {
  const { ctx } = ctxFor({ proxmoxNode: '', slots: SLOTS });
  await assert.rejects(() => dataFn(ctx), /Choose a node/);
});

test('the node picker lists the nodes', async () => {
  const { ctx } = ctxFor({}, null, 'nodes');
  assert.deepEqual((await dataFn(ctx)).options, [
    { value: 'pve', label: 'pve' },
    { value: 'pve2', label: 'pve2' },
  ]);
});

test('a refused token and a missing role are auth failures', async () => {
  for (const status of [401, 403]) {
    const { ctx } = ctxFor({ slots: SLOTS }, () => ({ status, data: null }));
    await assert.rejects(
      () => dataFn(ctx),
      e => e.kind === 'auth',
    );
  }
});

test('a token ID that could split the header is refused before any request', async () => {
  const { ctx, sent } = ctxFor({ proxmoxTokenId: 'a@b!c\r\nX: y', slots: SLOTS });
  await assert.rejects(() => dataFn(ctx), /user@realm!name/);
  assert.equal(sent.length, 0);
});

test('the self-signed switch reaches the request', async () => {
  const { ctx, sent } = ctxFor({ proxmoxSkipTls: true, slots: SLOTS });
  await dataFn(ctx);
  assert.ok(sent.every(s => s.opts.skipTls === true));
});
