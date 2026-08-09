/* Regression test for P6-2: an item with two health checks lost one's detail.

   /api/health answers with `unhealthy` plus whatever explains it: `state` and
   `status` from Docker, `pingStatus` and `pingError` from the URL check. For an
   item configured with both, the ping's result replaced the container's entry
   rather than joining it, so the container detail was discarded.

   `unhealthy` was correct either way, being carried in a local across both
   checks, so nothing looked broken. What was lost is the reason behind a red
   tile, which is now its hover text; see healthReason in ui/js/badge-logic.js. */

const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('health'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');

let server, base, socket, socketBase, target, targetBase;
let containers = [];
let targetStatus = 200;

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  /* Stands in for the Docker socket proxy. */
  socket = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(containers));
  });
  socketBase = await listen(socket);

  /* Stands in for the app being pinged. */
  target = http.createServer((_, res) => {
    res.writeHead(targetStatus);
    res.end();
  });
  targetBase = await listen(target);

  server = http.createServer(dispatch);
  base = await listen(server);
});
after(async () => {
  await close(server);
  await close(socket);
  await close(target);
});

function health() {
  const u = new URL(base + '/api/health');
  return new Promise((resolve, reject) => {
    http
      .request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET' }, res => {
        let b = '';
        res.on('data', c => {
          b += c;
        });
        res.on('end', () => resolve(JSON.parse(b)));
      })
      .on('error', reject)
      .end();
  });
}

function configure(item) {
  saveConfig({
    items: [Object.assign({ id: 'a1', type: 'app', name: 'App' }, item)],
    settings: { server: { socketProxyUrl: socketBase } },
  });
}

test('an item with only a container reports its state', async () => {
  containers = [{ Names: ['/myapp'], State: 'exited', Status: 'Exited (1) 2 hours ago' }];
  configure({ container: 'myapp' });
  const r = (await health()).a1;
  assert.equal(r.unhealthy, true);
  assert.equal(r.state, 'exited');
  assert.equal(r.status, 'Exited (1) 2 hours ago');
});

test('an item with only a ping reports its result', async () => {
  containers = [];
  targetStatus = 503;
  configure({ ping: `${targetBase}/` });
  const r = (await health()).a1;
  assert.equal(r.unhealthy, true);
  assert.equal(r.pingStatus, 503);
});

/* The finding. Both checks configured, and both kinds of detail must survive. */
test('an item with both checks keeps the detail from each', async () => {
  containers = [{ Names: ['/myapp'], State: 'exited', Status: 'Exited (1) 2 hours ago' }];
  targetStatus = 503;
  configure({ container: 'myapp', ping: `${targetBase}/` });

  const r = (await health()).a1;
  assert.equal(r.unhealthy, true);
  assert.equal(r.state, 'exited', 'the container state must not be dropped');
  assert.equal(r.status, 'Exited (1) 2 hours ago');
  assert.equal(r.pingStatus, 503, 'and the ping result must still be there');
});

test('a healthy container and a good ping report healthy', async () => {
  containers = [{ Names: ['/myapp'], State: 'running', Status: 'Up 3 days' }];
  targetStatus = 200;
  configure({ container: 'myapp', ping: `${targetBase}/` });

  const r = (await health()).a1;
  assert.equal(r.unhealthy, false);
  assert.equal(r.state, 'running');
});

/* Either check failing marks the item unhealthy. That was already correct, and
   is the part a reader would most expect a merge to break. */
test('a failing ping still marks a running container unhealthy', async () => {
  containers = [{ Names: ['/myapp'], State: 'running', Status: 'Up 3 days' }];
  targetStatus = 500;
  configure({ container: 'myapp', ping: `${targetBase}/` });
  assert.equal((await health()).a1.unhealthy, true);
});

test('a stopped container still marks the item unhealthy when the ping succeeds', async () => {
  containers = [{ Names: ['/myapp'], State: 'exited', Status: 'Exited (1)' }];
  targetStatus = 200;
  configure({ container: 'myapp', ping: `${targetBase}/` });
  assert.equal((await health()).a1.unhealthy, true);
});

test('a container the proxy does not know about is reported as unknown', async () => {
  containers = [];
  configure({ container: 'myapp' });
  const r = (await health()).a1;
  assert.equal(r.unhealthy, true);
  assert.equal(r.state, 'unknown');
});

/* ── P6-8: the container map answered with inherited properties ──────────────
   The map was an object literal keyed by container name, and looked up by the
   name stored on the item. Every such object already carries "constructor",
   "toString" and the rest, so an item naming one matched a truthy value that is
   not a container entry: `unhealthy` read as undefined, and a container that
   does not exist reported healthy. A null-prototype map has nothing to inherit. */

test('an item naming an inherited member as its container is reported as unknown', async () => {
  containers = [{ Names: ['/myapp'], State: 'running', Status: 'Up 3 days' }];
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    configure({ container: name });
    const r = (await health()).a1;
    assert.equal(r.unhealthy, true, `${name} must not report healthy`);
    assert.equal(r.state, 'unknown', name);
  }
});

/* The same name arriving from the socket proxy has to be a usable entry, not a
   prototype write that silently discards the container. */
test('a container actually named __proto__ is matched, not discarded', async () => {
  containers = [{ Names: ['/__proto__'], State: 'exited', Status: 'Exited (1)' }];
  configure({ container: '__proto__' });
  const r = (await health()).a1;
  assert.equal(r.unhealthy, true);
  assert.equal(r.state, 'exited');
});
