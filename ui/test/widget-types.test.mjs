import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { WIDGET_HEIGHTS, WIDGET_DESIGN, WIDGET_COLS, WIDGET_ROWS, widgetSrc, cardPreset, overlayHref } = await import(
  '../js/widget-types.js'
);
const { DEFAULT_WIDGET_SIZE } = await import('../js/limits.js');

/* Stand-in for the /api/widgets registry, keyed by widget name. Mirrors the
   shipped manifests' view routing; versions are illustrative. */
const REG = {
  clock: {
    sizes: ['small'],
    viewField: 'clockStyle',
    defaultView: 'digital',
    views: { digital: { src: 'digital.html' }, analog: { src: 'analog.html' } },
    entryVersions: { 'digital.html': 'aa11aa11', 'analog.html': 'bb22bb22' },
  },
  'system-summary': { sizes: ['small', 'medium'], views: null },
  connections: {
    sizes: ['small', 'medium'],
    viewField: 'view',
    defaultView: 'map',
    views: { map: { src: 'connections-map.html' }, vpn: { src: 'connections-vpn.html' } },
  },
  github: {
    sizes: ['small', 'medium', 'large', 'xlarge'],
    viewField: 'githubView',
    defaultView: 'prs',
    views: { prs: { src: 'pullrequests.html' }, contributions: { src: 'contributions.html' } },
  },
  dns: { sizes: ['small', 'medium'], views: null },
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
  assert.match(widgetSrc({ id: 'a', widgetType: 'connections' }, REG), /connections-map\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'github' }, REG), /github\/pullrequests\.html/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'clock' }, REG), /clock\/digital\.html/);
});

test('the viewField in widgetConfig selects the view file', () => {
  assert.match(
    widgetSrc({ id: 'a', widgetType: 'connections', widgetConfig: { view: 'vpn' } }, REG),
    /connections-vpn\.html/,
  );
  assert.match(
    widgetSrc({ id: 'a', widgetType: 'github', widgetConfig: { githubView: 'contributions' } }, REG),
    /github\/contributions\.html/,
  );
  assert.match(
    widgetSrc({ id: 'a', widgetType: 'clock', widgetConfig: { clockStyle: 'analog' } }, REG),
    /clock\/analog\.html/,
  );
});

test('an unknown view value falls back to the first declared view', () => {
  assert.match(
    widgetSrc({ id: 'a', widgetType: 'github', widgetConfig: { githubView: 'bogus' } }, REG),
    /pullrequests\.html/,
  );
});

test('entryVersions become the ?v cache tag; absent versions omit it', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'clock' }, REG), /[?&]v=aa11aa11/);
  assert.doesNotMatch(widgetSrc({ id: 'a', widgetType: 'system-summary' }, REG), /[?&]v=/);
});

test('the widget id is URL-encoded into the src', () => {
  const src = widgetSrc({ id: 'a b/c', widgetType: 'clock' }, REG);
  assert.match(src, /id=a%20b%2Fc/);
});

test('size comes from the item, falling back to the default size', () => {
  assert.equal(DEFAULT_WIDGET_SIZE, 'medium');
  assert.match(widgetSrc({ id: 'a', widgetType: 'system-summary', widgetSize: 'small' }, REG), /[?&]size=small/);
  assert.match(widgetSrc({ id: 'a', widgetType: 'system-summary' }, REG), /[?&]size=medium/);
});

test('the frame URL and every layout reader agree on the size of an item with no size', () => {
  const size = new URL(widgetSrc({ id: 'a', widgetType: 'system-summary' }, REG), 'http://x').searchParams.get('size');
  assert.equal(size, DEFAULT_WIDGET_SIZE);
  const readers = [
    ...fs
      .readdirSync(new URL('../js/', import.meta.url))
      .filter(f => f.endsWith('.js'))
      .map(f => `js/${f}`),
    '../api/src/routes/system.js',
  ];
  const reading = [];
  for (const file of readers) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const fallbacks = src.match(/widgetSize \|\| [^\s,;)]+/g) || [];
    if (fallbacks.length) reading.push(file);
    for (const f of fallbacks) assert.equal(f.split('|| ')[1], 'DEFAULT_WIDGET_SIZE', `${file}: ${f}`);
  }
  for (const file of ['js/dashboard-grid.js', 'js/ui.js', 'js/admin-list.js', 'js/admin-widget-form.js'])
    assert.ok(reading.includes(file), `${file} reads no widget size`);
});

test('opts.mobile appends the mobile flag', () => {
  assert.match(widgetSrc({ id: 'a', widgetType: 'backup' }, REG, { mobile: true }), /[?&]mobile=1/);
  assert.doesNotMatch(widgetSrc({ id: 'a', widgetType: 'backup' }, REG), /[?&]mobile=1/);
});

test('the geometry tables cover the same set of sizes', () => {
  const sizes = Object.keys(WIDGET_DESIGN).sort();
  for (const table of [
    WIDGET_HEIGHTS,
    WIDGET_COLS.desktop,
    WIDGET_COLS.mobile,
    WIDGET_ROWS.desktop,
    WIDGET_ROWS.mobile,
  ]) {
    assert.deepEqual(Object.keys(table).sort(), sizes);
  }
});

/* Registry shaped like the shipped manifests: a whole-widget card, a per-view
   card, and a widget that declares none. */
