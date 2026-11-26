const { startApp } = require('../test-support/app');
const api = startApp({ label: 'restore' });

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const { saveConfig, loadConfig, migrate } = require('../src/config');
const { withRev } = require('../test-support/config-rev');

before(async () => {
  saveConfig(migrate({ items: [], settings: { theme: 'light' } }));
});

test('a write carrying an older schema version is migrated', async () => {
  const res = await fetch(`${api.base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: api.base },
    body: JSON.stringify(
      withRev({
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
    ),
  });
  assert.equal(res.status, 200);
  const cfg = loadConfig();
  assert.equal(cfg.items.find(i => i.id === 'g').widgetSize, 'large');
  const app = cfg.items.find(i => i.id === 'a');
  assert.equal(app.badge, undefined);
  assert.equal(app.monitoring.activity.url, 'https://a.invalid/x');
  assert.equal(cfg.settings.theme, 'dark');
});
