import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { errorKind, errorCopy, ERROR_KINDS } = await import('../js/widget-error.js');

test('the kind the API sent wins', () => {
  for (const kind of ERROR_KINDS) {
    assert.equal(errorKind({ kind, status: 500 }), kind, `${kind} should be taken as sent`);
  }
});

test('a kind the API never sends is not trusted', () => {
  assert.equal(errorKind({ kind: 'banana', status: 401 }), 'auth');
  assert.equal(errorKind({ kind: 'constructor' }), 'network');
});

test('a widget that fetches for itself falls back to the status', () => {
  assert.equal(errorKind({ status: 401 }), 'auth');
  assert.equal(errorKind({ status: 403 }), 'auth');
  assert.equal(errorKind({ status: 503 }), 'invalid');
  assert.equal(errorKind({ status: 504 }), 'timeout');
  assert.equal(errorKind({ status: 502 }), 'network');
  assert.equal(errorKind({ status: 418 }), 'upstream');
});

test('a rejected fetch reports as unreachable', () => {
  assert.equal(errorKind(new TypeError('Failed to fetch')), 'network');
});

test('nothing at all is an internal failure, not a network one', () => {
  assert.equal(errorKind(null), 'internal');
  assert.equal(errorKind(undefined), 'internal');
});

test('every kind has its own catalog key and English', () => {
  const keys = new Set();
  for (const kind of ERROR_KINDS) {
    const { key, text } = errorCopy(kind);
    assert.match(key, /^err[A-Z]/, `${kind} has no key`);
    assert.ok(text.length > 0, `${kind} has no English`);
    keys.add(key);
  }
  assert.equal(keys.size, ERROR_KINDS.length, 'two kinds share a key');
});

test('an unknown kind still gets usable copy', () => {
  assert.deepEqual(errorCopy('banana'), errorCopy('internal'));
});

test('no widget renders a response error message', () => {
  const offenders = [];
  const dir = path.join(root, 'widgets');
  for (const w of fs.readdirSync(dir)) {
    const d = path.join(dir, w);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter(name => name.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(d, f), 'utf8');
      if (/(?:textContent|setHtml|metricRow)[^\n]*\berror\.message\b/.test(src)) offenders.push(`${w}/${f}`);
      if (/\berror\.message\b/.test(src)) offenders.push(`${w}/${f}`);
    }
  }
  assert.deepEqual([...new Set(offenders)], [], 'these draw the upstream sentence instead of the kind');
});

