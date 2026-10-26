import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../js/widget-theme.js', import.meta.url), 'utf8');

function run(search) {
  const root = { lang: 'en', style: {} };
  vm.runInNewContext(src, {
    window: {},
    location: { search },
    URLSearchParams,
    Intl,
    document: { documentElement: root },
  });
  return root.lang;
}

test('a widget page declares the language the dashboard passes', () => {
  assert.equal(run('?id=w1&lang=fa'), 'fa');
  assert.equal(run('?id=w1&lang=zh-hans'), 'zh-Hans');
});

test('a widget page keeps its own language without a valid lang', () => {
  assert.equal(run('?id=w1'), 'en');
  assert.equal(run('?id=w1&lang=not%20a%20tag'), 'en');
});
