/* The language setting picks the words and the locale picks the digits. Neither
   Arabic nor Persian always uses native digits: it depends on the country and
   the reader can choose.

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

async function withLocale(tag, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { language: tag }, configurable: true });
  try {
    /* The module caches one formatter, so it has to be re-imported per locale. */
    const mod = await import(`../js/format-number.js?locale=${encodeURIComponent(tag)}`);
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
  /\.(?:textContent|innerText|innerHTML)\s*=|setUserText\(|setHtml\(|insertAdjacentHTML\(|setAttribute\(\s*['"](?:aria-label|title|aria-valuetext)['"]/;
const RAW_NUMBER =
  /Math\.(?:round|floor|ceil|trunc)\(|\.toFixed\(|\.toLocaleString\(\s*\)|\.(?:length|size)\b(?!\s*[-*/<>=!?&|)])|\bString\(/;

/* A number joined to text anywhere, not only on the line that renders it: a
   helper returns '12 Mbps' and its caller writes it. A CSS length is not read. */
const NUMBER = String.raw`(?:\.toFixed\([^)]*\)|Math\.(?:round|floor|ceil|trunc)\((?:[^()]|\([^()]*\))*\)|\.length\b)`;
const GLUED = new RegExp(
  String.raw`${NUMBER}\s*\+\s*['"\x60](?!(?:px|deg|em|rem|ms|s|vh|vw|fr|turn)\b|%)|['"\x60]\s*\+\s*(?:Math\.(?:round|floor|ceil|trunc)\(|[\w.$]+\.toFixed\()`,
);

/* A raw number in a template hole beside words or markup: text built over
   several lines reaches the reader with no sink on the same line. */
const HOLE = new RegExp(
  String.raw`(?:>\s*\$\{\s*[\w.$]*${NUMBER}\s*\}|\$\{\s*[\w.$]*${NUMBER}\s*\}(?=\s*<|\s+\p{L}{2}))`,
  'u',
);

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

function latinDigits(src, file) {
  return src.split('\n').flatMap((line, i) => {
    const code = withoutSentences(line);
    const raw = (RENDER.test(line) && RAW_NUMBER.test(code)) || GLUED.test(code) || HOLE.test(code);
    return raw ? [`${file}:${i + 1}: ${line.trim()}`] : [];
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
    'setHtml(el, html`<b>${formatNumber(rows.length)}</b>`);',
    'return `hsl(${Math.round(hue)},${sat}%,${light}%)`;',
    "vp.setAttribute('content', `width=${Math.round(iw / 3)},initial-scale=1`);",
    'bar.style.width = `${Math.round(p)}%`;',
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
