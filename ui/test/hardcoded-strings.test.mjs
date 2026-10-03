/* Every user-facing string must go through the translation system.

   The reachability test cannot see a string that was never made a key: English
   typed straight into an attribute leaves nothing missing from the catalogue.
   This scan reads the absence instead, and finds a literal where a translated
   value belongs. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Attributes a reader is given, and the row label the pencil is named after. */
const PATTERNS = [
  ['aria-label', /aria-label="([^"${}<>]{2,})"/g, /data-i18n-al=/],
  ['placeholder', /placeholder="([^"${}<>]{2,})"/g, /data-i18n-ph=/],
  ['title', /(?<!data-i18n-)title="([^"${}<>]{2,})"/g, /data-i18n-title=/],
  ['row label', /<span\b[^>]*\bclass="(?:[^"]*\s)?rl(?:\s[^"]*)?"[^>]*>([^<${}]{2,})</g, /data-i18n(-html)?=/],
];

const ENGLISH = (() => {
  const out = new Set();
  const walk = o => {
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') walk(v);
      else if (typeof v === 'string') out.add(v);
    }
  };
  walk(JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'en.json'), 'utf8')));
  return out;
})();

/* A literal that is not prose: an example value, a technical token, a brand.
   Each is text no language changes. */
const NOT_PROSE = [
  /^[\d.:/]+$/ /* 192.168.1.100, 2000 */,
  /^https?:\/\//i,
  /^#[0-9a-fA-F]{3,8}$/,
  /^Stackyard\b/,
  /^e\.g\./i,
  /^\(.*\)$/ /* a parenthesised unit beside a translated label */,
];

/* One bare token is an example value only in a placeholder: AGVpqBZnzUE,
   autoplay. An accessible name of one word is still a word, and so is a
   capitalised one in a placeholder. */
const TOKEN = /^[A-Za-z0-9_-]+$/;

/* The whole tag around an attribute, so wiring on a neighbouring element does
   not count. */
const tagAround = (src, at) => {
  const end = src.indexOf('>', at);
  return src.slice(src.lastIndexOf('<', at), end === -1 ? src.length : end + 1);
};

const sources = () => {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (['test', 'i18n', 'node_modules', 'icons', 'widgets'].includes(e.name)) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
  };
  walk('js');
  walk('admin');
  out.push('index.html');
  return out;
};

test('the scan reads the interface source', () => {
  const files = sources();
  assert.ok(files.length > 20, `only ${files.length} files scanned`);
  assert.ok(
    files.some(f => f.endsWith('admin/index.html')),
    'the settings markup is not being scanned',
  );
});

const attributeOffenders = (file, src) => {
  const found = [];
  for (const [what, pattern, wired] of PATTERNS) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(src); m !== null; m = pattern.exec(src)) {
      const value = m[1].trim();
      if (!/[A-Za-z]{2}/.test(value)) continue;
      if (!ENGLISH.has(value) && NOT_PROSE.some(re => re.test(value))) continue;
      if (!ENGLISH.has(value) && what === 'placeholder' && TOKEN.test(value) && !/^[A-Z][a-z]+$/.test(value)) continue;
      /* Already wired: the literal is the English default beside its own key. */
      const scope = tagAround(src, m.index);
      if (wired.test(scope)) continue;
      found.push(`${file}: ${what} "${value}"`);
    }
  }
  return found;
};

test('no user-facing string is written into the source instead of a catalogue', () => {
  const found = sources().flatMap(file => attributeOffenders(file, fs.readFileSync(path.join(root, file), 'utf8')));
  assert.deepEqual(found, [], `English written into the source. Add a key and reference it:\n  ${found.join('\n  ')}`);
});