test('every polling widget declares an empty state or draws its own', () => {
  const dir = path.join(root, 'widgets');
  const missing = [];
  for (const w of fs.readdirSync(dir)) {
    const d = path.join(dir, w);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter(name => name.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(d, f), 'utf8');
      if (!/\bpoll\(\{/.test(src)) continue;
      const handled = /isEmpty\s*:/.test(src) || /errorState\(/.test(src) || /errorLine\(/.test(src);
      if (!handled) missing.push(`${w}/${f}`);
    }
  }
  assert.deepEqual(missing, [], 'these poll but never say what empty looks like');
});

test('a disk bay that reports an error is drawn as neither healthy nor empty', () => {
  const src = fs.readFileSync(path.join(root, 'widgets/disk-health/index.html'), 'utf8');
  assert.match(src, /const unread = d => !!\(d && d\.error\)/, 'no unread test');
  assert.match(src, /if \(unread\(d\)\) \{\s*\n\s*bay\.classList\.add\('unread'\)/, 'update() does not branch on it');
  assert.match(src, /\.bay\.unread \{/, 'the unread bay has no styling of its own');
  assert.match(src, /#dots i\.unread \{/, 'the status dot does not mark it');
  assert.ok(
    /openBay\(i\) \{\s*\n\s*const d = bayData\[i\]; if \(!d \|\| unread\(d\)\) return;/.test(src),
    'an unreported bay still opens a device page',
  );
});

test('the caption hides itself and never takes pointer events', () => {
  const src = fs.readFileSync(path.join(root, 'js/widget-error.js'), 'utf8');
  const block = src.slice(src.indexOf('.wt-cap {'), src.indexOf('.wt-cap svg'));
  assert.match(block, /pointer-events:\s*none/, 'the caption can be hovered');
  assert.match(block, /\.wt-cap\[hidden\]\s*\{\s*display:\s*none/, 'hidden does not hide the caption');
});

test('a widget that toggles hidden on a styled element says so in its own CSS', () => {
  const src = fs.readFileSync(path.join(root, 'widgets/nowplaying/index.html'), 'utf8');
  assert.match(src, /\[hidden\]\s*\{\s*display:\s*none/, 'the clamped title cannot be hidden');
});

test('a widget naming its root with the line hides the caption from readers', () => {
  for (const f of ['nowplaying/index.html', 'github/contributions.html']) {
    const src = fs.readFileSync(path.join(root, 'widgets', f), 'utf8');
    assert.match(src, /aria-label['"]?,\s*line\)|\bname\(line\)/, `${f} does not name its root`);
    assert.match(src, /setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/, `${f} reads the line twice`);
    assert.match(src, /removeAttribute\(\s*['"]aria-hidden['"]\s*\)/, `${f} never restores the caption`);
  }
});

test('system summary reports its failure to the summary paragraph', () => {
  const src = fs.readFileSync(path.join(root, 'widgets/system-summary/index.html'), 'utf8');
  assert.match(src, /sr-sum[\s\S]{0,200}sum\.textContent = line/, 'the failure never reaches the summary');
});

test('every widget surfaces a failure on the same terms', () => {
  const dir = path.join(root, 'widgets');
  const odd = [];
  for (const w of fs.readdirSync(dir)) {
    const d = path.join(dir, w);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter(name => name.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(d, f), 'utf8');
      for (const gate of src.match(/if\s*\(\s*!?everOk[^)]*\)/g) || []) {
        const norm = gate.replace(/\s+/g, '');
        if (norm !== 'if(!everOk||stale)' && norm !== 'if(everOk&&!stale)') odd.push(`${w}/${f}: ${gate}`);
      }
    }
  }
  assert.deepEqual(odd, [], 'these wait longer than the rest before saying anything');
});

test('the caption never goes inert with the failure it reports', () => {
  const src = fs.readFileSync(path.join(root, 'js/widget-error.js'), 'utf8');
  const block = src.slice(src.indexOf('const contentOf'), src.indexOf('const t ='));
  assert.match(block, /\[\.\.\.root\.children\]\.filter\(el => el !== cap\)/, 'the root fades its own caption');
});

test('a caption too long for its card wraps instead of being cut', () => {
  const src = fs.readFileSync(path.join(root, 'js/widget-error.js'), 'utf8');
  const block = src.slice(src.indexOf('.wt-cap b {'), src.indexOf('.wt-cap i {'));
  assert.doesNotMatch(block, /white-space:\s*nowrap/, 'the line is still held to one row');
  assert.match(block, /-webkit-line-clamp:\s*2/, 'the line is not clamped');
});

test('the failure caption and its time suffix meet 4.5:1 on every card', () => {
  const src = fs.readFileSync(path.join(root, 'js/widget-error.js'), 'utf8');
  const ink = sel => {
    const rule = src.slice(src.indexOf(sel + '{'), src.indexOf('}', src.indexOf(sel + '{')));
    const m = rule.match(/color:\s*var\(--wt-cap-color,\s*([^)]+\)?)\)/);
    assert.ok(src.includes(sel + '{') && m, `no default ink for ${sel}`);
    return m[1].trim();
  };
  const suffix = src.match(/\.wt-cap i \{([^}]*)\}/)[1];
  const dim = Number(suffix.match(/opacity:\s*([\d.]+)/)?.[1] ?? 1);
  const rgba = v => {
    if (v.startsWith('#')) return [...[1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)), 1];
    const [r, g, b, a = 1] = v.match(/[\d.]+/g).map(Number);
    return [r, g, b, a];
  };
  const lum = c =>
    c
      .map(v => v / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (fg, bg) => {
    const [r, g, b, a] = rgba(fg);
    const top = [r, g, b].map((v, i) => v * a * dim + bg[i] * (1 - a * dim));
    const [x, y] = [lum(top), lum(bg)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const cards = {
    dark: [[0x1c, 0x1c, 0x1e], ink('.wt-cap ')],
    graphite: [[0x2c, 0x2c, 0x2e], ink('.wt-cap ')],
    light: [[0xff, 0xff, 0xff], ink('html[data-theme="light"] .wt-cap ')],
  };
  for (const [card, [bg, fg]] of Object.entries(cards)) {
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${card} card: ${r.toFixed(2)}:1`);
  }
});
