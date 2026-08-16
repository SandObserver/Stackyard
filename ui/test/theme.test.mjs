import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyTheme, normaliseMode, resolveTheme, THEME_KEY, THEME_MODES, themeColor } from '../js/theme.js';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const preload = read('../js/admin-theme.js');
const adminHtml = read('../admin/index.html');
const adminCss = read('../css/admin.css');
const tokensCss = read('../css/tokens.css');

test('an unknown or missing mode falls back to the system', () => {
  for (const value of [null, undefined, '', 'sepia', 'System']) assert.equal(normaliseMode(value), 'system');
  for (const mode of THEME_MODES) assert.equal(normaliseMode(mode), mode);
});

test('an explicit mode ignores the device', () => {
  for (const prefersDark of [true, false]) {
    assert.equal(resolveTheme('light', prefersDark), 'light');
    assert.equal(resolveTheme('dark', prefersDark), 'dark');
  }
});

test('the system mode follows the device', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

/* A value written by a later version, or by hand. Anything unrecognised has to
   land on a theme rather than leave the attribute unset, which paints the light
   markup with no light tokens. */
test('an unrecognised mode still resolves to a theme', () => {
  for (const prefersDark of [true, false]) {
    assert.ok(['light', 'dark'].includes(resolveTheme('sepia', prefersDark)));
  }
});

test('applying a theme writes the attribute and the chrome colour', () => {
  const meta = {
    content: '#0d1117',
    setAttribute(k, v) {
      this[k] = v;
    },
  };
  const root = {
    setAttribute(k, v) {
      this[k] = v;
    },
  };
  const doc = { documentElement: root, querySelector: () => meta };
  applyTheme('light', /** @type {any} */ (doc));
  assert.equal(root['data-theme'], 'light');
  assert.equal(meta.content, themeColor('light'));
  applyTheme('dark', /** @type {any} */ (doc));
  assert.equal(root['data-theme'], 'dark');
  assert.equal(meta.content, themeColor('dark'));
});

/* The preload script cannot import the module, so it repeats what the module
   decides. The two drifting apart shows as a flash of the wrong theme, or as a
   stored choice the preload does not recognise. */
test('the preload script repeats the module exactly', () => {
  assert.ok(preload.includes(`'${THEME_KEY}'`), `admin-theme.js no longer uses the ${THEME_KEY} key`);
  assert.ok(preload.includes(`['${THEME_MODES.join("', '")}']`), 'admin-theme.js no longer lists the same modes');
  assert.ok(preload.includes("'(prefers-color-scheme: dark)'"));
  for (const theme of ['light', 'dark']) assert.ok(preload.includes(`'${themeColor(theme)}'`));
});

test('the preload script is not a module', () => {
  assert.ok(!/\b(import|export)\b/.test(preload));
});

test('admin loads the preload script before its stylesheets', () => {
  const script = adminHtml.indexOf('/js/admin-theme.js');
  const stylesheet = adminHtml.indexOf('rel="stylesheet"');
  assert.ok(script > -1, 'admin/index.html does not load admin-theme.js');
  assert.ok(script < stylesheet);
  assert.ok(!/admin-theme\.js[^>]*\b(defer|async|type="module")/.test(adminHtml));
});

/* The script sets the chrome colour by finding the meta tag, so the tag has to
   be parsed already. */
test('the theme colour meta precedes the preload script', () => {
  assert.ok(adminHtml.indexOf('name="theme-color"') < adminHtml.indexOf('/js/admin-theme.js'));
});

/* The dashboard has one appearance. It never sets the attribute, so a light
   rule reaching its stylesheet would be dead weight nobody can trigger. */
test('only the settings page is themed', () => {
  assert.ok(!read('../index.html').includes('admin-theme.js'));
  assert.ok(!read('../css/dashboard.css').includes('data-theme'));
});

test('both stylesheets select the light theme the same way', () => {
  for (const [name, src] of [
    ['admin.css', adminCss],
    ['tokens.css', tokensCss],
  ]) {
    assert.ok(src.includes('html[data-theme="light"]'), `${name} declares no light values`);
  }
});

/* The palette moves wholesale under increased contrast. A light hue without its
   partner would resolve to the dark theme's raised value. */
test('the light palette carries an increased-contrast partner for every hue', () => {
  const block = tokensCss.slice(tokensCss.indexOf('html[data-theme="light"] {'));
  const light = block.slice(0, block.indexOf('\n}'));
  const hues = [...light.matchAll(/--sy-([a-z]+\d?):\s*#/g)].map(m => m[1]);
  assert.ok(hues.length >= 18, `expected the twelve hues and six greys, found ${hues.length}`);
  for (const h of hues) assert.match(light, new RegExp(`--sy-${h}-hi:\\s*#`), `--sy-${h} has no -hi partner`);
});
