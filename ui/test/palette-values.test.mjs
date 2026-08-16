import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* The palette is Apple's system colours, dark values. Every entry below is
   transcribed from the Accents and Grays variables of the iOS/iPadOS and macOS
   design kits, which agree on all eighteen.

   The values had been copied by hand, and one had gone in wrong: Cyan was
   #3CCFFE against Apple's #3CD3FE. No rule referenced Cyan, so nothing rendered
   the mistake and nothing caught it. The palette is documented as the list you
   read to choose a colour, so a wrong entry is wrong whether or not a rule uses
   it today.

   The -hi partners are not listed. They are increased-contrast values, and the
   kits export their increased-contrast modes empty, so there is nothing to
   check them against. Do not extend this table to cover them by guessing. */

const cssDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../css');
const tokens = fs.readFileSync(path.join(cssDir, 'tokens.css'), 'utf8');

const APPLE_DARK = {
  '--sy-red': '#FF4245',
  '--sy-orange': '#FF9230',
  '--sy-yellow': '#FFD600',
  '--sy-green': '#30D158',
  '--sy-mint': '#00DAC3',
  '--sy-teal': '#00D2E0',
  '--sy-cyan': '#3CD3FE',
  '--sy-blue': '#0091FF',
  '--sy-indigo': '#6D7CFF',
  '--sy-purple': '#DB34F2',
  '--sy-pink': '#FF375F',
  '--sy-brown': '#B78A66',
  '--sy-gray': '#8E8E93',
  '--sy-gray2': '#636366',
  '--sy-gray3': '#48484A',
  '--sy-gray4': '#3A3A3C',
  '--sy-gray5': '#2C2C2E',
  '--sy-gray6': '#1C1C1E',
};

/* Only the base :root, not the increased-contrast block, which redeclares every
   hue as a var() reference to its -hi partner. */
function baseDeclarations() {
  const end = tokens.indexOf('@media (prefers-contrast: more)');
  assert.ok(end > 0, 'the increased-contrast block should exist');
  const out = new Map();
  for (const m of tokens.slice(0, end).matchAll(/(--sy-[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)) {
    out.set(m[1], m[2].toUpperCase());
  }
  return out;
}

/* The semantic sets, dark. Labels and fills are transcribed at the alpha Apple
   publishes; the surfaces point at palette greys and are checked through the
   reference rather than by value. */
const APPLE_SEMANTIC = {
  '--label-primary': '#FFFFFF',
  '--label-secondary': 'rgba(235,235,245,.70)',
  '--label-tertiary': 'rgba(235,235,245,.30)',
  '--label-quaternary': 'rgba(235,235,245,.16)',
  '--fill-primary': 'rgba(120,120,128,.36)',
  '--fill-secondary': 'rgba(120,120,128,.32)',
  '--fill-tertiary': 'rgba(118,118,128,.24)',
  '--fill-quaternary': 'rgba(118,118,128,.18)',
  '--separator-opaque': '#38383A',
  '--separator': 'rgba(255,255,255,.17)',
  '--bg-primary': '#000000',
  '--bg-secondary': 'var(--sy-gray6)',
  '--bg-tertiary': 'var(--sy-gray5)',
  '--bg-elevated-primary': 'var(--sy-gray6)',
  '--bg-elevated-secondary': 'var(--sy-gray5)',
  '--bg-elevated-tertiary': 'var(--sy-gray4)',
  '--bg-primary-light': '#FFFFFF',
  '--control-knob': '#FFFFFF',
};

test('every semantic token is its Apple value', () => {
  const end = tokens.indexOf('@media (prefers-contrast: more)');
  const declared = new Map();
  for (const m of tokens.slice(0, end).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    declared.set(m[1], m[2].trim());
  }
  const wrong = [];
  for (const [name, expected] of Object.entries(APPLE_SEMANTIC)) {
    const actual = declared.get(name);
    const same = actual && actual.replace(/\s+/g, '').toUpperCase() === expected.replace(/\s+/g, '').toUpperCase();
    if (!same) wrong.push(`${name}: ${actual ?? 'not declared'}, expected ${expected}`);
  }
  assert.deepEqual(wrong, [], `The semantic layer has drifted:\n  ${wrong.join('\n  ')}`);
});

test('every palette entry is its Apple value', () => {
  const declared = baseDeclarations();
  const wrong = [];
  for (const [name, expected] of Object.entries(APPLE_DARK)) {
    const actual = declared.get(name);
    if (actual !== expected) wrong.push(`${name}: ${actual ?? 'not declared'}, Apple has ${expected}`);
  }
  assert.deepEqual(wrong, [], `The palette has drifted from Apple's system colours:\n  ${wrong.join('\n  ')}`);
});
