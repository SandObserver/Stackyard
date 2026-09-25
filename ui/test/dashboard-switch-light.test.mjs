import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'widgets', 'dashboard-switch', 'index.html'),
  'utf8',
);

const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('keychain names on the light card clear 4.5:1', () => {
  const m = html.match(/html\[data-theme="light"\] \.nm \{ fill:(#[0-9a-fA-F]{6}) \}/);
  assert.ok(m, 'light theme sets a resting fill for .nm');
  assert.ok(contrast(m[1], '#FFFFFF') >= 4.5, `${m[1]} on white is ${contrast(m[1], '#FFFFFF').toFixed(2)}:1`);
});
