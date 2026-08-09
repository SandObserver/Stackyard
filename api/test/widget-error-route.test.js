/* A widget failure, end to end through /api/widget-data.

   The point of a vouched message is that it survives the sanitiser and reaches
   the browser. errorBody can be unit-tested, but that would still pass if the
   route never consulted it, so this drives the real route against a real widget
   on disk.

   Its own file because WIDGETS_PATH and CONFIG_PATH are read when their modules
   load, so both have to be set before anything is required. */

const path = require('node:path');
const fs = require('node:fs');

const { tmpDir } = require('../test-support/tmp');
const root = tmpDir('werr-route');
const widgetsDir = path.join(root, 'widgets');

/* Two widgets: one reporting in its own words, one letting a plain Error out. */
function writeWidget(name, dataSrc) {
  const dir = path.join(widgetsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'widget.json'), JSON.stringify({ name, label: name, sizes: ['small'] }));
  fs.writeFileSync(path.join(dir, 'data.js'), dataSrc);
}
writeWidget('vouched', "module.exports = ctx => ctx.fail('Set a Pi-hole password', { kind: ctx.KIND.AUTH });\n");
writeWidget('raw', "module.exports = () => { throw new Error('connect ECONNREFUSED 172.17.0.2:8181'); };\n");

process.env.WIDGETS_PATH = widgetsDir;
process.env.CONFIG_PATH = path.join(root, 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
require('../src/widget-data');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { KIND } = require('../src/api-error');

let server, port;

before(async () => {
  saveConfig({
    items: [
      { id: 'w-vouched', type: 'widget', widgetType: 'vouched', widgetConfig: {} },
      { id: 'w-raw', type: 'widget', widgetType: 'raw', widgetConfig: {} },
    ],
    settings: {},
  });
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(
  () =>
    new Promise(r => {
      server.closeAllConnections?.();
      server.close(r);
    }),
);

function get(id) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path: `/api/widget-data/${id}` }, res => {
        let b = '';
        res.on('data', c => {
          b += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
      })
      .on('error', reject);
  });
}

test('the fixture widgets really loaded', () => {
  const reg = require('../src/widgets').getRegistry();
  assert.ok(reg.vouched, 'the vouched fixture is not registered');
  assert.ok(reg.raw, 'the raw fixture is not registered');
});

test('a vouched message reaches the browser with its kind', async () => {
  const { status, body } = await get('w-vouched');
  assert.equal(status, 502);
  assert.equal(body.error, 'Set a Pi-hole password');
  assert.equal(body.kind, KIND.AUTH);
});

/* The guarantee the exception is carved out of: anything not vouched for is
   still replaced, so an address or a path cannot ride out on a message. */
test('a plain thrown Error is still sanitised on the way out', async () => {
  const { status, body } = await get('w-raw');
  assert.equal(status, 502);
  assert.equal(body.error, 'Something went wrong.');
  assert.ok(!JSON.stringify(body).includes('172.17.0.2'), 'the address must not be forwarded');
});
