const { fakeUpstream } = require('./app');

/* A local Glances answering `/<host>/api/<version>/<plugin>` with JSON, as
   Glances does. Each host path sets which API versions it serves. */
async function glancesStub(plugins) {
  const hosts = new Map();
  const {
    url: origin,
    requests,
    close,
  } = await fakeUpstream((req, res) => {
    const m = /^\/([\w-]+)\/api\/(\d)\/(\w+)$/.exec(req.url);
    const host = m && hosts.get(m[1]);
    if (!host || !host.serves.includes(Number(m[2])) || !(m[3] in plugins)) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      return res.end('<h1>Not Found</h1>');
    }
    if (host.unauthorized) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      return res.end('Unauthorized');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(plugins[m[3]]));
  });
  return {
    get urls() {
      return requests.map(r => r.url);
    },
    get headers() {
      return requests.map(r => r.headers);
    },
    url(host, { serves = [4], unauthorized = false } = {}) {
      hosts.set(host, { serves, unauthorized });
      return `${origin}/${host}`;
    },
    close,
  };
}

module.exports = { glancesStub };
