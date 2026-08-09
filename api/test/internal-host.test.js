/* P3-5: "is this host internal" existed twice and the copies disagreed.

   guardSsrf excluded IPv6 literals from the dotless Docker-service-name
   allowance, because a literal is dotless too and is separated only by its
   colons. shouldSkipTls was a bare `!hostname.includes('.')`, so it never got
   that exclusion, and it never stripped the brackets URL leaves on an IPv6
   hostname either. Two consequences, both only reachable with skipTlsVerify on:

     a public IPv6 address such as [2001:4860:4860::8888] counted as a Docker
     service name and had its certificate left unverified

     a private IPv6 address such as [fd00::1] could not match the private-range
     check at all, because isPrivateAddress does not recognise the bracketed
     form, and passed only by the same dotless accident

   The classification is now one definition. The verdict still is not shared:
   guardSsrf lets a service name through and blocks loopback, while the TLS-skip
   check treats both as internal. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldSkipTls, isInternalHost, isDockerServiceName, bareHost } = require('../src/proxy');

const SKIP_ON = { settings: { server: { skipTlsVerify: true } } };
const host = url => new URL(url).hostname;

test('bareHost strips the brackets URL puts round an IPv6 literal', () => {
  assert.equal(bareHost(host('https://[fd00::1]/')), 'fd00::1');
  assert.equal(bareHost(host('https://example.com/')), 'example.com');
  assert.equal(bareHost(undefined), '');
  assert.equal(bareHost(null), '');
});

test('a dotless single-label name is a Docker service name', () => {
  assert.equal(isDockerServiceName('jellyfin'), true);
  assert.equal(isDockerServiceName('nginx-proxy'), true);
});

/* The distinction the TLS-skip copy was missing. */
test('an IPv6 literal is never a Docker service name, however dotless', () => {
  for (const h of ['fd00::1', '2001:4860:4860::8888', '::1', '::']) {
    assert.equal(isDockerServiceName(h), false, h);
  }
});

test('localhost and dotted names are not Docker service names', () => {
  assert.equal(isDockerServiceName('localhost'), false, 'loopback, not a service');
  assert.equal(isDockerServiceName('example.com'), false);
  assert.equal(isDockerServiceName(''), false);
});

test('isInternalHost covers loopback, private addresses and service names', () => {
  for (const url of [
    'https://localhost/',
    'https://myservice/',
    'https://192.168.1.5/',
    'https://10.0.0.1/',
    'https://127.0.0.1/',
    'https://[fd00::1]/',
    'https://[::1]/',
  ]) {
    assert.equal(isInternalHost(host(url)), true, url);
  }
});

test('isInternalHost rejects public hosts, including IPv6 literals', () => {
  for (const url of ['https://example.com/', 'https://8.8.8.8/', 'https://[2001:4860:4860::8888]/']) {
    assert.equal(isInternalHost(host(url)), false, url);
  }
});

/* The finding, at the level it is actually reachable. */
test('a public IPv6 address does not skip TLS verification', () => {
  assert.equal(shouldSkipTls(host('https://[2001:4860:4860::8888]/'), SKIP_ON), false);
  assert.equal(shouldSkipTls(host('https://[2606:4700:4700::1111]/'), SKIP_ON), false);
});

test('a private IPv6 address still skips TLS verification', () => {
  assert.equal(shouldSkipTls(host('https://[fd00::1]/'), SKIP_ON), true);
  assert.equal(shouldSkipTls(host('https://[::1]/'), SKIP_ON), true);
});

test('the internal cases that already worked keep working', () => {
  for (const url of ['https://myservice/', 'https://localhost/', 'https://192.168.1.5/']) {
    assert.equal(shouldSkipTls(host(url), SKIP_ON), true, url);
  }
});

test('a public host never skips TLS verification', () => {
  for (const url of ['https://example.com/', 'https://8.8.8.8/']) {
    assert.equal(shouldSkipTls(host(url), SKIP_ON), false, url);
  }
});

/* The setting gates everything: with it off, nothing skips verification. */
test('nothing skips TLS verification while the setting is off', () => {
  for (const cfg of [
    { settings: {} },
    { settings: { server: {} } },
    { settings: { server: { skipTlsVerify: false } } },
  ]) {
    assert.equal(shouldSkipTls('myservice', cfg), false);
    assert.equal(shouldSkipTls('192.168.1.5', cfg), false);
  }
});
