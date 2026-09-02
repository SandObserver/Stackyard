import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/* The palette is the system colours. Every entry below is transcribed from the
   Accents and Grays variables of the design kit.

   The two themes do not agree on every hue. Nine light accents moved in the iOS
   and iPadOS 27 kit while the dark ones and the greys stayed put, so a light
   value that looks like the familiar iOS colour is out of date, not correct.

   The values are transcribed by hand. The palette is documented as the list you
   read to choose a colour, so a wrong entry is wrong whether or not a rule uses
   it today, and nothing renders a hue no rule references.

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

/* The light values of the same eighteen, from the Any and Light column of the
   same variables. */
const APPLE_LIGHT = {
  '--sy-red': '#FF383C',
  '--sy-orange': '#FF8D28',
  '--sy-yellow': '#FFCC00',
  '--sy-green': '#34C759',
  '--sy-mint': '#00C8B3',
  '--sy-teal': '#00C3D0',
  '--sy-cyan': '#00C0E8',
  '--sy-blue': '#0088FF',
  '--sy-indigo': '#6155F5',
  '--sy-purple': '#CB30E0',
  '--sy-pink': '#FF2D55',
  '--sy-brown': '#AC7F5E',
  '--sy-gray': '#8E8E93',
  '--sy-gray2': '#AEAEB2',
  '--sy-gray3': '#C7C7CC',
  '--sy-gray4': '#D1D1D6',
  '--sy-gray5': '#E5E5EA',
  '--sy-gray6': '#F2F2F7',
};

/* Every top-level block a selector opens: the palette, the roles and the
   semantic sets are three of them. Anchored to the start of a line, which is
   what leaves out the copies nested in the increased-contrast block, where the
   hues are var() references to their -hi partners rather than values. */
function blockOf(selector) {
  const opener = `\n${selector} {`;
  const found = [];
  for (let at = tokens.indexOf(opener); at >= 0; at = tokens.indexOf(opener, at + 1)) {
    const start = at + opener.length;
    const end = tokens.indexOf('\n}', start);
    assert.ok(end > start, `${selector} is not closed`);
    found.push(tokens.slice(start, end));
  }
  assert.ok(found.length > 0, `${selector} should open a block in tokens.css`);
  return found.join('\n');
}

/* Both themes declare the palette, and the file carries one block for each. */
function paletteOf(selector) {
  const out = new Map();
  for (const m of blockOf(selector).matchAll(/(--sy-[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)) {
    out.set(m[1], m[2].toUpperCase());
  }
  return out;
}

function declarationsOf(selector) {
  const out = new Map();
  for (const m of blockOf(selector).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

/* The semantic sets, dark. Labels and fills are transcribed at the alpha the kit
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

/* The semantic sets, light. The surfaces are white or a palette grey, and the
   labels and fills are transcribed at the alpha the kit publishes. */
const APPLE_SEMANTIC_LIGHT = {
  '--label-primary': '#000000',
  '--label-secondary': 'rgba(60,60,67,.60)',
  '--label-tertiary': 'rgba(60,60,67,.30)',
  '--label-quaternary': 'rgba(60,60,67,.18)',
  '--fill-primary': 'rgba(120,120,120,.20)',
  '--fill-secondary': 'rgba(120,120,128,.16)',
  '--fill-tertiary': 'rgba(118,118,128,.12)',
  '--fill-quaternary': 'rgba(116,116,128,.08)',
  '--separator-opaque': '#C6C6C8',
  '--separator': 'rgba(0,0,0,.12)',
  '--bg-primary': '#FFFFFF',
  '--bg-secondary': 'var(--sy-gray6)',
  '--bg-tertiary': '#FFFFFF',
  '--bg-elevated-primary': '#FFFFFF',
  '--bg-elevated-secondary': 'var(--sy-gray6)',
  '--bg-elevated-tertiary': '#FFFFFF',
};

const THEMES = [
  [':root', APPLE_DARK, APPLE_SEMANTIC, 'dark'],
  ['html[data-theme="light"]', APPLE_LIGHT, APPLE_SEMANTIC_LIGHT, 'light'],
];

for (const [selector, palette, semantic, name] of THEMES) {
  test(`every semantic token is its reference value: ${name}`, () => {
    const declared = declarationsOf(selector);
    const wrong = [];
    for (const [token, expected] of Object.entries(semantic)) {
      const actual = declared.get(token);
      const same = actual && actual.replace(/\s+/g, '').toUpperCase() === expected.replace(/\s+/g, '').toUpperCase();
      if (!same) wrong.push(`${token}: ${actual ?? 'not declared'}, expected ${expected}`);
    }
    assert.deepEqual(wrong, [], `The ${name} semantic layer has drifted:\n  ${wrong.join('\n  ')}`);
  });

  test(`every palette entry is its reference value: ${name}`, () => {
    const declared = paletteOf(selector);
    const wrong = [];
    for (const [token, expected] of Object.entries(palette)) {
      const actual = declared.get(token);
      if (actual !== expected) wrong.push(`${token}: ${actual ?? 'not declared'}, the kit has ${expected}`);
    }
    assert.deepEqual(wrong, [], `The ${name} palette has drifted from the system colours:\n  ${wrong.join('\n  ')}`);
  });
}
