import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'css');
const admin = fs
  .readFileSync(path.join(dir, 'admin.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/@media\s*\(forced-colors:\s*active\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

/* The row's editing fill marks the field that has focus. */
const EXEMPT = new Set(['.ie-row .row-inp']);

const selectors = re =>
  [...admin.matchAll(re)].flatMap(m => m[1].split(',')).map(s => s.trim().split('\n').pop().trim());

/* admin.css has no generic input focus rule, so a field that removes the
   browser outline must draw its own, outside forced colors too. */
test('every Settings field that removes the outline draws a focus ring', () => {
  const removed = selectors(/([^{}]+)\{[^}]*outline:\s*(?:none|0)\s*[;}]/g).filter(
    s => !/:focus/.test(s) && !EXEMPT.has(s),
  );
  assert.ok(removed.length >= 5, 'the scan found too few fields to be reading admin.css');
  const ringed = new Set(
    selectors(/([^{}]+)\{[^}]*outline:\s*(?:0*[1-9][\d.]*|0?\.\d*[1-9])px\s+solid/g)
      .filter(s => /:focus(-visible)?$/.test(s))
      .map(s => s.replace(/:focus(-visible)?$/, '')),
  );
  const missing = removed.filter(s => !ringed.has(s));
  assert.deepEqual(missing, []);
});

const dashboard = fs.readFileSync(path.join(dir, 'dashboard.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/* The search field's ring is drawn on its search box. */
const DASHBOARD_EXEMPT = new Set(['#sin']);

/* An id rule that removes the outline outranks the generic
   button:focus-visible ring, so the control needs a ring of its own. */
test('every dashboard control that removes the outline draws a focus ring', () => {
  const pick = re =>
    [...dashboard.matchAll(re)].flatMap(m => m[1].split(',')).map(s => s.trim().split('\n').pop().trim());
  const removed = pick(/([^{}]+)\{[^}]*outline:\s*(?:none|0)\s*[;}]/g).filter(
    s => !/:focus/.test(s) && !DASHBOARD_EXEMPT.has(s),
  );
  assert.ok(removed.length >= 2, 'the scan found too few rules to be reading dashboard.css');
  const ringed = pick(/([^{}]+)\{[^}]*(?:outline:\s*\d+px\s+solid|box-shadow:[^;}]*\b\d+px\s+var\(--accent\))/g)
    .filter(s => /:focus(-visible)?$/.test(s))
    .map(s => s.replace(/:focus(-visible)?$/, ''));
  const missing = removed.filter(s => !ringed.includes(s));
  assert.deepEqual(missing, []);
});