test('the attribute scan sees a one-word name and wiring for another attribute or element', () => {
  for (const src of [
    '<input aria-label="Filter" data-i18n-ph="k">',
    '<input aria-label="Filter apps" data-i18n-ph="k">',
    '<button aria-label="Close the list"></button><input data-i18n-al="k">',
    '<button title="Refresh"></button>',
    '<input placeholder="Nickname">',
    '<div class="row"><span class="rl">Planted Label</span></div><div class="row"><span class="rl" data-i18n="k">Kept</span></div>',
    '<span class="rl" id="rl-x">Planted Label</span>',
  ]) {
    assert.equal(attributeOffenders('probe.html', src).length, 1, src);
  }
  for (const src of [
    '<input data-i18n-al="k" aria-label="Filter apps">',
    '<input placeholder="AGVpqBZnzUE">',
    '<svg role="img" aria-label="Stackyard"></svg>',
    '<input placeholder="autoplay">',
    '<span class="rl" id="rl-x" data-i18n="k">Kept Label</span>',
  ]) {
    assert.deepEqual(attributeOffenders('probe.html', src), [], src);
  }
});

/* The scan above reads attributes in source text. It cannot see a string
   concatenated or interpolated at run time, such as a translated label with an
   English noun welded onto it. This scan reads the expressions that reach a
   reader. */

/* Where a string becomes something a person reads. */
const SINKS = [
  /setAttribute\(\s*['"](?:aria-label|title|placeholder|alt|aria-description|aria-valuetext)['"]\s*,/g,
  /\.(?:textContent|innerText|title|ariaLabel)\s*=/g,
  /\.dataset\.tileName\s*=/g,
  /\btoast\(/g,
  /\bsetUserText\(\s*[^,]+,/g,
  /* An option a helper renders: { placeholder: '...' }, { label: v || '...' }. */
  /\b(?:placeholder|label|title|ariaLabel|hint|heading|caption)\s*:\s*/g,
];

/* The tone of a toast, at the end of the call. */
const TONE = /,\s*'(?:err|ok|warn|info)'\s*\)\s*;?\s*$/;

/* A literal that is an argument or an operand names a key, an attribute or a
   mode. Only what is concatenated or interpolated becomes text. */
const OPERANDS =
  /\b[A-Za-z_$][\w$]*\(\s*(?:'[^'\\\n]*'|"[^"\\\n]*")\s*[,)]|[=!]==?\s*(?:'[^'\\\n]*'|"[^"\\\n]*")|\?\s*'(?:err|ok|warn|info)'\s*:\s*'(?:err|ok|warn|info)'/g;

const textLiterals = slice => {
  for (let prev = null; prev !== slice; ) {
    prev = slice;
    slice = slice.replace(/\bt\([^()]*\)/g, '');
  }
  const bare = slice.replace(OPERANDS, m => m.replace(/['"][^'"]*['"]/, "''"));
  const out = [];
  for (const m of bare.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`((?:[^`\\])*)`/g)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (raw === undefined) continue;
    for (const piece of raw.split(/\$\{[^}]*\}/)) out.push(piece);
  }
  return out;
};

/* A bare lowercase token with nothing around it is a mode or a flag. A fragment
   with a space beside it was concatenated onto text a person reads. */
const READS_AS_PROSE = v =>
  /[A-Za-z]{2}/.test(v) &&
  !/[<>]/.test(v) &&
  !/="/.test(v) &&
  !/^Stackyard\b/.test(v.trim()) &&
  !/^https?:/i.test(v.trim()) &&
  !(v === v.trim() && /^[a-z][a-z0-9-]*(?:;\s*[a-z][a-z0-9-]*)*$/.test(v)) &&
  !/^[a-z]\w*(?:\.\w+)+$/.test(v) /* a catalogue key */ &&
  !/^#[0-9a-fA-F]{3,8}$/.test(v) &&
  !(/^[A-Za-z0-9_-]+$/.test(v) && /[a-z][A-Z]|[A-Z]{2}/.test(v)) /* an id: AGVpqBZnzUE */;

const runtimeOffenders = (file, src) => {
  const seen = [];
  const code = src.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '));
  for (const line of code.split('\n')) {
    if (/^\s*\/\//.test(line)) continue;
    for (const sink of SINKS) {
      sink.lastIndex = 0;
      for (const m of line.matchAll(sink)) {
        const slice = line.slice(m.index + m[0].length).replace(TONE, '');
        if (slice.includes('html`')) continue;
        for (const v of textLiterals(slice)) {
          if (READS_AS_PROSE(v)) seen.push(`${file}: ${JSON.stringify(v)}`);
        }
      }
    }
  }
  return seen;
};

