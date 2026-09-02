/* The admin nav links and the sections they reveal must agree. A link whose
   data-sec names no section is caught here rather than surviving as a silent
   fallback in resolveAdminSection. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAdminSection } from '../js/admin-logic.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

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

/* ── A group footer explains the row above it ─────────────────────────────── */

/* The logging tip sat after four rows and described the first, with the Docker
   health toggle between them. A footer that is not adjacent to its row reads as
   describing whatever it follows. */
test('the logging tip follows the logging row, not the group below it', () => {
  const html = read('admin/index.html');
  const level = html.indexOf('id="log-level"');
  const tip = html.indexOf('data-i18n="general.loggingTip"');
  const docker = html.indexOf('id="rl-srv-docker-en"');
  assert.ok(level > -1 && tip > -1 && docker > -1, 'the Monitoring group has moved');
  assert.ok(tip > level, 'the tip comes before the row it explains');
  assert.ok(tip < docker, 'a row it does not describe sits between them');
});

/* "Errors shows warnings and errors only" used the option name as a bare
   subject, which does not parse. */
test('neither Settings tip opens with a bare option name', () => {
  const cat = JSON.parse(read('i18n/en.json'));
  assert.doesNotMatch(cat.general.loggingTip, /^Errors shows/);
  assert.match(cat.general.loggingTip, /Errors/, 'the tip must still name the option it describes');
});

/* "Used to allow your server's IP in badge URLs and SSRF protection" named the
   mechanism rather than the effect. */
test('the host IP tip states what it does, not how', () => {
  const cat = JSON.parse(read('i18n/en.json'));
  assert.doesNotMatch(cat.general.hostIpTip, /SSRF/, 'implementation jargon in a user-facing hint');
});

test('both tips are translated everywhere', () => {
  const en = JSON.parse(read('i18n/en.json')).general;
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json') && f !== 'en.json')) {
    const cat = JSON.parse(read(`i18n/${file}`)).general;
    for (const key of ['loggingTip', 'hostIpTip']) {
      assert.ok(cat[key], `${file} is missing general.${key}`);
      assert.notEqual(cat[key], en[key], `${file} still carries the English ${key}`);
    }
  }
});
