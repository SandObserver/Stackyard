const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest } = require('../src/widgets');

const base = { name: 'w', label: 'W', sizes: ['small'] };

test('a bare single-view manifest (no views) is valid', () => {
  const { errors } = validateManifest('w', base);
  assert.deepEqual(errors, []);
});

test('a views block with viewField and defaultView is valid', () => {
  const { errors } = validateManifest('w', {
    ...base, viewField: 'mode', defaultView: 'a',
    views: { a: { src: 'a.html' }, b: { label: 'B', src: 'b.html' } },
  });
  assert.deepEqual(errors, []);
});

test('a view without a src is rejected', () => {
  const { errors } = validateManifest('w', { ...base, views: { a: { label: 'A' } } });
  assert.ok(errors.some(e => /src/.test(e)), errors.join('; '));
});

test('an empty views block is rejected', () => {
  const { errors } = validateManifest('w', { ...base, views: {} });
  assert.ok(errors.some(e => /non-empty/.test(e)), errors.join('; '));
});

test('a views array (wrong shape) is rejected', () => {
  const { errors } = validateManifest('w', { ...base, views: [{ src: 'a.html' }] });
  assert.ok(errors.some(e => /non-empty object/.test(e)), errors.join('; '));
});

test('defaultView must name a declared view', () => {
  const { errors } = validateManifest('w', { ...base, defaultView: 'z', views: { a: { src: 'a.html' } } });
  assert.ok(errors.some(e => /defaultView/.test(e)), errors.join('; '));
});

test('viewField without a views block is rejected', () => {
  const { errors } = validateManifest('w', { ...base, viewField: 'mode' });
  assert.ok(errors.some(e => /views/.test(e)), errors.join('; '));
});
