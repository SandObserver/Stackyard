/* The failure kind is what picks the wording, so the mapping from a caught
   error to a kind is the part worth pinning. The upstream sentence must never
   reach the reader. */

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

/* An upstream sentence names hosts, ports and status codes, and is not
   translated. No widget may draw one. */
test('no widget renders a response error message', () => {
  const offenders = [];
  const dir = path.join(root, 'widgets');
  for (const w of fs.readdirSync(dir)) {
    const d = path.join(dir, w);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter(f => f.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(d, f), 'utf8');
      if (/(?:textContent|setHtml|metricRow)[^\n]*\berror\.message\b/.test(src)) offenders.push(`${w}/${f}`);
      if (/\berror\.message\b/.test(src)) offenders.push(`${w}/${f}`);
    }
  }
  assert.deepEqual([...new Set(offenders)], [], 'these draw the upstream sentence instead of the kind');
});

/* Error and empty are different claims. A widget that can render nothing must
   say which of the two it is. */
test('every polling widget declares an empty state or draws its own', () => {
  const dir = path.join(root, 'widgets');
  const missing = [];
  for (const w of fs.readdirSync(dir)) {
    const d = path.join(dir, w);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter(f => f.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(d, f), 'utf8');
      if (!/\bpoll\(\{/.test(src)) continue;
      /* errorLine is the hook for a widget that keeps a designed state of its
         own, like the VPN card's disconnected face. */
      const handled = /isEmpty\s*:/.test(src) || /errorState\(/.test(src) || /errorLine\(/.test(src);
      if (!handled) missing.push(`${w}/${f}`);
    }
  }
  assert.deepEqual(missing, [], 'these poll but never say what empty looks like');
});

/* A bay the service stopped reporting keeps placeholder status fields. Reading
   those as a healthy drive is the failure this guards. */
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
