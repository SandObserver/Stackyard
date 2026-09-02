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

const ATTR = /\bstyle\s*=\s*["']/g;

test('no first-party markup carries a style attribute', () => {
  const offenders = [];
  for (const rel of sources) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const line of src.split('\n')) {
      if (ATTR.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 80)}`);
      ATTR.lastIndex = 0;
    }
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
