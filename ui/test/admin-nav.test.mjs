/* The admin nav links and the sections they reveal must agree.

   A link whose data-sec names no section hid every section and left the page
   blank, the same failure a stale stored value caused (P10-3). resolveAdminSection
   now prevents the blank page either way, but a mismatch here is still a bug
   worth catching at its source rather than surviving as a silent fallback. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAdminSection } from '../js/admin-logic.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');

const sections = [
  ...new Set(
    [...html.matchAll(/id="sec-([a-z-]+)"[^>]*class="[^"]*\bsec\b/g)]
      .map(m => m[1])
      .concat([...html.matchAll(/class="[^"]*\bsec\b[^"]*"[^>]*id="sec-([a-z-]+)"/g)].map(m => m[1])),
  ),
];
const links = [...new Set([...html.matchAll(/data-sec="([a-z-]+)"/g)].map(m => m[1]))];

test('the markup still has sections and nav links', () => {
  assert.ok(sections.length >= 2, `found ${sections.length} sections`);
  assert.ok(links.length >= 2, `found ${links.length} nav links`);
});

test('every nav link names a section that exists', () => {
  for (const l of links) {
    assert.ok(sections.includes(l), `data-sec="${l}" matches no section in the page`);
  }
});

test('every section is reachable from a nav link', () => {
  for (const s of sections) {
    assert.ok(links.includes(s), `section sec-${s} has no nav link`);
  }
});

/* Clicking any link must leave exactly one section visible. */
test('every nav link resolves to itself', () => {
  for (const l of links) {
    assert.equal(resolveAdminSection(l, sections), l, `clicking ${l} should show ${l}`);
  }
});

test('a stored section from an older version does not blank the page', () => {
  const got = resolveAdminSection('a-section-that-was-renamed', sections);
  assert.ok(sections.includes(got), 'must land on a real section');
});
