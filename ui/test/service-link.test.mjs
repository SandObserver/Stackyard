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
    'http://localhost.:8080',
    'http://foo.localhost.',
    'http://[::ffff:127.0.0.1]:8080',
    'http://[::ffff:0.0.0.0]',
    'http://[::]:80',
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

test('a Link URL is the base for item pages and is kept as typed without one', async () => {
  const { serviceLink } = await import('../js/service-link.js');
  assert.equal(
    serviceLink('https://plex.example.com/', 'http://plex:32400', '/web/x'),
    'https://plex.example.com/web/x',
  );
  assert.equal(serviceLink('', 'http://10.0.0.5:32400', '/web/x'), 'http://10.0.0.5:32400/web/x');
  assert.equal(serviceLink('', 'http://plex:32400', '/web/x'), '');
  assert.equal(serviceLink('https://example.com/page?a=1', 'http://plex:32400'), 'https://example.com/page?a=1');
  assert.equal(serviceLink('http://nas:32400', 'http://plex:32400', '/web/x'), 'http://nas:32400/web/x');
});

test('a Link URL that points at a page opens that page, never a joined path', async () => {
  const { serviceLink } = await import('../js/service-link.js');
  for (const typed of [
    'http://10.0.0.5:32400/web/index.html#!/',
    'https://app.plex.tv/desktop',
    'http://10.0.0.5:8096/web/index.html',
    'http://10.0.0.5:8200/ngax/index.html',
    'https://example.com/plex/',
    'http://10.0.0.5:8200/?tab=logs',
  ])
    assert.equal(serviceLink(typed, 'http://plex:32400', '/web/index.html#!/server/x'), typed, typed);
});

test('the service base is a typed bare address, or else the reachable server address', async () => {
  const { serviceBase } = await import('../js/service-link.js');
  assert.equal(serviceBase('http://nas:8080/', 'http://plex:32400'), 'http://nas:8080');
  assert.equal(serviceBase('nas.local:8080', ''), 'http://nas.local:8080');
  assert.equal(serviceBase('', 'http://10.0.0.5:32400'), 'http://10.0.0.5:32400');
  assert.equal(serviceBase('', 'http://plex:32400'), '');
  for (const typed of ['https://app.plex.tv/desktop', 'http://u:p@10.0.0.5', 'javascript:alert(1)', 'http://['])
    assert.equal(serviceBase(typed, 'http://10.0.0.5:32400'), '', typed);
});
