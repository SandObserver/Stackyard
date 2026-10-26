import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../js/widget-theme.js', import.meta.url), 'utf8');

/* iOS Safari enlarges frame text on a sideways phone, so every widget clips. */
test('a widget frame turns off text enlarging, even when the parent cannot be read', () => {
  const style = {};
  const window = {
    get frameElement() {
      throw new Error('cross-origin');
    },
  };
  vm.runInNewContext(src, { window, document: { documentElement: { style } } });
  assert.equal(style.webkitTextSizeAdjust, '100%');
});
