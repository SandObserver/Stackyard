const resolver = require('../src/resolve');

/** Answers every name lookup in this test with "not found", so the test never
    waits on a real DNS server. @param {import('node:test').TestContext} t */
function noSuchHost(t) {
  const notFound = async host => {
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND', hostname: host });
  };
  t.mock.method(resolver, 'resolveAll', notFound);
  t.mock.method(resolver, 'resolveHost', notFound);
  t.mock.method(resolver, 'lookupWithin', () => (host, options, callback) => {
    notFound(host).catch(e => resolver.lookupFrom(e)(host, options, callback));
  });
}

module.exports = { noSuchHost };
