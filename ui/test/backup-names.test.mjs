import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const page = fs.readFileSync(new URL('../widgets/backup/backup.html', import.meta.url), 'utf8');
const source = /function fitName\([\s\S]*?\n\}/.exec(page)?.[0];
const fitNameFor = mobile => new Function('_isMobile', `${source}; return fitName;`)(mobile);

/* A stand-in for the name element: its longest word is `perPx` wide per pixel of font size. */
function nameEl(perPx, clientWidth = 80) {
  const classes = new Set();
  const el = {
    textContent: '',
    dir: '',
    style: { fontSize: '' },
    removeAttribute: name => {
      el[name] = '';
    },
    clientWidth,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
    get scrollWidth() {
      return Math.max(clientWidth, perPx * parseFloat(el.style.fontSize));
    },
    get cut() {
      return classes.has('cut');
    },
  };
  return el;
}

test('a name that fits keeps the layout size', () => {
  const el = nameEl(4);
  fitNameFor(true)(el, 'Photos');
  assert.equal(el.style.fontSize, '15px');
  assert.equal(el.cut, false);
});

test('a long word shrinks until it fits', () => {
  const el = nameEl(6);
  fitNameFor(true)(el, 'Documents');
  assert.equal(el.style.fontSize, '13px');
  assert.equal(el.cut, false);
});

test('a word that does not fit at 11px is cut, never set smaller', () => {
  const el = nameEl(9);
  fitNameFor(true)(el, 'Supercalifragilistic');
  assert.equal(el.style.fontSize, '11px');
  assert.equal(el.cut, true);
});

test('the desktop layout starts at 11px', () => {
  const el = nameEl(4);
  fitNameFor(false)(el, 'Photos');
  assert.equal(el.style.fontSize, '11px');
});

test('a fitted name drops an earlier cut', () => {
  const el = nameEl(9);
  const fit = fitNameFor(true);
  fit(el, 'Supercalifragilistic');
  Object.defineProperty(el, 'scrollWidth', { value: 80 });
  fit(el, 'Photos');
  assert.equal(el.cut, false);
});

test('names never break inside a word', () => {
  for (const rule of page.match(/\.card-(back|front)-name \{[^}]*\}/g))
    assert.doesNotMatch(rule, /word-break|overflow-wrap/);
});

test('a cut name takes its direction from its own text', () => {
  const el = nameEl(9);
  const fit = fitNameFor(false);
  fit(el, 'Nextcloud_production_database');
  assert.equal(el.dir, 'auto');
  Object.defineProperty(el, 'scrollWidth', { value: 80 });
  fit(el, 'Photos');
  assert.equal(el.dir, '');
});

test('an error line is fitted like a name', () => {
  assert.match(page, /if\(bname\) fitName\(bname, line\);/);
});

test('decorative lines start at their left edge in every direction', () => {
  assert.match(page, /ctx\.textAlign = 'left';\n\s*\/\* Small left dash \*\//);
});
