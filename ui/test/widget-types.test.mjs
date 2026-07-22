import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDGET_HEIGHTS, WIDGET_DESIGN, WIDGET_COLS,
  WIDGET_ROWS, WIDGET_COST, widgetSrc,
} from '../js/widget-types.js';

/* Stand-in for the /api/widgets registry, keyed by widget name. Mirrors the
   shipped manifests' view routing; versions are illustrative. */
const REG = {
  clock: {
    sizes: ['small'], viewField: 'clockStyle', defaultView: 'digital',
    views: { digital: { src: 'digital.html' }, analog: { src: 'analog.html' } },
    entryVersions: { 'digital.html': 'aa11aa11', 'analog.html': 'bb22bb22' },
  },
  stats: {
    sizes: ['small', 'medium'], viewField: 'widgetSubType', defaultView: 'system-summary',
    views: { 'system-summary': { src: 'system-stats.html' }, 'disk-health': { src: 'disk-health.html' } },
  },
  connections: {
    sizes: ['small', 'medium'], viewField: 'view', defaultView: 'map',
    views: { map: { src: 'connections-map.html' }, vpn: { src: 'connections-vpn.html' } },
  },
  github: {
    sizes: ['small', 'medium', 'large', 'xlarge'], viewField: 'githubView', defaultView: 'prs',
    views: { prs: { src: 'pullrequests.html' }, contributions: { src: 'contributions.html' } },
  },
  dns:    { sizes: ['small', 'medium'], views: null },
  backup: { sizes: ['small', 'medium'], views: { main: { src: 'backup.html' } } },
};

test('a single-view widget defaults to index.html under its own folder', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'dns' }, REG), /^\/widgets\/dns\/index\.html\?/);
});

test('a widget declaring one non-index view uses that file', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'backup' }, REG), /^\/widgets\/backup\/backup\.html\?/);
});

test('unknown or custom widgetType falls back to the item url', () => {
  assert.equal(widgetSrc({ id: 'a', widgetType: 'nope', url: 'https://x/y' }, REG), 'https://x/y');
  assert.equal(widgetSrc({ id: 'a', widgetType: 'custom', url: 'https://x/y' }, REG), 'https://x/y');
  assert.equal(widgetSrc({ id: 'a', widgetType: 'custom' }, REG), '');
});

test('the default view is used when config selects nothing', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'stats' }, REG), /\/stats\/system-stats\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'connections' }, REG), /connections-map\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'github' }, REG), /github\/pullrequests\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'clock' }, REG), /clock\/digital\.html/);
});

test('the viewField in widgetConfig selects the view file', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'stats', widgetConfig: { widgetSubType: 'disk-health' } }, REG), /disk-health\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'connections', widgetConfig: { view: 'vpn' } }, REG), /connections-vpn\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'github', widgetConfig: { githubView: 'contributions' } }, REG), /github\/contributions\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'clock', widgetConfig: { clockStyle: 'analog' } }, REG), /clock\/analog\.html/);
});

test('an unknown view value falls back to the first declared view', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'github', widgetConfig: { githubView: 'bogus' } }, REG), /pullrequests\.html/);
});

test('entryVersions become the ?v cache tag; absent versions omit it', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'clock' }, REG), /[?&]v=aa11aa11/);
  assert.doesNotMatch(widgetSrc({ id: 'a', widgetType: 'stats' }, REG), /[?&]v=/);
});

test('the widget id is URL-encoded into the src', () => {
  const src = widgetSrc({ id: 'a b/c', widgetType: 'clock' }, REG);
  assert.match(src, /id=a%20b%2Fc/);
});

test('size comes from the item, falling back to the first declared size', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'stats', widgetSize: 'medium' }, REG), /[?&]size=medium/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'stats' }, REG), /[?&]size=small/);
});

test('opts.mobile appends the mobile flag', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'backup' }, REG, { mobile: true }), /[?&]mobile=1/);
  assert.doesNotMatch(widgetSrc({ id: 'a', widgetType: 'backup' }, REG), /[?&]mobile=1/);
});

test('the geometry tables cover the same set of sizes', () => {
  const sizes = Object.keys(WIDGET_DESIGN).sort();
  for (const table of [WIDGET_HEIGHTS, WIDGET_COLS.desktop, WIDGET_COLS.mobile, WIDGET_ROWS.desktop, WIDGET_COST.desktop]) {
    assert.deepEqual(Object.keys(table).sort(), sizes);
  }
});
