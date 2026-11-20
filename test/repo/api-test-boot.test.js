const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '../../api/test');

/* Files that still boot the router by hand. Remove a name once its file uses
   startApp(). Never add one. */
const NOT_MOVED = [
  'icon-cdn-cache.test.js',
  'icon-upload-name.test.js',
  'link-url.test.js',
  'login-busy-refund.test.js',
  'login-hardening.test.js',
  'login-rehash-race.test.js',
  'password-hash-format.test.js',
  'percent-decode.test.js',
  'router-literal-path.test.js',
  'toggle-password-race.test.js',
  'version-route.test.js',
  'wallpaper-store.test.js',
  'wallpaper-unsplash.test.js',
  'widget-rejections.test.js',
];

const bootsByHand = name => /createServer\(\s*dispatch\b/.test(fs.readFileSync(path.join(DIR, name), 'utf8'));
const testFiles = () => fs.readdirSync(DIR).filter(n => n.endsWith('.test.js'));

test('a new api test boots the app with startApp()', () => {
  const extra = testFiles().filter(n => bootsByHand(n) && !NOT_MOVED.includes(n));
  assert.deepEqual(
    extra,
    [],
    `${extra.join(', ')} call createServer(dispatch). Use startApp() from api/test-support/app.js instead: ` +
      'const app = startApp({ env }) at the top of the file, then app.base or app.request(). Use fakeUpstream() for a stand-in server.',
  );
});

test('the list of files not yet moved only shrinks', () => {
  const moved = NOT_MOVED.filter(n => !fs.existsSync(path.join(DIR, n)) || !bootsByHand(n));
  assert.deepEqual(moved, [], `${moved.join(', ')} no longer boot the router by hand. Remove them from NOT_MOVED.`);
  assert.deepEqual(NOT_MOVED, [...NOT_MOVED].sort(), 'keep NOT_MOVED sorted');
});
