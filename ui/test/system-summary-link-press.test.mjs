import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../widgets/system-summary/index.html', import.meta.url), 'utf8');

function lift(name, sig) {
  const m = src.match(new RegExp(`function ${name}\\(${sig}\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} is defined in the widget`);
  return new Function(`${m[0]}; return ${name};`)();
}
const pressOpensLink = new Function(
  `${/function pressOpensLink\(el\) \{.*\}/.exec(src)?.[0]}; return pressOpensLink;`,
)();
const holdToShow = lift('holdToShow', 'target, show');

function node(classes = [], parent = null, id = '') {
  const el = {
    parent,
    id,
    classes: new Set(classes),
    classList: { add: c => el.classes.add(c) },
    addEventListener() {},
    closest(sel) {
      const wanted = sel.split(',').map(s => s.trim());
      const hit = n => wanted.some(w => (w[0] === '#' ? n.id === w.slice(1) : n.classes.has(w.slice(1))));
      for (let n = el; n; n = n.parent) if (hit(n)) return n;
      return null;
    },
  };
  return el;
}

test('a press on a row that shows disk sizes does not open the link', () => {
  const body = node();
  const row = node(['row'], body);
  const label = node(['lbl'], row);
  holdToShow(row, () => {});
  assert.equal(pressOpensLink(label), false);
  assert.equal(pressOpensLink(row), false);
});

test('a press on a chart does not open the link', () => {
  assert.equal(pressOpensLink(node([], node(['plot']))), false);
});

test('a press anywhere else opens the link', () => {
  const body = node();
  assert.equal(pressOpensLink(node(['val'], node(['row'], body))), true);
  assert.equal(pressOpensLink(body), true);
});

test('the body click handler opens the link only through that check', () => {
  assert.match(src, /if \(target && pressOpensLink\(e\.target\)\) openUrl\(target\);/);
});

test('a press on the link element is left to the link, so it opens once', () => {
  assert.equal(pressOpensLink(node([], node(), 'ss-link')), false);
});
