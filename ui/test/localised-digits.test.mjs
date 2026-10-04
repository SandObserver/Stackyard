/* The language setting picks the words and the digits. A browser locale that
   names its own numbering system overrides the digits.

   A number that identifies rather than counts is left alone. So is a number no
   person reads: an SVG coordinate or a CSS length in Persian digits does not
   render. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

async function withLocale(tag, fn, language) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { language: tag }, configurable: true });
  try {
    /* The module caches one formatter, so it has to be re-imported per locale. */
    const mod = await import(`../js/format-number.js?locale=${encodeURIComponent(tag)}&lang=${language ?? ''}`);
    if (language) mod.setNumberLanguage(language);
    return fn(mod);
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
  }
}

test('a Persian locale gets Persian digits', async () => {
  await withLocale('fa-IR', ({ formatNumber }) => {
    assert.equal(formatNumber(3), '۳');
    assert.equal(formatNumber(128), '۱۲۸');
  });
});

/* The same language with a Latin-numeral preference, which choosing digits by
   interface language gets wrong. */
test('a Persian speaker who asks for Latin digits gets them', async () => {
  await withLocale('fa-IR-u-nu-latn', ({ formatNumber }) => {
    assert.equal(formatNumber(128), '128');
  });
});

test('Persian chosen in Stackyard gets Persian digits on an English browser', async () => {
  await withLocale(
    'en-US',
    ({ formatNumber, localiseDigits }) => {
      assert.equal(formatNumber(128), '۱۲۸');
      assert.match(formatNumber(0.5, { style: 'percent' }), /۵۰/);
      assert.equal(localiseDigits('3h'), '۳h');
    },
    'fa',
  );
});

test('English chosen in Stackyard gets Latin digits on a Persian browser', async () => {
  await withLocale('fa-IR', ({ formatNumber }) => assert.equal(formatNumber(128), '128'), 'en');
});

test('a browser locale that names its digits overrides the language', async () => {
  await withLocale('en-US-u-nu-latn', ({ formatNumber }) => assert.equal(formatNumber(128), '128'), 'fa');
});

test('both pages hand the language to the formatter', () => {
  assert.match(read('js/i18n.js'), /setNumberLanguage\(current\);/);
  assert.match(read('js/widget-toolbox.js'), /setNumberLanguage\(_lang\);/);
});

test('the other five languages are unaffected', async () => {
  for (const tag of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'zh-Hans-CN']) {
    await withLocale(tag, ({ formatNumber }) => {
      assert.match(formatNumber(128), /^1.?28$/, `${tag} changed shape`);
    });
  }
});

test('a value that is not a finite number is passed through', async () => {
  await withLocale('fa-IR', ({ formatNumber }) => {
    for (const v of [NaN, Infinity, null, undefined, '99+']) {
      assert.equal(formatNumber(/** @type {any} */ (v)), String(v));
    }
  });
});

test('a runtime with no navigator still formats', async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  delete globalThis.navigator;
  try {
    const { formatNumber } = await import('../js/format-number.js?no-navigator');
    assert.equal(formatNumber(128), '128');
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
  }
});

/* ── where it is and is not applied ───────────────────────────────────────── */

/* badge-logic.js is deliberately import-free, so the formatter is injected the
   way the translator already is. */
test('the badge takes its formatter by injection, not by import', () => {
  const logic = read('js/badge-logic.js');
  assert.doesNotMatch(logic, /^import /m, 'the file must stay import-free');
  assert.match(logic, /format\?: \(value: number\) => string/, 'the option is undeclared');
  assert.match(logic, /typeof format === 'function' \? format : v => String\(v\)/, 'no Latin-digit fallback');
  assert.match(read('js/dashboard.js'), /format: formatNumber/, 'the dashboard passes nothing in');
});

test('widgets take it from the toolbox rather than each inventing one', () => {
  const toolbox = read('js/widget-toolbox.js');
  assert.match(toolbox, /export \{ formatNumber, localiseDigits \}/);
  for (const w of ['dns', 'weather', 'books', 'system-summary', 'disk-health']) {
    const src = read(`widgets/${w}/index.html`);
    assert.match(src, /formatNumber/, `${w} still writes raw digits`);
    assert.match(src, /import \{[^}]*formatNumber[^}]*\} from '\/js\/widget-toolbox/, `${w} does not use the toolbox`);
  }
});

/* toLocaleString with no argument is the same thing until someone passes it a
   language. */
test('no converted widget reaches for toLocaleString on a number', () => {
  for (const w of ['dns', 'weather', 'books', 'system-summary', 'disk-health']) {
    const src = read(`widgets/${w}/index.html`).replace(/new Date\([^)]*\)\.toLocaleString\([^)]*\)/g, '');
    assert.doesNotMatch(src, /\bn\.toLocaleString\(\)/, `${w} formats a number without a locale`);
  }
});

