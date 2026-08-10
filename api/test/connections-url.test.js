/* Regression tests for P13-2: a missing service address became http://undefined.

   The Connections widget had two nearly identical URL normalisers. The VPN path
   used one that returned '' for a missing address and reported "No control
   server URL configured". The map path used its own copy without that guard, so
   a service with no address fetched http://undefined: a real DNS lookup for a
   host called "undefined", failing after a timeout with "getaddrinfo ENOTFOUND
   undefined".

   The widget therefore looked like it had a network fault when a field was
   simply empty, and the error pointed at DNS rather than at the empty field.

   Two copies of one rule is how they came to disagree, so there is one now. */

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const data = require(path.join(__dirname, '../../ui/widgets/connections/data.js'));
const { normBase } = data;
const { WidgetError, KIND } = require('../src/api-error');

/* ── the normaliser ───────────────────────────────────────────────────────── */

test('an address without a scheme gets one', () => {
  assert.equal(normBase('host:8080'), 'http://host:8080');
  assert.equal(normBase('192.168.1.5'), 'http://192.168.1.5');
});

test('an address that already has a scheme is left alone', () => {
  assert.equal(normBase('http://host:8080'), 'http://host:8080');
  assert.equal(normBase('https://host'), 'https://host');
});

/* The finding: every one of these used to produce a URL that was then fetched. */
test('a missing address produces nothing to fetch', () => {
  for (const v of [undefined, null, '']) {
    assert.equal(normBase(v), '', `${JSON.stringify(v)} must not become a URL`);
  }
});

test('an address of only whitespace is treated as missing', () => {
  /* As empty as an empty field, and http://%20%20 fails just as obscurely. */
  for (const v of ['   ', '\t', '\n ']) assert.equal(normBase(v), '');
});

test('surrounding whitespace is trimmed rather than sent', () => {
  assert.equal(normBase('  host  '), 'http://host');
  assert.equal(normBase(' http://host '), 'http://host');
});

test('the string "undefined" never appears in the result', () => {
  for (const v of [undefined, null, '']) {
    assert.ok(!normBase(v).includes('undefined'), 'this is exactly what the bug produced');
  }
});

/* ── through the widget ───────────────────────────────────────────────────── */

/* fetchJSON is passed in, so a call can be observed without any network. The
   rest of the context is the surface widget-data.js really hands a data
   function: ctx.fail throws a WidgetError, which is what marks a message as one
   the widget wrote rather than one that escaped from Node. */
function run(config, endpoint = 'map') {
  const requested = [];
  const fetchJSON = async url => {
    requested.push(url);
    return { status: 200, data: {} };
  };
  const ctx = {
    config,
    endpoint,
    fetchJSON,
    KIND,
    fail: (message, opts) => {
      throw new WidgetError(message, opts);
    },
  };
  return data(ctx).then(result => ({ result, requested }));
}

test('a service with no address is not fetched at all', async () => {
  const { requested } = await run({ services: [{ id: 's1', type: 'gluetun', url: '   ' }] });
  assert.deepEqual(requested, [], 'a request went out for an address that is not there');
});

test('a service with no address reports the reason', async () => {
  const { result } = await run({ services: [{ id: 's1', type: 'gluetun', url: '   ' }] });
  const svc = (result.services || [])[0];
  assert.ok(svc, 'the service should still be listed');
  assert.match(svc.error || '', /URL/i, `expected a message about the URL, got ${JSON.stringify(svc.error)}`);
  assert.ok(!/ENOTFOUND|undefined/i.test(svc.error || ''), 'and not a DNS failure');
});

test('a configured service is still fetched', async () => {
  const { requested } = await run({ services: [{ id: 's1', type: 'gluetun', url: 'vpn:8000' }] });
  assert.ok(requested.length > 0, 'a real address must still be requested');
  assert.ok(
    requested.every(u => u.startsWith('http://vpn:8000')),
    requested.join(', '),
  );
});

test('the VPN path still refuses a missing address', async () => {
  const { requested, result } = await run({ vpn: { service: 'gluetun', url: '' } }, 'vpn');
  assert.deepEqual(requested, []);
  assert.match(result.error || result.status || '', /URL|unknown/i);
});
