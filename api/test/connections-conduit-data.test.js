const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'connections', 'data.js'));

test('the conduit map service fetches /metrics raw and parses region data', async () => {
  const metrics = [
    'conduit_region_connected_clients{region="US",scope="common"} 12',
    'conduit_region_connected_clients{region="DE",scope="common"} 0',
    'conduit_max_common_clients 100',
    'conduit_connected_clients 12',
    'conduit_is_live 1',
  ].join('\n');

  const calls = [];
  const fetchJSON = async (url, opts) => { calls.push({ url, opts }); return { status: 200, data: metrics }; };
  const config = { services: [{ type: 'conduit', url: 'http://conduit.local:8080', enabled: true }] };

  const r = await dataFn({ endpoint: 'map', config, fetchJSON });

  assert.match(calls[0].url, /\/metrics$/);
  assert.equal(calls[0].opts.raw, true);

  const svc = r.services.find(s => s.type === 'conduit');
  assert.equal(svc.kind, 'regions');
  assert.deepEqual(svc.regions, { US: 12 }); // zero-count DE is dropped
  assert.equal(svc.limit, 100);
  assert.equal(svc.connected, 12);
  assert.equal(svc.live, 1);
});