const runtimeStrings = () =>
  fs
    .readdirSync(path.join(root, 'js'))
    .filter(file => file.endsWith('.js'))
    .sort()
    .flatMap(file => runtimeOffenders(file, fs.readFileSync(path.join(root, 'js', file), 'utf8')));

test('the run-time scan sees English passed as an option', () => {
  for (const src of [
    "  initInlineEdit('ie-x', 'x', { placeholder: 'Paste a collection id here' });",
    "  const opts = { label: v || 'Default value' };",
    "  renderColorControl(slot, { title: 'Pick a colour' });",
  ]) {
    assert.equal(runtimeOffenders('probe.js', src).length, 1, src);
  }
  for (const src of [
    "  initInlineEdit('ie-x', 'x', { placeholder: 'AGVpqBZnzUE' });",
    "  initInlineEdit('ie-x', 'x', { placeholder: 'autoplay; fullscreen' });",
    "  return { title: 'configRecovery.title' };",
    '  /* Names only.\n   `title: 2024` and `title: no` are both real. */',
  ]) {
    assert.deepEqual(runtimeOffenders('probe.js', src), [], src);
  }
});

test('no user-facing string is built at run time instead of translated', () => {
  const found = [...new Set(runtimeStrings())].sort();
  assert.deepEqual(
    found,
    [],
    `English assembled at run time. Add a key and pass it through t():\n  ${found.join('\n  ')}`,
  );
});

/* The builder writes markup from a template literal, so neither scan above sees
   the words inside it. This one reads the text nodes and the named attributes
   of every html`` block, across lines, because those blocks span them. */
const skipString = (src, i) => {
  const q = src[i];
  for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++;
  return i + 1;
};

/* A slash after one of these starts a regex literal, not a division. */
const BEFORE_REGEX = /[(,=:[!&|?{};]/;

const skipRegex = (src, i) => {
  let inClass = false;
  for (i++; i < src.length && src[i] !== '\n'; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '[') inClass = true;
    else if (src[i] === ']') inClass = false;
    else if (src[i] === '/' && !inClass) break;
  }
  return i + 1;
};

/* Reads a template literal from its opening backtick. Returns the text with each
   `${}` hole replaced by a space, the source of each hole, and the index past
   the closing backtick. Holes may hold strings, braces and further template
   literals. */
const readTemplate = (src, i) => {
  let text = '';
  const holes = [];
  for (i++; i < src.length; ) {
    const c = src[i];
    if (c === '\\') {
      text += src.slice(i, i + 2);
      i += 2;
    } else if (c === '`') return { text, holes, end: i + 1 };
    else if (c === '$' && src[i + 1] === '{') {
      text += ' ';
      const from = i + 2;
      let depth = 0;
      let prev = '{';
      for (i += 2; i < src.length; ) {
        const h = src[i];
        if (h === '/' && (src[i + 1] === '*' || src[i + 1] === '/')) {
          const close = src[i + 1] === '*' ? '*/' : '\n';
          const at = src.indexOf(close, i + 2);
          i = at === -1 ? src.length : at + close.length;
          continue;
        }
        if (h === '/' && BEFORE_REGEX.test(prev)) i = skipRegex(src, i);
        else if (h === "'" || h === '"') i = skipString(src, i);
        else if (h === '`') i = readTemplate(src, i).end;
        else if (h === '{') depth++, i++;
        else if (h === '}') {
          i++;
          if (depth-- === 0) break;
        } else i++;
        if (!/\s/.test(h)) prev = h;
      }
      holes.push(src.slice(from, i - 1));
    } else {
      text += c;
      i++;
    }
  }
  return { text, holes, end: i };
};

const htmlBlocks = src =>
  [...src.matchAll(/\bhtml`/g)].map(m => ({ index: m.index, ...readTemplate(src, m.index + 4) }));

/* A literal in a hole, such as `${v || 'Default value'}`. A nested html``
   template is a block of its own and is blanked. The text of any other nested
   template is read with the literals. */
const holeLiterals = hole => {
  let code = hole;
  const nested = [];
  for (let at = code.indexOf('`'); at !== -1; at = code.indexOf('`', at + 1)) {
    const { text, holes, end } = readTemplate(code, at);
    if (!/\bhtml\s*$/.test(code.slice(0, at))) nested.push(text, ...holes.flatMap(holeLiterals));
    code = code.slice(0, at) + ' '.repeat(end - at) + code.slice(end);
  }
  return [...textLiterals(code), ...nested]
    .map(withoutHoles)
    .filter(v => READS_AS_PROSE(v) && (/\s/.test(v) || /^[A-Z][a-z]+$/.test(v)))
    .filter(v => !(/-/.test(v) && /^[a-z0-9-]+(?: [a-z0-9-]+)*$/.test(v)) /* a class list */);
};

const withoutHoles = v => v.replace(/\s+/g, ' ').trim();

/* NOT_PROSE above exempts a bare token, because an attribute value is often
   one. A word on its own in a text node is not, so this scan exempts only a
   unit, a brand and a URL. */
const MARKUP_NOT_PROSE = [/^\([a-z]{1,4}\)$/, /^Stackyard\b/, /^https?:\/\//i, /^[\d.:/]+$/];

test('the markup scan reads literals inside a hole', () => {
  const block = src => htmlBlocks(src).flatMap(b => b.holes.flatMap(holeLiterals));
  assert.deepEqual(block("html`<i>${v || 'Default'}</i>`"), ['Default']);
  assert.deepEqual(block('html`<input placeholder="${p || \'Paste a key\'}">`'), ['Paste a key']);
  assert.deepEqual(block("html`<i class=\"${on ? 'hsb-range hsb-hue' : ''}\">${t('k')}</i>`"), []);
  assert.deepEqual(block("html`<b>${x ? html`<i>${t('k')}</i>` : ''}</b>`"), []);
  assert.deepEqual(block("html`<span>${n ? `${n} apps selected` : t('x')}</span>`"), ['apps selected']);
  assert.deepEqual(block("html`<i class=\"${`tile-opt${on ? ' on' : ''}`}\"></i>`"), []);
});

