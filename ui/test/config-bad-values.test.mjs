import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { wallpaperFileName } from '../js/admin-logic.js';
import { computeBadgeVisual } from '../js/badge-logic.js';
import { desktopPages, withKnownSizes } from '../js/dashboard-logic.js';

register('./js-root-hooks.mjs', import.meta.url);
const { keptWidget } = await import('../js/admin-save-logic.js');

test('an unknown widget size becomes medium and known sizes stay', () => {
  const sizes = { small: 2, medium: 2, large: 4, xlarge: 4 };
  const items = [
    { type: 'widget', widgetSize: 'huge' },
    { type: 'widget', widgetSize: 9 },
    { type: 'widget', widgetSize: 'constructor' },
    { type: 'widget', widgetSize: 'large' },
    { type: 'widget' },
    { type: 'app', widgetSize: 'huge' },
  ];
  assert.deepEqual(
    withKnownSizes(items, sizes).map(i => i.widgetSize),
    ['medium', 'medium', 'medium', 'large', undefined, 'huge'],
  );
});

test('layout ends when a span is not a number', () => {
  assert.deepEqual(
    desktopPages([{ id: 'w' }], () => [undefined, undefined], 8, 4),
    [[{ id: 'w' }]],
  );
});

test('a static badge label or unit that is not text is ignored', () => {
  const v = computeBadgeVisual({ staticBdg: { enabled: true, label: 5 } });
  assert.notEqual(v.num, 5);
  const u = computeBadgeVisual({ activity: 3, custom: { unit: 5 } });
  assert.equal(u.unit, '');
});

test('a malformed percent sequence keeps the raw file name', () => {
  assert.equal(wallpaperFileName('/icons/x%zz.png'), 'x%zz.png');
  assert.equal(wallpaperFileName('/icons/a%20b.png'), 'a b.png');
});

test('a widget with no manifest keeps its stored fields', () => {
  const orig = {
    id: 'w',
    type: 'widget',
    widgetType: 'gone',
    label: 'Old',
    widgetSize: 'small',
    widgetConfig: { a: 1 },
  };
  assert.deepEqual(keptWidget(orig, 'New', 'large'), { ...orig, label: 'New', widgetSize: 'large' });
});
