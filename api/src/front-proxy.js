/* Headers the container's own nginx sets on every API request. Read them only
   from a loopback peer: anything else did not come through that nginx, and a
   client could have written them. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** @param {import('http').IncomingMessage} req */
function viaOwnNginx(req) {
  return LOOPBACK.has(req.socket?.remoteAddress || '');
}

/** @param {import('http').IncomingMessage} req */
function proxied(req) {
  return viaOwnNginx(req) && req.headers['x-stackyard-proxied'] === '1';
}

/** @param {import('http').IncomingMessage} req */
function trustedProxyHttps(req) {
  return viaOwnNginx(req) && req.headers['x-stackyard-https'] === '1';
}

module.exports = { LOOPBACK, viaOwnNginx, proxied, trustedProxyHttps };
