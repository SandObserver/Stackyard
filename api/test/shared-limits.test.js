const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DOCK_MAX } = require('../../ui/js/limits.js');

const ROOT = path.join(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the dock limit is a positive whole number', () => {
  assert.equal(Number.isInteger(DOCK_MAX), true);
  assert.ok(DOCK_MAX > 0);
});

test('no second copy of the dock limit is declared anywhere', () => {
  const ui = fs
    .readdirSync(path.join(ROOT, 'ui/js'))
    .filter(f => f.endsWith('.js') && f !== 'limits.js')
    .map(f => `ui/js/${f}`);
  for (const f of ['api/src/routes/config.js', ...ui]) {
    assert.equal(/(const|let)\s+DOCK_MAX\s*=/.test(read(f)), false, `${f} declares its own DOCK_MAX`);
  }
});

test('the dock renderer and the save check both read the shared limit', () => {
  assert.match(read('ui/js/dashboard-grid.js'), /slice\(0,\s*DOCK_MAX\)/);
  assert.match(read('api/src/routes/config.js'), /length > DOCK_MAX/);
});

test('the image carries the shared limits file', () => {
  assert.match(read('Dockerfile'), /^COPY .*ui\/js\/limits\.js \/app\/ui\/js\/limits\.js$/m);
});
