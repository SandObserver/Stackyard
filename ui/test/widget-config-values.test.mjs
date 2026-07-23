import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCarried, applyOptionSet, collectFieldValues } from '../js/admin-logic.js';

test('seedCarried takes only the declared keys that are present', () => {
  assert.deepEqual(seedCarried({ city: 'Ottawa', lat: 45.4, lon: -75.7 }, ['lat', 'lon']), { lat: 45.4, lon: -75.7 });
  assert.deepEqual(seedCarried({ city: 'Ottawa' }, ['lat', 'lon']), {});
  assert.deepEqual(seedCarried({ lat: 1 }, []), {});
  assert.deepEqual(seedCarried(undefined, ['lat']), {});
});

test('seedCarried keeps a zero coordinate', () => {
  assert.deepEqual(seedCarried({ lat: 0, lon: 0 }, ['lat', 'lon']), { lat: 0, lon: 0 });
});

test('applyOptionSet overwrites the declared keys from the chosen option', () => {
  const out = applyOptionSet({ lat: 1, lon: 2 }, { value: 'x', set: { lat: 45.4, lon: -75.7 } }, ['lat', 'lon']);
  assert.deepEqual(out, { lat: 45.4, lon: -75.7 });
});

test('applyOptionSet leaves the seeded values alone when no option is chosen', () => {
  assert.deepEqual(applyOptionSet({ lat: 1, lon: 2 }, undefined, ['lat', 'lon']), { lat: 1, lon: 2 });
  assert.deepEqual(applyOptionSet({ lat: 1, lon: 2 }, { value: 'x' }, ['lat', 'lon']), { lat: 1, lon: 2 });
});

test('applyOptionSet ignores set keys the field did not declare', () => {
  const out = applyOptionSet({}, { value: 'x', set: { lat: 9, tz: 'UTC' } }, ['lat']);
  assert.deepEqual(out, { lat: 9 });
});

test('applyOptionSet does not mutate its input', () => {
  const before = { lat: 1 };
  applyOptionSet(before, { value: 'x', set: { lat: 2 } }, ['lat']);
  assert.deepEqual(before, { lat: 1 });
});

const reads = () => [
  { field: { key: 'cityQuery', transient: true }, visible: true, kv: ['cityQuery', 'Ottawa'] },
  { field: { key: 'city' }, visible: true, kv: ['city', 'Ottawa, Ontario, Canada', { lat: 45.4, lon: -75.7 }] },
  { field: { key: 'units' }, visible: true, kv: ['units', 'c'] },
];

test('collectFieldValues drops transient fields from the saved config', () => {
  assert.deepEqual(collectFieldValues(reads()), {
    city: 'Ottawa, Ontario, Canada', lat: 45.4, lon: -75.7, units: 'c',
  });
});

test('collectFieldValues keeps transient fields in the fetch draft', () => {
  const out = collectFieldValues(reads(), { includeTransient: true });
  assert.equal(out.cityQuery, 'Ottawa');
});

test('collectFieldValues skips a field hidden by showIf', () => {
  const out = collectFieldValues([
    { field: { key: 'a' }, visible: true, kv: ['a', 1] },
    { field: { key: 'b', showIf: { field: 'a', equals: 2 } }, visible: false, kv: ['b', 'hidden'] },
  ]);
  assert.deepEqual(out, { a: 1 });
});

test('collectFieldValues omits a field that read back undefined', () => {
  assert.deepEqual(collectFieldValues([{ field: { key: 'a' }, visible: true, kv: ['a', undefined] }]), {});
  assert.deepEqual(collectFieldValues([{ field: { key: 'a' }, visible: true, kv: null }]), {});
});
