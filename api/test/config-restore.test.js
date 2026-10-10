const fs = require('node:fs');
const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
const dir = tmpDir('restore');
process.env.CONFIG_PATH = path.join(dir, 'apps.json');
process.env.ICONS_PATH = dir;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig, loadConfig, migrate } = require('../src/config');

const WALLPAPERS = path.join(dir, 'wallpaper');
const CURRENT = '/icons/wallpaper/wallpaper-current.jpg';
let server, base;

before(async () => {
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

beforeEach(() => {
  fs.rmSync(WALLPAPERS, { recursive: true, force: true });
  fs.mkdirSync(WALLPAPERS, { recursive: true });
  fs.writeFileSync(path.join(WALLPAPERS, path.basename(CURRENT)), 'jpg');
  saveConfig(migrate({ items: [], settings: { theme: 'light', background: { type: 'upload', url: CURRENT } } }));
});

async function post(body) {
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  return res.json();
}

test('a write carrying an older schema version is migrated', async () => {
  await post({
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
  });
  const cfg = loadConfig();
  assert.equal(cfg.items.find(i => i.id === 'g').widgetSize, 'large');
  const app = cfg.items.find(i => i.id === 'a');
  assert.equal(app.badge, undefined);
  assert.equal(app.monitoring.activity.url, 'https://a.invalid/x');
  assert.equal(cfg.settings.theme, 'dark');
});

test('a write naming a stored wallpaper that is not on disk keeps the current background', async () => {
  await post({ items: [], settings: { background: { type: 'upload', url: '/icons/wallpaper/wallpaper-gone.jpg' } } });
  assert.deepEqual(loadConfig().settings.background, { type: 'upload', url: CURRENT });
  assert.ok(fs.existsSync(path.join(WALLPAPERS, path.basename(CURRENT))));
});

test('a write naming a stored wallpaper that is on disk takes it', async () => {
  const other = '/icons/wallpaper/wallpaper-other.jpg';
  fs.writeFileSync(path.join(WALLPAPERS, path.basename(other)), 'jpg');
  await post({ items: [], settings: { background: { type: 'upload', url: other } } });
  assert.equal(loadConfig().settings.background.url, other);
});
