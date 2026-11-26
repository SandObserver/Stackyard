/* API codes for Node's network and TLS error names. The code reaches the
   browser, which translates it. Never send Node's name there. */
const NET_CODES = Object.freeze({
  ECONNREFUSED: 'network.refused',
  ENOTFOUND: 'network.not-found',
  EAI_AGAIN: 'network.not-found',
  EHOSTUNREACH: 'network.unreachable',
  ENETUNREACH: 'network.unreachable',
  ECONNRESET: 'network.reset',
  EPROTO: 'network.not-http',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'network.self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'network.self-signed',
  CERT_HAS_EXPIRED: 'network.tls-expired',
});

module.exports = { NET_CODES };