test('no user-facing string is written into the markup builder', () => {
  const found = [];
  for (const file of fs.readdirSync(path.join(root, 'js')).sort()) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(root, 'js', file), 'utf8');
    const lineOf = at => src.slice(0, at).split('\n').length;
    for (const block of htmlBlocks(src)) {
      const seen = [];
      for (const m of block.text.matchAll(/>([^<>]+)</g)) seen.push(withoutHoles(m[1]));
      for (const m of block.text.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)) seen.push(withoutHoles(m[1]));
      for (const hole of block.holes) seen.push(...holeLiterals(hole));
      for (const value of seen) {
        if (!/[A-Za-z]{2}/.test(value)) continue;
        if (MARKUP_NOT_PROSE.some(re => re.test(value))) continue;
        found.push(`${file}:${lineOf(block.index)}: ${JSON.stringify(value)}`);
      }
    }
  }
  assert.deepEqual(found, [], `English written into markup. Add a key and reference it:\n  ${found.join('\n  ')}`);
});

/* A Settings literal that matches an English catalogue value is a translated
   string typed out again. It shows in English in every language. Dashboard
   modules are left out: they keep English fallbacks for widgets on purpose. */
test('no Settings script repeats an English catalogue string as a literal', () => {
  const found = [];
  for (const file of fs.readdirSync(path.join(root, 'js')).sort()) {
    if (!/^admin.*\.js$/.test(file)) continue;
    const src = fs.readFileSync(path.join(root, 'js', file), 'utf8');
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`$\\\n]*)`/g)) {
      const value = m[1] ?? m[2] ?? m[3];
      if (/[A-Za-z]{2}/.test(value) && ENGLISH.has(value)) found.push(`${file}: ${JSON.stringify(value)}`);
    }
  }
  assert.deepEqual(
    found,
    [],
    `English catalogue text repeated in a script. Use t() with its key:\n  ${found.join('\n  ')}`,
  );
});
