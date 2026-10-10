const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('restore'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig, loadConfig, migrate } = require('../src/config');

let server, base;

before(async () => {
  saveConfig(migrate({ items: [], settings: { theme: 'light' } }));
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});

test('a write carrying an older schema version is migrated', async () => {
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      _schemaVersion: 6,
      items: [
        { id: 'g', type: 'widget', widgetType: 'github', widgetSize: 'xlarge' },
        {
          id: 'a',
          type: 'app',
          label: 'A',
          href: 'https://a.invalid',
          badge: { enabled: true, url: 'https://a.invalid/x' },
        },
      ],
      settings: { theme: 'dark' },
    }),
  });
  assert.equal(res.status, 200);
  const cfg = loadConfig();
  assert.equal(cfg.items.find(i => i.id === 'g').widgetSize, 'large');
  const app = cfg.items.find(i => i.id === 'a');
  assert.equal(app.badge, undefined);
  assert.equal(app.monitoring.activity.url, 'https://a.invalid/x');
  assert.equal(cfg.settings.theme, 'dark');
});
