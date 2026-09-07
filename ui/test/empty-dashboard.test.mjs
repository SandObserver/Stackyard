import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
const { isDashboardEmpty } = await import('../js/utils.js');

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(uiDir, p), 'utf8');

test('a config holding only the system settings item is empty', () => {
  assert.equal(isDashboardEmpty([{ id: 'settings', type: 'app', system: 'settings' }]), true);
});

test('a hidden app does not fill the dashboard', () => {
  assert.equal(
    isDashboardEmpty([
      { id: 'settings', system: 'settings' },
      { id: 'a', type: 'app', hidden: true },
    ]),
    true,
  );
});

test('one visible app fills the dashboard', () => {
  assert.equal(
    isDashboardEmpty([
      { id: 'settings', system: 'settings' },
      { id: 'a', type: 'app' },
    ]),
    false,
  );
});

test('a docked app fills the dashboard', () => {
  assert.equal(isDashboardEmpty([{ id: 'a', type: 'app', dock: true }]), false);
});

test('an absent or empty item list is empty', () => {
  assert.equal(isDashboardEmpty([]), true);
  assert.equal(isDashboardEmpty(undefined), true);
});

test('both layouts render the placard', () => {
  for (const f of ['js/dashboard.js', 'js/ui.js']) assert.match(read(f), /renderEmptyState\(/);
});

test('both layouts hide the dock when nothing is docked', () => {
  for (const f of ['js/dashboard.js', 'js/ui.js']) assert.match(read(f), /dk\.hidden = !dock\.length;/);
});

test('the hidden dock is not painted', () => {
  assert.match(read('css/dashboard.css'), /#dock\[hidden\]\s*\{\s*display:\s*none\s*\}/);
});

test('the placard strings exist in every catalog', () => {
  for (const f of fs.readdirSync(path.join(uiDir, 'i18n'))) {
    const home = JSON.parse(read(path.join('i18n', f))).home;
    for (const k of ['emptyTitle', 'emptyBody', 'emptyAction']) assert.ok(home[k], `${f} is missing home.${k}`);
  }
});

test('the placard carries the app mark without its plate', () => {
  const mark = read('js/brand-mark.js');
  const svg = Buffer.from(mark.split('base64,')[1].split("'")[0], 'base64').toString('utf8');
  assert.equal(svg.includes('<rect'), false);
  assert.match(svg, /#00D2E0/i);
  assert.match(read('js/utils.js'), /BRAND_MARK/);
});

test('both layouts drop the settings tile while the dashboard is empty', () => {
  assert.match(read('js/dashboard.js'), /if \(bare && item\.system\) continue;/);
  assert.match(read('js/ui.js'), /!\(bare && i\.system\)/);
});
