/* Do not use dns.lookup here. It runs on libuv's 4 worker threads and cannot
   be cancelled. 4 lookups stuck on a dead DNS server block every lookup in the
   process. */

const dns = require('node:dns');
const fs = require('node:fs');
const net = require('node:net');

const HOSTS_FILE = '/etc/hosts';

const NO_ANSWER = new Set([dns.TIMEOUT, dns.CANCELLED]);
const SERVER_FAILED = new Set([dns.CONNREFUSED, dns.SERVFAIL, dns.REFUSED]);
const NO_RECORD = new Set([dns.NOTFOUND, dns.NODATA]);

/** @typedef {{ address: string, family: number }} Address */

/** @param {string} name @param {string} text @returns {Address[]} */
function fromHosts(name, text) {
  const want = name.toLowerCase();
  const out = [];
  for (const line of text.split('\n')) {
    const [address, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    const family = net.isIP(address);
    if (family && names.some(n => n.toLowerCase() === want)) out.push({ address, family });
  }
  if (!out.length && want === 'localhost') out.push({ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 });
  return out;
}

function hostsText() {
  try {
    return fs.readFileSync(HOSTS_FILE, 'utf8');
  } catch {
    return '';
  }
}

const failed = (code, host) => Object.assign(new Error(`${code} ${host}`), { code, hostname: host });

/** Every address for `host`, IPv4 first. Rejects within `ms`.
    @param {string} host @param {number} ms @param {{ servers?: string[] }} [opts]
    @returns {Promise<Address[]>} */
async function resolveAll(host, ms, opts = {}) {
  const family = net.isIP(host);
  if (family) return [{ address: host, family }];
  const listed = fromHosts(host, hostsText());
  if (listed.length) return listed;

  const resolver = new dns.promises.Resolver({ timeout: Math.max(1, ms), tries: 1 });
  if (opts.servers) resolver.setServers(opts.servers);
  const timer = setTimeout(() => resolver.cancel(), ms);
  let results;
  try {
    results = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
  } finally {
    clearTimeout(timer);
  }
  const out = [];
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') for (const address of r.value) out.push({ address, family: i ? 6 : 4 });
  }
  if (out.length) return out;

  const codes = results.map(r => /** @type {any} */ (r.status === 'rejected' && r.reason)?.code);
  if (codes.some(c => NO_ANSWER.has(c))) throw new Error('Timed out');
  if (codes.some(c => SERVER_FAILED.has(c))) throw failed('EAI_AGAIN', host);
  if (codes.every(c => NO_RECORD.has(c))) return lookupFallback(host, ms);
  throw failed('ENOTFOUND', host);
}

/* Call this only after a DNS server answered that the name does not exist. On
   a dead DNS server it blocks a worker thread. */
function lookupFallback(host, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    dns.promises.lookup(host, { all: true }).then(
      list => {
        clearTimeout(timer);
        resolve(list);
      },
      () => {
        clearTimeout(timer);
        reject(failed('ENOTFOUND', host));
      },
    );
  });
}

/** The first address for `host`, in the shape of dns.promises.lookup.
    @param {string} host @param {number} ms @returns {Promise<Address>} */
async function resolveHost(host, ms) {
  return (await resolveAll(host, ms))[0];
}

/** A `lookup` option for http.request, bounded by `ms`.
    @param {number} ms */
function lookupWithin(ms) {
  return (host, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const o = typeof options === 'object' && options ? options : {};
    resolveAll(host, ms).then(
      list => {
        const wanted = o.family === 4 || o.family === 6 ? list.filter(a => a.family === o.family) : list;
        if (!wanted.length) return cb(failed('ENOTFOUND', host));
        if (o.all) return cb(null, wanted);
        cb(null, wanted[0].address, wanted[0].family);
      },
      e => cb(e),
    );
  };
}

module.exports = { resolveAll, resolveHost, lookupWithin, fromHosts };
