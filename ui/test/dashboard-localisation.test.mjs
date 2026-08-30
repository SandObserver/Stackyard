/* Regression tests for P12-1: dashboard text was always English.

   Stackyard ships six languages, and some dashboard text ignored that. The
   sharpest case was the status announcements: someone using it in Persian heard
   English from a screen reader, with no way to see the visual state instead. The
   widest was the first-run password prompt, which is the first thing a new user
   meets.

   badge-logic.js takes a translator rather than importing one. It is a pure
   module, no imports and no module state, which is what lets it be tested
   directly and reused; importing the i18n loader would tie every caller to it.
   Anything that passes nothing gets readable English, so a missing translator
   is a degraded label rather than a raw key on screen. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const locales = () => fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json'));

const { healthReason, computeBadgeVisual } = await import('../js/badge-logic.js');

/* Stands in for the real t: looks a key up in a locale and fills placeholders,
   which is what the i18n module does. */
const translatorFor = file => {
  const cat = JSON.parse(read(`i18n/${file}`));
  return (key, vars) => {
    const [section, name] = key.split('.');
    const s = cat[section]?.[name] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
  };
};

/* ── the strings are translated ───────────────────────────────────────────── */

test('every locale carries the status strings', () => {
  const needed = [
    'needsAttention',
    'healthy',
    'pending',
    'stale',
    'containerNotFound',
    'containerState',
    'pingFailed',
    'pingReturned',
  ];
  for (const file of locales()) {
    const cat = JSON.parse(read(`i18n/${file}`));
    for (const key of needed) assert.ok(cat.status?.[key], `${file} is missing status.${key}`);
  }
});

test('every locale carries the first-run prompt', () => {
  for (const file of locales()) {
    const cat = JSON.parse(read(`i18n/${file}`));
    for (const key of ['title', 'sub', 'newPassword', 'skip', 'set', 'failed']) {
      assert.ok(cat.setup?.[key], `${file} is missing setup.${key}`);
    }
  }
});

test('every locale carries the API-unreachable message', () => {
  for (const file of locales()) {
    const cat = JSON.parse(read(`i18n/${file}`));
    for (const key of ['apiDownTitle', 'apiDownSub', 'retry']) {
      assert.ok(cat.home?.[key], `${file} is missing home.${key}`);
    }
  }
});

/* A translation that loses a placeholder produces a message with a hole in it. */
test('no translation drops a placeholder', () => {
  const withVars = {
    'status.pending': ['count'],
    'status.containerState': ['state'],
    'status.pingFailed': ['error'],
    'status.pingReturned': ['status'],
  };
  for (const file of locales()) {
    const cat = JSON.parse(read(`i18n/${file}`));
    for (const [key, vars] of Object.entries(withVars)) {
      const [section, name] = key.split('.');
      for (const v of vars) {
        assert.ok(cat[section][name].includes(`{${v}}`), `${file}: ${key} drops {${v}}`);
      }
    }
  }
});

/* Non-Latin scripts are where a mistaken copy-paste of English shows up. */
test('the translations are not all copies of the English', () => {
  const en = JSON.parse(read('i18n/en.json'));
  for (const file of locales().filter(f => f !== 'en.json')) {
    const cat = JSON.parse(read(`i18n/${file}`));
    const same = ['needsAttention', 'healthy', 'containerNotFound'].filter(k => cat.status[k] === en.status[k]);
    assert.equal(same.length, 0, `${file} left ${same.join(', ')} in English`);
  }
});

/* ── the code uses them ───────────────────────────────────────────────────── */

test('a status announcement follows the translator', () => {
  const fa = translatorFor('fa.json');
  const v = computeBadgeVisual({ health: 1, activity: 0, hasHC: true, translate: fa });
  assert.equal(v.aria, fa('status.needsAttention'));
  assert.doesNotMatch(v.aria, /Status:/, 'the English was hardcoded');
});

test('a healthy announcement follows the translator', () => {
  const de = translatorFor('de.json');
  const v = computeBadgeVisual({ health: 0, activity: 0, hasHC: true, hideHealthy: false, translate: de });
  assert.equal(v.aria, de('status.healthy'));
});

test('a pending count keeps its number and unit', () => {
  const es = translatorFor('es.json');
  const v = computeBadgeVisual({ health: 0, activity: 7, hasHC: true, custom: { unit: 'GB' }, translate: es });
  assert.match(v.aria, /7 GB/, 'the count must survive translation');
});

test('the stale note is translated', () => {
  const fr = translatorFor('fr.json');
  const v = computeBadgeVisual({ health: 1, activity: 0, hasHC: true, healthStale: true, translate: fr });
  assert.ok(v.aria.includes(fr('status.stale')));
  assert.doesNotMatch(v.aria, /out of date/);
});

