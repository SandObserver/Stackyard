import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDGET_TYPES, WIDGET_HEIGHTS, WIDGET_DESIGN, WIDGET_COLS,
  WIDGET_ROWS, WIDGET_COST, widgetSrc,
} from '../js/widget-types.js';

test('widgetSrc dispatches by widgetType', () => {
  const src = widgetSrc({ id: 'a', widgetType: 'clock' });
  assert.match(src, /^\/widgets\/clock\//);
});

test('unknown widgetType falls back to custom', () => {
  assert.equal(widgetSrc({ id: 'a', widgetType: 'nope', url: 'https://x/y' }), 'https://x/y');
});

test('custom returns the item url, or empty string when absent', () => {
  assert.equal(widgetSrc({ id: 'a', widgetType: 'custom', url: 'https://x/y' }), 'https://x/y');
  assert.equal(widgetSrc({ id: 'a', widgetType: 'custom' }), '');
});

test('stats defaults to system-stats and switches to disk-health by subtype', () => {
  const def = widgetSrc({ id: 'a', widgetType: 'stats' });
  assert.match(def, /^\/widgets\/stats\/system-stats\.html/);
  const disk = widgetSrc({ id: 'a', widgetType: 'stats', widgetConfig: { widgetSubType: 'disk-health' } });
  assert.match(disk, /^\/widgets\/stats\/disk-health\.html/);
});

test('connections defaults to map and switches to vpn by view', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'connections' }), /connections-map\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'connections', widgetConfig: { view: 'vpn' } }), /connections-vpn\.html/);
});

test('github switches file by githubView', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'github' }), /github\/pullrequests\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'github', widgetConfig: { githubView: 'contributions' } }), /github\/contributions\.html/);
});

test('clock selects the file by clockStyle', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'clock' }), /clock\/digital\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'clock', widgetConfig: { clockStyle: 'analog' } }), /clock\/analog\.html/);
});

test('the widget id is URL-encoded into the src', () => {
  const src = widgetSrc({ id: 'a b/c', widgetType: 'clock' });
  assert.match(src, /id=a%20b%2Fc/);
  assert.doesNotMatch(src, /id=a b\/c/);
});

test('opts.mobile is threaded through for widgets that accept it', () => {
  const src = widgetSrc({ id: 'a', widgetType: 'stats', widgetConfig: { widgetSubType: 'disk-health' } }, { mobile: true });
  assert.match(src, /[?&]mobile=1/);
});

test('the geometry tables cover the same set of sizes', () => {
  const sizes = Object.keys(WIDGET_DESIGN).sort();
  for (const table of [WIDGET_HEIGHTS, WIDGET_COLS.desktop, WIDGET_COLS.mobile, WIDGET_ROWS.desktop, WIDGET_COST.desktop]) {
    assert.deepEqual(Object.keys(table).sort(), sizes);
  }
});

test('every widget type only offers sizes the geometry tables define', () => {
  const known = new Set(Object.keys(WIDGET_DESIGN));
  for (const [type, def] of Object.entries(WIDGET_TYPES)) {
    for (const size of def.sizes || []) {
      assert.ok(known.has(size), `${type} offers unknown size "${size}"`);
    }
  }
});
