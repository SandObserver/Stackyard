/* The first-party pages serve style-src without 'unsafe-inline', so nothing they
   render may carry a style attribute. A style set from JavaScript is fine:
   style-src does not cover CSSOM.

   Widget pages keep the permission and are out of scope. They are the only
   documents allowed inline script, and they carry their own <style> blocks. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The markup the two first-party pages serve, and every module that writes
   markup into them. */
const sources = [
  'index.html',
  'admin/index.html',
  ...fs.readdirSync(path.join(root, 'js')).map(f => path.join('js', f)),
].filter(f => /\.(html|js)$/.test(f));

/* setAttribute('style') writes the attribute, so style-src applies to it. The
   call can span lines once formatted, and attribute names ignore case. */
const ATTR = /\bstyle\s*=\s*["']|setAttribute\(\s*['"`]style['"`]/gi;

const styleAttributeLines = (rel, src) =>
  [...src.matchAll(ATTR)].map(m => {
    const line = src.slice(0, m.index).split('\n').length;
    return `${rel}:${line}: ${src.slice(m.index, m.index + 60).replace(/\s+/g, ' ')}`;
  });

test('the scan catches every way of writing the attribute', () => {
  assert.equal(styleAttributeLines('x', '<div style="color:red">').length, 1);
  assert.equal(styleAttributeLines('x', "el.setAttribute('style', 'color:red');").length, 1);
  assert.equal(styleAttributeLines('x', "el.setAttribute(\n  'style',\n  `color:${c}`,\n);").length, 1);
  assert.equal(styleAttributeLines('x', "el.setAttribute('STYLE', 'color:red');").length, 1);
  assert.equal(styleAttributeLines('x', "el.style.color = 'red';").length, 0);
});

test('no first-party markup carries a style attribute', () => {
  const offenders = [];
  for (const rel of sources) {
    offenders.push(...styleAttributeLines(rel, fs.readFileSync(path.join(root, rel), 'utf8')));
  }
  assert.deepEqual(
    offenders,
    [],
    `A style attribute needs style-src 'unsafe-inline'. Use a class, or set it from JavaScript:\n${offenders.join('\n')}`,
  );
});

test("neither first-party policy grants 'unsafe-inline' for styles", () => {
  const conf = f => fs.readFileSync(path.resolve(root, '..', 'nginx', f), 'utf8');
  const policies = [...conf('csp-default.conf').split('\n'), ...conf('dashboard.conf').split('\n')].filter(
    l => l.includes('add_header Content-Security-Policy') && !l.includes("script-src 'self' 'unsafe-inline'"),
  );

  assert.ok(policies.length >= 2, 'expected the default and admin policies');
  for (const line of policies) {
    assert.match(line, /style-src 'self';/, `style-src must not carry 'unsafe-inline': ${line.trim().slice(0, 90)}`);
  }
});
