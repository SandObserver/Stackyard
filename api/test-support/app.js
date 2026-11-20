const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { before, after } = require('node:test');
const { tmpDir } = require('./tmp');

const SRC = path.join(__dirname, '..', 'src') + path.sep;

/** @type {Set<() => Promise<void>>} */
const open = new Set();

/* Register at module load, not per call. An after() made inside a hook runs
   when that hook ends and closes the server before the tests. */
after(() => Promise.all([...open].map(close => close())));

/** @param {import('node:http').Server} server */
function track(server) {
  const close = () => {
    open.delete(close);
    return new Promise(resolve => {
      if (!server.listening) return resolve(undefined);
      server.closeAllConnections();
      server.close(() => resolve(undefined));
    });
  };
  open.add(close);
  return /** @type {() => Promise<void>} */ (close);
}

/** Boots the API router over real HTTP on 127.0.0.1, port 0. Call it at the
    top of a test file, before anything requires a module under api/src: those
    modules read their paths from the environment once, when first loaded.
    @param {{ env?: Record<string, string>, config?: object, widgetData?: boolean, label?: string }} [opts]
      env: variables set before the app loads; CONFIG_PATH defaults to a fresh
      temporary file. config: written to CONFIG_PATH before the app loads.
      widgetData: also register /api/widget-data/:id. */
function startApp({ env = {}, config, widgetData = false, label = 'app' } = {}) {
  const loaded = Object.keys(require.cache).find(k => k.startsWith(SRC));
  if (loaded)
    throw new Error(
      `startApp() must run before any api/src module is required, but ${path.relative(SRC, loaded)} is already loaded. ` +
        'Move the startApp() call above the other requires.',
    );
  const dir = tmpDir(label);
  const vars = { CONFIG_PATH: path.join(dir, 'apps.json'), ...env };
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  if (config !== undefined) fs.writeFileSync(vars.CONFIG_PATH, JSON.stringify(config));

  require('../src/routes');
  if (widgetData) require('../src/widget-data');
  const { dispatch } = require('../src/router');
  const server = http.createServer(dispatch);
  let port = 0;

  const app = {
    dir,
    server,
    get port() {
      return port;
    },
    get base() {
      return `http://127.0.0.1:${port}`;
    },
    listen: () =>
      new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
          port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
          resolve(app.base);
        });
      }),
    close: track(server),
    request: (method, pathname, opts) => request(app.base, method, pathname, opts),
  };
  before(app.listen);
  return app;
}

/** One request over node:http, so Host can be set. Origin defaults to the
    server's own; pass `origin: null` to send none. An object body is sent as
    JSON; a string or Buffer is sent as given.
    @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, text: string, body: any }>} */
function request(base, method, pathname, { body, headers = {}, cookie, origin = base, host } = {}) {
  const raw = body == null || typeof body === 'string' || Buffer.isBuffer(body);
  const data = body == null ? null : raw ? body : JSON.stringify(body);
  const sent = { ...headers };
  if (origin) sent.Origin = origin;
  if (host) sent.Host = host;
  if (cookie) sent.Cookie = cookie;
  if (data != null) {
    if (!raw && !Object.keys(sent).some(k => k.toLowerCase() === 'content-type'))
      sent['Content-Type'] = 'application/json';
    sent['Content-Length'] = Buffer.byteLength(data);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(pathname, base), { method, headers: sent }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        if (/json/.test(String(res.headers['content-type']))) {
          try {
            parsed = JSON.parse(text);
          } catch {
            /* keep the text */
          }
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, body: parsed });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (data != null) req.write(data);
    req.end();
  });
}

/** A local HTTP server for a test to point the app at. Each request's method,
    url and headers are logged in `requests` before the handler runs.
    @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void} handler
    @returns {Promise<{ url: string, port: number, server: import('node:http').Server, requests: Array<{ method: string, url: string, headers: import('node:http').IncomingHttpHeaders }>, close: () => Promise<void> }>} */
async function fakeUpstream(handler) {
  /** @type {Array<{ method: string, url: string, headers: import('node:http').IncomingHttpHeaders }>} */
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
    handler(req, res);
  });
  const close = track(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  return { url: `http://127.0.0.1:${port}`, port, server, requests, close };
}

module.exports = { startApp, fakeUpstream, request };