test('the reason a tile is red is translated', () => {
  const zh = translatorFor('zh-Hans.json');
  assert.equal(healthReason({ state: 'unknown' }, zh), zh('status.containerNotFound'));
  assert.match(healthReason({ pingStatus: 503 }, zh), /503/, 'the status code must survive');
});

/* Docker's own text comes from the daemon, so inventing a translation for
   "Exited (1) 2 hours ago" would be guessing at a string this code never
   produces. */
test("Docker's own status text is passed through untranslated", () => {
  const fa = translatorFor('fa.json');
  assert.equal(healthReason({ state: 'exited', status: 'Exited (1) 2 hours ago' }, fa), 'Exited (1) 2 hours ago');
});

/* ── the fallback ─────────────────────────────────────────────────────────── */

/* Without it a caller that passes nothing would put raw keys on screen. */
test('no translator gives readable English, not a key', () => {
  assert.equal(healthReason({ state: 'unknown' }), 'Container not found');
  assert.equal(computeBadgeVisual({ health: 1, activity: 0, hasHC: true }).aria, 'Status: needs attention');
  assert.match(computeBadgeVisual({ health: 0, activity: 3, hasHC: true }).aria, /^3 pending$/);
});

test('the fallback matches the English locale exactly', () => {
  /* Two copies of the English, so they must agree or one will drift. */
  const en = JSON.parse(read('i18n/en.json'));
  const src = read('js/badge-logic.js');
  const table = src.slice(src.indexOf('const EN = {'), src.indexOf('};', src.indexOf('const EN = {')));
  for (const [key, value] of Object.entries(en.status)) {
    if (key === 'diskHealth') continue; /* not used by this module */
    assert.ok(table.includes(`'${value}'`), `the fallback disagrees with en.json for status.${key}`);
  }
});

/* ── the module stays pure ────────────────────────────────────────────────── */

test('badge-logic imports nothing', () => {
  /* Importing the i18n loader would tie every caller to it and to whatever it
     has loaded, which is why the translator is handed in. */
  assert.doesNotMatch(read('js/badge-logic.js'), /^import /m);
});

test('the dashboard hands the translator in', () => {
  assert.match(read('js/dashboard.js'), /translate: t,/);
});

/* ── nothing user-facing is left hardcoded ────────────────────────────────── */

test('the first-run prompt and API error are translated', () => {
  const src = read('js/dashboard.js');
  for (const gone of [
    'Set a dashboard password?',
    'Could not connect to dashboard API',
    'Make sure the API container is running',
    'Could not set password.',
  ]) {
    assert.ok(!src.includes(`>${gone}<`) && !src.includes(`'${gone}'`), `"${gone}" is still hardcoded`);
  }
  for (const key of ['setup.title', 'setup.sub', 'home.apiDownTitle', 'home.retry']) {
    assert.ok(src.includes(key), `${key} is not used`);
  }
});

/* An app's name is user text, so its language can differ from the interface
   language. Without a direction of its own the block's direction decides which
   end is cut, and a Latin name on a right-to-left dashboard lost its beginning:
   "Backup and Storage" read "...ckup and St".

   unicode-bidi:plaintext fixes it in Blink and does nothing in WebKit, so the
   attribute is what the label carries. It is safe here only because these labels
   are centred: dir sets alignment too, which moves a name off its own icon. */
test('every tile label carries its own direction', () => {
  const ui = read('js/ui.js');
  const dashboard = read('js/dashboard.js');
  for (const [src, name] of [
    [ui, 'ui.js'],
    [dashboard, 'dashboard.js'],
  ]) {
    for (const m of src.matchAll(
      /className = '(ilabel|dyn-mob-label|dyn-fold-label|dyn-fold-inner-label)';\n(\s*)(.*)/g,
    )) {
      assert.match(m[3], /^l\.dir = 'auto';$/, `${name}: .${m[1]} is cut by the page direction`);
    }
  }
});

test('the labels the direction is set on are centred', () => {
  const css = read('css/dashboard.css');
  for (const cls of ['ilabel', 'dyn-mob-label', 'dyn-fold-label', 'dyn-fold-inner-label']) {
    const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      m => new RegExp(`\\.${cls}\\s*[,{]|\\.${cls}$`).test(m[1].trim()) && m[2].includes('text-overflow'),
    );
    assert.ok(rule, `no truncating rule for .${cls}`);
    assert.match(rule[2], /text-align:center/, `.${cls} is not centred, so dir would move it`);
  }
});
