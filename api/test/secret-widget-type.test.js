const path = require('node:path');
const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
const _tmp = tmpDir('secret-type');
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');
process.env.WIDGETS_PATH = path.join(_tmp, 'widgets');

/* Two widgets that declare the same secret key. The second one returns its key,
   so a refill across types shows up in the response. */
for (const [name, data] of [
  ['alpha', 'module.exports = async () => ({ options: [] });\n'],
  ['beta', 'module.exports = async ctx => ({ options: [{ value: String(ctx.config.key) }] });\n'],
]) {
  const dir = path.join(_tmp, 'widgets', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'widget.json'),
    JSON.stringify({
      name,
      label: name,
      sizes: ['medium'],
      views: { main: { src: 'index.html' } },
      fields: [
        { key: 'url', type: 'text', label: 'URL' },
        { key: 'key', type: 'secret', label: 'Key' },
      ],
    }),
  );
  fs.writeFileSync(path.join(dir, 'index.html'), '');
  fs.writeFileSync(path.join(dir, 'data.js'), data);
}

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
require('../src/widget-data');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { preserveAllSecrets } = require('../src/config-secrets');

const SECRET = 'ALPHA-SECRET';
const stored = () => ({
  items: [{ id: 'w1', type: 'widget', widgetType: 'alpha', widgetConfig: { url: 'http://a.test', key: SECRET } }],
});
let server, base;

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(
  () =>
    new Promise(r => {
      server.closeAllConnections?.();
      server.close(r);
    }),
);
beforeEach(() => saveConfig(stored()));

test('a save that changes the widget type does not refill its secret', () => {
  const next = { items: [{ id: 'w1', type: 'widget', widgetType: 'beta', widgetConfig: { url: 'http://a.test' } }] };
  const { withheld } = preserveAllSecrets(next, stored());
  assert.equal(next.items[0].widgetConfig.key, undefined);
  assert.deepEqual(
    withheld.map(w => w.id),
    ['w1'],
  );
});

test('a save that keeps the widget type still refills its secret', () => {
  const next = { items: [{ id: 'w1', type: 'widget', widgetType: 'alpha', widgetConfig: { url: 'http://a.test' } }] };
  const { withheld } = preserveAllSecrets(next, stored());
  assert.equal(next.items[0].widgetConfig.key, SECRET);
  assert.deepEqual(withheld, []);
});

const options = widgetType =>
  fetch(`${base}/api/widget-options/w1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ widgetType, endpoint: 'any', widgetConfig: { url: 'http://a.test' } }),
  }).then(r => r.text());

test('an options fetch under the stored widget type gets the stored secret', async () => {
  const cfg = stored();
  cfg.items[0].widgetType = 'beta';
  saveConfig(cfg);
  assert.ok((await options('beta')).includes(SECRET));
});

test('an options fetch under another widget type does not get the stored secret', async () => {
  assert.ok(!(await options('beta')).includes(SECRET));
});
