import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserLink } from '../js/service-link.js';

test('a LAN address or a domain becomes a link', () => {
  assert.equal(browserLink('http://10.0.0.100:8200'), 'http://10.0.0.100:8200');
  assert.equal(browserLink('10.0.0.100:8200/'), 'http://10.0.0.100:8200');
  assert.equal(browserLink('https://adguard.example.com/'), 'https://adguard.example.com');
  assert.equal(browserLink('http://nas.local:8080/sub/'), 'http://nas.local:8080/sub');
  assert.equal(browserLink('http://[fd00::5]:8000'), 'http://[fd00::5]:8000');
});

test('an address only the server can reach gives no link', () => {
  for (const raw of [
    'http://duplicati:8200',
    'gluetun:8000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://[::1]:80',
    'http://host.docker.internal:9000',
    '',
    null,
    'ftp://10.0.0.1',
    'not a url at all',
  ])
    assert.equal(browserLink(raw), '', String(raw));
});

test('credentials, query and fragment never reach the link', () => {
  assert.equal(browserLink('http://admin:pw@10.0.0.5:3000/?apikey=s3cret#x'), 'http://10.0.0.5:3000');
});