const CARD_REG = {
  books: { sizes: ['small'], card: 'dark' },
  clock: {
    sizes: ['small'],
    viewField: 'clockStyle',
    defaultView: 'digital',
    views: { digital: { src: 'a.html', card: 'dark' }, analog: { src: 'b.html' } },
  },
  connections: {
    sizes: ['medium'],
    viewField: 'view',
    defaultView: 'map',
    views: { map: { src: 'm.html', card: 'dark' }, vpn: { src: 'v.html', card: 'translucent' } },
  },
  weather: { sizes: ['small'] },
  odd: { sizes: ['small'], card: 'chartreuse' },
  mixed: {
    sizes: ['small'],
    viewField: 'v',
    defaultView: 'a',
    card: 'translucent',
    views: { a: { src: 'a.html' }, b: { src: 'b.html', card: 'dark' } },
  },
};

test('cardPreset reads a whole-widget card', () => {
  assert.equal(cardPreset({ widgetType: 'books' }, CARD_REG), 'dark');
});

test('cardPreset returns empty for a widget that declares none', () => {
  assert.equal(cardPreset({ widgetType: 'weather' }, CARD_REG), '');
});

test("cardPreset picks the selected view's card", () => {
  const item = t => ({ widgetType: 'connections', widgetConfig: { view: t } });
  assert.equal(cardPreset(item('map'), CARD_REG), 'dark');
  assert.equal(cardPreset(item('vpn'), CARD_REG), 'translucent');
});

test('cardPreset falls back to the default view when none is chosen', () => {
  assert.equal(cardPreset({ widgetType: 'connections' }, CARD_REG), 'dark');
});

test('a view without a card does not inherit one from a sibling view', () => {
  const item = { widgetType: 'clock', widgetConfig: { clockStyle: 'analog' } };
  assert.equal(cardPreset(item, CARD_REG), '');
});

test('a view without a card keeps the widget-level one', () => {
  assert.equal(cardPreset({ widgetType: 'mixed', widgetConfig: { v: 'a' } }, CARD_REG), 'translucent');
  assert.equal(cardPreset({ widgetType: 'mixed', widgetConfig: { v: 'b' } }, CARD_REG), 'dark');
});

test('cardPreset ignores an unknown name and an unknown widget', () => {
  assert.equal(cardPreset({ widgetType: 'odd' }, CARD_REG), '');
  assert.equal(cardPreset({ widgetType: 'nope' }, CARD_REG), '');
  assert.equal(cardPreset({}, CARD_REG), '');
});

test('a widget over several desktop rows is as tall as those rows and the gaps between them', () => {
  const ROW_GAP = 30;
  for (const sz of Object.keys(WIDGET_HEIGHTS)) {
    const rows = WIDGET_ROWS.desktop[sz] || 1;
    assert.equal(WIDGET_HEIGHTS[sz], rows * WIDGET_HEIGHTS.small + (rows - 1) * ROW_GAP, sz);
  }
});

const manifest = name =>
  JSON.parse(fs.readFileSync(new URL(`../widgets/${name}/widget.json`, import.meta.url), 'utf8'));
const SHIPPED = Object.fromEntries(
  ['disk-health', 'backup', 'weather', 'nowplaying', 'downloads', 'books', 'system-summary', 'connections'].map(n => [
    n,
    manifest(n),
  ]),
);
const HREFS = {
  scrutinyHref: 'https://scrutiny.lan',
  truenasHref: 'https://truenas.lan',
  unraidHref: 'https://unraid.lan',
};

test('the phone overlay opens the link field shown for the chosen provider', () => {
  const item = { widgetType: 'disk-health', widgetConfig: { diskProvider: 'truenas', ...HREFS } };
  assert.equal(overlayHref(item, SHIPPED), 'https://truenas.lan');
  item.widgetConfig.diskProvider = 'unraid';
  assert.equal(overlayHref(item, SHIPPED), 'https://unraid.lan');
});

test('the phone overlay reads the provider default when none is saved', () => {
  assert.equal(overlayHref({ widgetType: 'disk-health', widgetConfig: { ...HREFS } }, SHIPPED), 'https://scrutiny.lan');
});

test('the phone overlay skips an empty link and has none without a manifest', () => {
  const item = { widgetType: 'disk-health', widgetConfig: { diskProvider: 'truenas', scrutinyHref: 'https://s' } };
  assert.equal(overlayHref(item, SHIPPED), null);
  assert.equal(overlayHref({ widgetType: 'gone', widgetConfig: { ...HREFS } }, SHIPPED), null);
});

test('the phone overlay prefers the item address and ignores group-row links', () => {
  const item = { widgetType: 'disk-health', url: 'https://item', widgetConfig: { diskProvider: 'truenas', ...HREFS } };
  assert.equal(overlayHref(item, SHIPPED), 'https://item');
  const backup = { widgetType: 'backup', widgetConfig: { slots: [{ provider: 'duplicati', dupHref: 'https://d' }] } };
  assert.equal(overlayHref(backup, SHIPPED), null);
});

test('the phone overlay opens the plain href of a widget that marks it as its link', () => {
  for (const type of ['weather', 'nowplaying', 'downloads'])
    assert.equal(
      overlayHref({ widgetType: type, widgetConfig: { href: 'https://site.lan' } }, SHIPPED),
      'https://site.lan',
    );
});

test('the phone overlay leaves an unmarked href to the widget', () => {
  for (const type of ['books', 'system-summary', 'connections'])
    assert.equal(overlayHref({ widgetType: type, widgetConfig: { href: 'https://site.lan' } }, SHIPPED), null, type);
});
