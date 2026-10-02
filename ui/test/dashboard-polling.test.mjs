import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dash = fs.readFileSync(path.join(root, 'js/dashboard.js'), 'utf8');

/* A tab that boots hidden starts polling at boot and again when first shown. */
test('starting the polls stops any that are running', () => {
  const body = dash.match(/const startPolling = \(\) => \{([\s\S]*?)\n {2}\};/)?.[1] ?? '';
  assert.ok(body, 'startPolling not found');
  assert.match(body.trim(), /^stopPolling\(\);/);
});
