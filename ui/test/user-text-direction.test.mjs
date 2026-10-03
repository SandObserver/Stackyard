/* A name the user typed carries its own direction, which is not the
   interface's. A name that inherits the document's direction truncates from the
   wrong end, losing the part that identifies it.

   setUserText sets dir="auto", so each name resolves its own direction from its
   first strong character and clips at its own end.

   This is a ratchet: a render site setting textContent from item.label directly
   reintroduces the defect, so any new one goes through setUserText or is listed
   here. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const JS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

/* An initial for a fallback icon is a single character, so it has no direction
   to get wrong. */
const INITIAL_ONLY = /\binitial\(/;

function offendingLines(file) {
  const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  return src.split('\n').flatMap((line, i) => {
    if (!/\.textContent\s*=/.test(line)) return [];
    /* Only names that came from the user's own config. A manifest's field
       label is translated, so it follows the interface language and must not
       be marked auto-direction. */
    if (!/\b(item|child|app|folder|f)\.label\b/.test(line)) return [];
    if (INITIAL_ONLY.test(line)) return [];
    return [`${file}:${i + 1}: ${line.trim()}`];
  });
}

test('no render site writes a user-supplied name straight to textContent', () => {
  const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  const offenders = files.flatMap(offendingLines);
  assert.deepEqual(offenders, [], 'use setUserText(node, name) so the name keeps its own direction');
});

const USER_LABEL = /\b(?:item|child|app|folder|f|clash|i)\.label\b/;

/* A name passed into a sentence reaches the screen wherever the sentence goes,
   so the call itself is checked, not the line that renders it. */
function unisolatedNames(src, file) {
  const found = [];
  for (const m of src.matchAll(/\bt\(\s*'([^']+)',\s*\{([^}]*)\}/g)) {
    for (const v of m[2].matchAll(/\w+\s*:\s*([^,]+)/g)) {
      const value = v[1].trim();
      if (USER_LABEL.test(value) && !value.startsWith('isolate(')) found.push(`${file}: ${m[1]} ${value}`);
    }
  }
  return found;
}

/* Accessible names only. A screen reader does not draw the sentence, so it has
   no side to clip from. */
const SPOKEN_ONLY = ['ui.js: type.folderNamed f.label'];

test('the sentence check sees a name put into t() and rendered on another line', () => {
  const src = "  const s = t('confirm.deleteFolder', {\n    name: item.label,\n  });\n  lead.textContent = s;\n";
  assert.deepEqual(unisolatedNames(src, 'probe.js'), ['probe.js: confirm.deleteFolder item.label']);
  assert.deepEqual(unisolatedNames("t('k', { name: isolate(item.label || item.id) })", 'probe.js'), []);
});

test('no translated sentence takes a user-supplied name without isolating it', () => {
  const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  const all = files.flatMap(file => unisolatedNames(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), file));
  const offenders = all.filter(o => !SPOKEN_ONLY.includes(o));
  assert.deepEqual(offenders, [], 'wrap the name in isolate() so it keeps its own direction inside the sentence');
  assert.deepEqual(
    SPOKEN_ONLY.filter(o => !all.includes(o)),
    [],
    'a listed exemption no longer exists; remove it',
  );
});

test('setUserText is what the dashboard, folders, search and admin all use', () => {
  /* Named individually so removing the call from one of them fails here rather
     than only showing up as a truncated name in a right-to-left language. */
  for (const file of ['ui.js', 'dashboard.js', 'spotlight.js', 'admin.js', 'admin-settings.js']) {
    const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    assert.match(src, /setUserText/, `${file} should render user-supplied names through setUserText`);
  }
});

/* The isolation belongs on the text, not on the block that holds it. `dir` sets
   alignment as well as bidi, so marking the block drags the row's alignment to
   the other edge. */
test('setUserText isolates the name in a bdi and leaves the block alone', async () => {
  const { setUserText } = await import('../js/utils.js');
  const made = [];
  const node = /** @type {any} */ ({
    textContent: '',
    children: [],
    setAttribute(name, value) {
      made.push(['block', name, value]);
    },
    appendChild(child) {
      this.children.push(child);
      this.textContent = child.textContent;
    },
  });
  globalThis.document = {
    createElement(tag) {
      const el = { tag, textContent: '', setAttribute: (n, v) => made.push([tag, n, v]) };
      return el;
    },
  };
  const returned = setUserText(node, 'Backup and Storage');
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0].tag, 'bdi', 'the name is not isolated');
  assert.equal(node.children[0].textContent, 'Backup and Storage');
  assert.deepEqual(
    made.filter(m => m[0] === 'block'),
    [],
    'the block still carries a direction, which sets its alignment too',
  );
  assert.equal(returned, node, 'returns the node so it can be appended inline');
});

/* Indexing takes one UTF-16 unit, half of an emoji. */
test('no initial is taken by indexing a name', () => {
  const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  const offenders = files.flatMap(file =>
    fs
      .readFileSync(path.join(JS_DIR, file), 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        /\[0\][^\n]*toUpperCase|\.label\b[^\n]*\)\[0\]|\.label\b[^\n]*\.charAt\(0\)/.test(line)
          ? [`${file}:${i + 1}: ${line.trim()}`]
          : [],
      ),
  );
  assert.deepEqual(offenders, [], 'use initial(name)');
});

/* Without isolation the closing bracket of "Media (old)" joins the Persian
   sentence and is drawn on the far side of the name. */
test('a name inside a visible translated sentence is isolated', () => {
  const admin = fs.readFileSync(path.join(JS_DIR, 'admin.js'), 'utf8');
  for (const key of [
    'common.editNamed',
    'confirm.deleteFolder',
    'confirm.remove',
    'folder.moveTo',
    'toast.importIdTaken',
  ]) {
    const call = new RegExp(`t\\('${key.replace('.', '\\.')}', \\{ name: ([^}]+) \\}\\)`).exec(admin);
    assert.ok(call, `${key} is no longer built here`);
    assert.match(call[1], /^isolate\(/, `${key} interpolates a bare name`);
  }
  for (const key of ['toast.importYamlUnsupported', 'toast.importUnknownFormat', 'toast.importTooLarge']) {
    assert.match(
      admin,
      new RegExp(`t\\('${key.replace('.', '\\.')}', \\{ file: isolate\\(file\\.name\\)`),
      `${key} interpolates a bare file name`,
    );
  }
  /* isolate() stringifies, so a missing label would show as "undefined". */
  assert.doesNotMatch(admin, /isolate\((item|clash)\.label\)/, 'a label is optional; fall back to the id');
  const shared = fs.readFileSync(path.join(JS_DIR, 'admin-shared.js'), 'utf8');
  assert.match(
    shared,
    /\.map\(w => w\.label\)\s*\.filter\(Boolean\)\s*\.map\(isolate\)/,
    'withheld item names are not isolated',
  );
  const form = fs.readFileSync(path.join(JS_DIR, 'admin-app-form.js'), 'utf8');
  assert.match(form, /t\('toast\.uploaded', \{ name: isolate\(/);
  const list = fs.readFileSync(path.join(JS_DIR, 'admin-list.js'), 'utf8');
  assert.doesNotMatch(list, /createTextNode\(item\.label\)/, 'the folder row name is a bare text node');
});
