const path = require('node:path');

process.env.ALLOW_PRIVATE_IPS = 'true';
process.env.WIDGETS_PATH = path.join(__dirname, '../../ui/widgets');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('rewrite'), 'apps.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig, loadConfig } = require('../src/config');
const { rewriteChanged } = require('../src/secret-scope');

const SECRET = 'STORED-CREDENTIAL-DO-NOT-LEAK';
let server, base, catcher, catcherPort;
const seen = [];

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  catcher = http.createServer((req, res) => {
    seen.push(req.headers['x-api-key']);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"n":1}');
  });
  catcherPort = await listen(catcher);
  server = http.createServer(dispatch);
  base = `http://127.0.0.1:${await listen(server)}`;
});
after(async () => {
  await close(server);
  await close(catcher);
});

beforeEach(() => {
  seen.length = 0;
  saveConfig({
    items: [
      {
        id: 'app1',
        type: 'app',
        label: 'Sonarr',
        href: 'http://sonarr.test',
        monitoring: {
          activity: {
            enabled: true,
            url: 'http://sonarr.test/api/queue',
            extract: 'n',
            headers: [{ key: 'X-Api-Key', value: SECRET, secret: true }],
          },
        },
      },
      {
        id: 'w1',
        type: 'widget',
        widgetType: 'books',
        widgetConfig: { provider: 'audiobookshelf', absUrl: 'http://abs.test', absKey: SECRET },
      },
    ],
    settings: { background: { type: 'unsplash', apiKey: SECRET } },
  });
});

async function saveServer(serverSettings) {
  const cfg = await fetch(`${base}/api/config`).then(r => r.json());
  cfg.settings = { ...cfg.settings, server: { ...cfg.settings?.server, ...serverSettings } };
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(cfg),
  });
  assert.equal(res.status, 200);
  return res.json();
}

test('a new port map withholds every stored credential', async () => {
  const body = await saveServer({
    hostIp: 'sonarr.test',
    portMap: { '': { host: '127.0.0.1', port: String(catcherPort) } },
  });
  assert.deepEqual(body.withheld.map(w => w.id).sort(), ['app1', 'background', 'w1']);
  const saved = loadConfig();
  assert.ok(!JSON.stringify(saved).includes(SECRET));
  await fetch(`${base}/api/badges`);
  assert.deepEqual(seen, [undefined]);
});

test('an unchanged port map keeps stored credentials', async () => {
  const map = { hostIp: '10.0.0.5', portMap: { 8989: { host: 'sonarr', port: '8989' } } };
  const cfg = loadConfig();
  saveConfig({ ...cfg, settings: { ...cfg.settings, server: map } });
  const body = await saveServer(map);
  assert.equal(body.withheld, undefined);
  assert.ok(JSON.stringify(loadConfig()).includes(SECRET));
});

test('a host address change with no port map keeps stored credentials', async () => {
  const body = await saveServer({ hostIp: '10.0.0.9' });
  assert.equal(body.withheld, undefined);
  assert.equal(loadConfig().settings.background.apiKey, SECRET);
});

test('turning off certificate checking on an app withholds its stored credential', async () => {
  const cfg = await fetch(`${base}/api/config`).then(r => r.json());
  cfg.items[0].skipTlsVerify = true;
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(cfg),
  });
  const body = await res.json();
  assert.deepEqual(
    body.withheld.map(w => w.id),
    ['app1'],
  );
});

test('rewriteChanged', () => {
  const m = { 80: { host: 'a', port: '80' } };
  assert.equal(rewriteChanged({ hostIp: 'x' }, {}), false);
  assert.equal(rewriteChanged({ hostIp: 'x', portMap: m }, { hostIp: 'x', portMap: m }), false);
  assert.equal(rewriteChanged({ hostIp: 'x', portMap: m }, { hostIp: 'x' }), true);
  assert.equal(rewriteChanged({ hostIp: 'y', portMap: m }, { hostIp: 'x', portMap: m }), true);
  assert.equal(
    rewriteChanged({ hostIp: 'x', portMap: { 80: { host: 'b', port: '80' } } }, { hostIp: 'x', portMap: m }),
    true,
  );
});