/* A coordinate or a length is not read by a person, and Persian digits in one
   do not render. */
test('geometry is left in Latin digits', () => {
  for (const w of ['dashboard-switch', 'nowplaying']) {
    const src = read(`widgets/${w}/index.html`);
    assert.doesNotMatch(src, /formatNumber/, `${w} localises geometry, which will not render`);
  }
});

/* The pill beside it is already formatted, so a Latin row reads as a mismatch. */
test('the badge popover rows follow the locale', () => {
  const pop = read('js/badge-popover.js');
  assert.match(pop, /import \{ formatNumber \} from '\/js\/format-number\.js/);
  assert.match(pop, /typeof row\.value === 'number' \? formatNumber\(row\.value\)/);
  assert.doesNotMatch(pop, /String\(row\.value\)/);
});

/* t() formats only the count. Another placeholder that holds a number a person
   reads is formatted by the caller. A line number or a port identifies, and is
   not in this list. */
const READ_NUMBERS = ['added', 'updated', 'deleted', 'page', 'total', 'max', 'n', 'apps', 'folders'];

function unformatted(name, src) {
  const out = [];
  for (const m of src.matchAll(/\bt\(\s*'[^']+',\s*\{([^{}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const [k, v] = part.split(':').map(x => x.trim());
      if (READ_NUMBERS.includes(k) && !/^formatNumber\(/.test(v ?? '')) out.push(`${name}: ${part.trim()}`);
    }
  }
  return out;
}

test('the placeholder check flags a number that is not formatted', () => {
  assert.deepEqual(unformatted('x', "t('a', { page: i + 1, total })"), ['x: page: i + 1', 'x: total']);
  assert.deepEqual(unformatted('x', "t('a', { n: formatNumber(n), line: 3 })"), []);
});

test("a number in a translated sentence is in the reader's digits", () => {
  const offenders = fs
    .readdirSync(path.join(root, 'js'))
    .filter(f => f.endsWith('.js'))
    .flatMap(f => unformatted(f, read(`js/${f}`)));
  assert.deepEqual(offenders, []);
});

test("the dock limit in a save error is in the reader's digits", () => {
  assert.match(read('js/admin-shared.js'), /vars\.max = formatNumber\(vars\.max\)/);
});

test("the widget editor numbers its rows and groups in the reader's digits", () => {
  const form = read('js/widget-config-form.js');
  assert.deepEqual(form.match(/\$\{(?!formatNumber\()[^}]*\+ 1\)?\}/g), null);
  assert.equal(form.match(/formatNumber\((?:i|idx) \+ 1\)/g)?.length, 3);
});

test('the wallpaper brightness follows the locale', () => {
  const settings = read('js/admin-settings.js');
  assert.doesNotMatch(settings, /\.toFixed\(/);
  assert.match(settings, /formatNumber\(parseFloat\(v\), \{ minimumFractionDigits: 2, maximumFractionDigits: 2 \}\)/);
});

/* Where a number becomes text a person reads. A sentence from t() is left out:
   t() formats its count. */
const RENDER =
  /\.(?:textContent|innerText|innerHTML)\s*\+?=|setUserText\(|setHtml\(|insertAdjacentHTML\(|setAttribute\(\s*['"](?:aria-label|title|aria-valuetext)['"]/;
const RAW_NUMBER =
  /Math\.(?:round|floor|ceil|trunc)\(|\.toFixed\(|\.toLocaleString\(\s*\)|\.(?:length|size)\b(?!\s*[-*/<>=!?&|)])|\bString\(|[\w$.]+\s*\+\s*1\b(?!\.\d)/;

/* A number joined to text anywhere, not only on the line that renders it: a
   helper returns '12 Mbps' and its caller writes it. A CSS length is not read. */
const NUMBER = String.raw`(?:\.toFixed\([^)]*\)|Math\.(?:round|floor|ceil|trunc)\((?:[^()]|\([^()]*\))*\)|\.length\b|\b\w+\s*\+\s*1\b(?!\.\d))`;
const RECEIVER = String.raw`(?:[\w.$?]|\((?:[^()]|\([^()]*\))*\))*`;
const GLUED = new RegExp(
  String.raw`${NUMBER}\s*\+\s*['"\x60](?!(?:px|deg|em|rem|ms|s|vh|vw|fr|turn)\b|%)|['"\x60]\s*\+\s*(?:Math\.(?:round|floor|ceil|trunc)\(|[\w.$]+\.toFixed\()|\.replace\(\s*['"]\{\w+\}['"]\s*,\s*\(?${RECEIVER}${NUMBER}\)?\s*,?\s*\)`,
);

/* A raw number in a template hole beside words or markup: text built over
   several lines reaches the reader with no sink on the same line. */
const IN_HOLE = String.raw`\$\{\s*${RECEIVER}${NUMBER}\s*\}`;
const HOLE = new RegExp(String.raw`(?:>|\p{L}{2}\s+)\s*${IN_HOLE}|${IN_HOLE}(?=\s*<|\s+\p{L}{2})`, 'u');

/* The line with every t(), wt(), formatNumber() and localiseDigits() call
   removed, parentheses balanced. */
function withoutSentences(line) {
  let out = '';
  for (let i = 0; i < line.length; ) {
    const call = /^\b(?:w?t|formatNumber|localiseDigits)\(/.exec(line.slice(i));
    if (!call || /[\w$.]/.test(line[i - 1] ?? '')) {
      out += line[i++];
      continue;
    }
    let depth = 0;
    for (i += call[0].length - 1; i < line.length; i++) {
      if (line[i] === '(') depth++;
      else if (line[i] === ')' && --depth === 0) break;
    }
    i++;
  }
  return out;
}

const READ_ATTR = /(?<![\w-])(?:aria-label|aria-valuetext|title|alt|placeholder)=(?:"[^"]*"|'[^']*')/g;

/* A statement runs on while a parenthesis, bracket or template literal is open,
   or while a line ends, or the next one starts, with an operator: the formatter
   splits a long statement there. A brace opens a block, which ends it. */
const OPEN_END = /(?:[=(,[+?:]|\|\||&&)\s*$/;
const GOES_ON = /^\s*(?:[.?:+)\]]|\|\||&&)/;
const CLOSES = { ')': '(', ']': '[', '}': '{' };

/** Track open brackets and template literals through one line. Quotes and line
    comments end with the line. */
function scan(line, stack) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const top = stack[stack.length - 1];
    if (c === '\\') i++;
    else if (quote) {
      if (c === quote) quote = '';
    } else if (top === '`') {
      if (c === '`') stack.pop();
      else if (c === '$' && line[i + 1] === '{') stack.push('${'), i++;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '/' && line[i + 1] === '/') break;
    else if (c === '`' || c === '(' || c === '[' || c === '{') stack.push(c);
    else if (c === '}' && top === '${') stack.pop();
    else if (CLOSES[c] && top === CLOSES[c]) stack.pop();
  }
}

function statements(src) {
  const out = [];
  let stack = [];
  src.split('\n').forEach((line, i) => {
    const last = out[out.length - 1];
    if (/^\S/.test(line) && stack[stack.length - 1] !== '`') stack = [];
    const inner = stack[stack.length - 1];
    const open =
      last &&
      (inner === '(' ||
        inner === '[' ||
        inner === '`' ||
        OPEN_END.test(last.lines[last.lines.length - 1]) ||
        GOES_ON.test(line));
    if (open && last.lines.length < 40) last.lines.push(line.trim());
    else out.push({ at: i + 1, lines: [line] });
    scan(line, stack);
  });
  return out;
}

function latinDigits(src, file) {
  return statements(src).flatMap(({ at, lines }) => {
    const text = lines.join(' ');
    const code = withoutSentences(text);
    /* Markup on a later line keeps only the attributes a reader hears. The
       rest are geometry or state. */
    const heard = l => l.replace(/<[a-z][^<>]*>/gi, tag => (tag.match(READ_ATTR) || []).join(' '));
    const sunk = withoutSentences([lines[0], heard(lines.slice(1).join(' '))].join(' '));
    const raw = (RENDER.test(text) && RAW_NUMBER.test(sunk)) || GLUED.test(code) || HOLE.test(code);
    return raw ? [`${file}:${at}: ${text.trim()}`] : [];
  });
}

test('the digit check sees a count, a rounded value and a fixed decimal', () => {
  for (const line of [
    'h.textContent = `${heading} (${rows.length})`;',
    'if (u) u.textContent = Math.round(pd.totalGb);',
    "el.textContent = val.toFixed(1) + '°';",
    "el.setAttribute('aria-label', String(n));",
    "live.textContent = cur.length + ' ' + t('home.results');",
    "  return v >= 1000 ? (v/1000).toFixed(1)+' Gbps' : Math.round(v)+' Mbps';",
    "  l = Math.round(abs/60)+'m';",
    'setHtml(el, html`<b>${Math.round(v)} items</b>`);',
    'el.textContent = `${formatNumber(x)} of ${Math.round(v)}`;',
    'node.innerHTML = `<span>${n.toFixed(1)}</span>`;',
    '      <span class="n">${rows.length}</span>',
    '    ${Math.round(gb)} GB free',
    '    <b>${(v / 1000).toFixed(1)}</b>',
    '    ${(v / 1000).toFixed(1)} Gbps',
    '    <b>${Object.keys(x).length}</b>',
    '    <b>${x?.length}</b>',
    '  return `Up ${Math.round(v)}`;',
    'el.innerHTML += Math.round(v);',
    'num.textContent = i + 1;',
    '    <span class="n">${i + 1}</span>',
    '    Disk ${idx + 1} of',
    "        `${wt('ui.bay','Bay {n}').replace('{n}', i+1)}: ${wt('ui.notReporting','Not reporting')}`);",
    "  .replace('{n}', rows.length);",
    "  .replace('{n}', t.toFixed(0));",
    "  .replace('{n}', (i + 1));",
    'num.textContent =\n  i + 1;',
    "x = wt('ui.bay', 'Bay {n}').replace(\n  '{n}',\n  rows.length,\n);",
    'b.innerHTML =\n  `<button aria-label="${rows.length}"></button>`;',
    'setHtml(\n  el,\n  html`<span title="${Math.round(v)}">x</span>`,\n);',
    'num.textContent =\n  n > 0\n    ? n.toFixed(1)\n    : "-";',
    'el.textContent =\n  label ||\n  rows.length;',
    'el.textContent =\n  rows\n    .length;',
    'el.textContent = `${heading}\n  (${rows.length})`;',
    'setHtml(\n  el,\n  html`<span\n    title="${Math.round(v)}">x</span>`,\n);',
    "b.innerHTML =\n  `<button aria-label='${rows.length}'></button>`;",
    'b.innerHTML =\n  `<input placeholder="${rows.length}">`;',
  ]) {
    assert.equal(latinDigits(line, 'probe.js').length, 1, line);
  }
  for (const line of [
    "lead.textContent = t('import.confirm', { count: d.items.length });",
    "mt.textContent = t('folder.appsCount', { count: (item.children || []).length });",
    'h.textContent = `${heading} (${formatNumber(rows.length)})`;',
    "if (rows.length) el.setAttribute('aria-label', label);",
    "p.style.top = Math.round(top) + 'px';",
    "fill.style.width = Math.round(b.progress * 100) + '%';",
    'el.textContent = formatNumber(Math.round(v));',
    'num.textContent = formatNumber(i + 1);',
    "        `${wt('ui.bay','Bay {n}').replace('{n}', formatNumber(i + 1))}: ${shortName(d)}`);",
    'setHtml(el, html`<b>${formatNumber(rows.length)}</b>`);',
    'return `hsl(${Math.round(hue)},${sat}%,${light}%)`;',
    "vp.setAttribute('content', `width=${Math.round(iw / 3)},initial-scale=1`);",
    'bar.style.width = `${Math.round(p)}%`;',
    'd += `M ${Math.round(x)} ${Math.round(y)}`;',
    "g.setAttribute('transform', `translate(${(w / 2).toFixed(1)} 0)`);",
    "x = wt('ui.bay', 'Bay {n}').replace(\n  '{n}',\n  formatNumber(rows.length),\n);",
    'a.innerHTML =\n  `<rect x="${(cx - 2).toFixed(1)}" aria-pressed="${String(on)}"/>`;',
    'a.innerHTML =\n  `<rect\n    x="${(cx - 2).toFixed(1)}"/>`;',
    'a.innerHTML =\n  `<rect data-title="${(cx - 2).toFixed(1)}"/>`;',
    "items.forEach((it, i) => {\n  it.style.top = Math.round(i * h) + 'px';\n});",
  ]) {
    assert.deepEqual(latinDigits(line, 'probe.js'), [], line);
  }
});

test('no interface module or widget writes a number in Latin digits', () => {
  const files = fs
    .readdirSync(path.join(root, 'js'))
    .filter(f => f.endsWith('.js'))
    .map(f => `js/${f}`);
  for (const d of fs.readdirSync(path.join(root, 'widgets'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(root, 'widgets', d.name))) {
      if (/\.(js|html)$/.test(f)) files.push(`widgets/${d.name}/${f}`);
    }
  }
  const found = files.flatMap(f => latinDigits(read(f), f));
  assert.deepEqual(found, [], `format it with formatNumber():\n  ${found.join('\n  ')}`);
});

test('every Backup age is in the reader digits, including the youngest', async () => {
  const src = read('widgets/backup/backup.html');
  const fn = name => {
    const at = src.indexOf(`function ${name}(`);
    return src.slice(at, src.indexOf('\n}\n', at) + 2);
  };
  await withLocale('fa-IR', ({ formatNumber }) => {
    const relTime = new Function('formatNumber', `${fn('parseDate')}${fn('relTime')}return relTime;`)(formatNumber);
    for (const seconds of [30, 600, 5 * 3600, 3 * 86400]) {
      const age = relTime(new Date(Date.now() - seconds * 1000).toISOString());
      assert.doesNotMatch(age, /[0-9]/, `${seconds} s reads ${age}`);
    }
  });
});
