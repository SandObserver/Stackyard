/* The README tells a reader what installing to the home screen gives them, and
   that there is no offline mode. Nothing serves an offline experience today:
   there is no service worker. If one is ever added, that sentence stops being
   true, and prose is the part nobody re-reads. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function hasServiceWorker() {
  const files = [];
  const walk = dir => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(path.join(root, 'ui'));
  return files.some(
    f => /(^|\/)(sw|service-worker)\.js$/.test(f) || /serviceWorker\s*\.\s*register/.test(fs.readFileSync(f, 'utf8')),
  );
}

test('the README claim about offline support matches what ships', () => {
  const readme = read('README.md');
  if (hasServiceWorker()) {
    assert.ok(!/no offline mode/i.test(readme), 'a service worker ships now; the README still says there is none');
  } else {
    assert.match(readme, /no offline mode/i, 'nothing provides offline support, and the README should say so');
  }
});

test('the manifest still declares the standalone display the README describes', () => {
  const manifest = JSON.parse(read('ui/manifest.json'));
  assert.equal(manifest.display, 'standalone');
  assert.match(read('README.md'), /own window/);
});
