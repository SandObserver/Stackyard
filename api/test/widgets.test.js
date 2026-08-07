const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const widgets = require('../src/widgets');
const { plain } = require('../test-support/plain');

function dir(name) { return { name, isDirectory: () => true }; }

/* Drive loadRegistry against a mocked filesystem: a valid folder widget, one
   with an invalid manifest, and a plain folder with no widget.json. */
function mountFs(t, manifests) {
  t.mock.method(process.stdout, 'write', () => true); // silence registry logs
  t.mock.method(fs, 'readdirSync', () =>
    Object.keys(manifests).map(dir).concat([{ name: 'plain', isDirectory: () => true },
                                             { name: 'afile', isDirectory: () => false }]));
  t.mock.method(fs, 'existsSync', (p) => {
    if (p.endsWith('plain/widget.json') || p.endsWith('afile/widget.json')) return false;
    if (p.endsWith('widget.json')) return true;
    if (p.endsWith('good/data.js')) return true;
    return false;
  });
  t.mock.method(fs, 'readFileSync', (p) => {
    for (const name of Object.keys(manifests))
      if (p.includes(`/${name}/`) || p.includes(`${name}/widget.json`)) return manifests[name];
    throw new Error('unexpected read ' + p);
  });
}

test('loadRegistry includes a valid manifest and records its data function', (t) => {
  mountFs(t, {
    good: JSON.stringify({ name: 'good', label: 'Good', sizes: ['small', 'medium'] }),
  });
  const reg = widgets.loadRegistry();
  assert.ok(reg.good, 'valid widget should be registered');
  assert.equal(reg.good.hasDataFn, true);
  assert.deepEqual(reg.good.manifest.sizes, ['small', 'medium']);
});

test('loadRegistry skips a manifest that fails validation', (t) => {
  mountFs(t, {
    good: JSON.stringify({ name: 'good', label: 'Good', sizes: ['small'] }),
    bad:  JSON.stringify({ name: 'bad', label: 'Bad', sizes: ['enormous'] }),
  });
  const reg = widgets.loadRegistry();
  assert.ok(reg.good);
  assert.equal(reg.bad, undefined, 'unknown size should disqualify the widget');
});

test('loadRegistry skips a widget whose name does not match its folder', (t) => {
  mountFs(t, {
    good: JSON.stringify({ name: 'mismatch', label: 'X', sizes: ['small'] }),
  });
  assert.equal(widgets.loadRegistry().good, undefined);
});

test('loadRegistry survives invalid JSON without throwing', (t) => {
  mountFs(t, { good: '{ not valid json' });
  assert.deepEqual(plain(widgets.loadRegistry()), {});
});

/* ── P5-8: the registry answered lookups with inherited properties ──────────
   Every caller resolves a widget by the `widgetType` stored in config. On an
   object literal that lookup found "constructor", "toString" and the rest, so a
   config naming one got a truthy value that is not a registry entry and the
   "unknown widget type" branch never ran: /api/widget-data answered 503 "widget
   declares no data source" instead of 404, and widget-secrets treated the item
   as recognised rather than withholding its config. */

test('the registry does not answer a lookup for an inherited member', (t) => {
  mountFs(t, { good: JSON.stringify({ name: 'good', label: 'Good', sizes: ['small'] }) });
  const reg = widgets.loadRegistry();
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty',
    'isPrototypeOf', 'propertyIsEnumerable', '__proto__']) {
    assert.equal(reg[name], undefined, name);
  }
  assert.ok(reg.good, 'and a real widget still resolves');
});

test('loadRegistry returns an empty registry when the directory is unreadable', (t) => {
  t.mock.method(process.stdout, 'write', () => true);
  t.mock.method(fs, 'readdirSync', () => { throw new Error('ENOENT'); });
  assert.deepEqual(plain(widgets.loadRegistry()), {});
});

/* ── Field type validation ──────────────────────────────────────────────── */

const base = { name: 'w', label: 'W', sizes: ['small'] };
const errsFor = fields => widgets.validateManifest('w', Object.assign({}, base, { fields })).errors;

test('validateManifest accepts a color field', () => {
  assert.deepEqual(errsFor([{ key: 'tint', type: 'color', label: 'Tint' }]), []);
});

test('validateManifest accepts a color field inside a group', () => {
  assert.deepEqual(errsFor([
    { key: 'slots', type: 'group', label: 'Slots', fields: [{ key: 'tint', type: 'color', label: 'Tint' }] },
  ]), []);
});

test('validateManifest still rejects an unknown field type', () => {
  const errs = errsFor([{ key: 'tint', type: 'colour', label: 'Tint' }]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /unknown type "colour"/);
});

/* ── Repeated sibling keys ──────────────────────────────────────────────── */

const cond = v => ({ field: 'type', equals: v });
/* The field cond() points at. A showIf must name a sibling, so every fixture
   using cond() has to declare it. */
const typeField = { key: 'type', type: 'select', label: 'Service', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };

test('validateManifest accepts a repeated key when every declaration is conditional', () => {
  assert.deepEqual(errsFor([
    { key: 'type', type: 'select', label: 'Service', options: [{ value: 'a', label: 'A' }] },
    { key: 'url', type: 'text', label: 'Metrics URL', showIf: cond('a') },
    { key: 'url', type: 'text', label: 'Management API URL', showIf: cond('b') },
  ]), []);
});

test('validateManifest rejects a repeated key when one declaration is unconditional', () => {
  const errs = errsFor([
    typeField,
    { key: 'url', type: 'text', label: 'Metrics URL', showIf: cond('a') },
    { key: 'url', type: 'text', label: 'URL' },
  ]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /"url" is declared more than once/);
});

test('validateManifest reports a repeated key once, not once per declaration', () => {
  const errs = errsFor([
    { key: 'url', type: 'text', label: 'A' },
    { key: 'url', type: 'text', label: 'B' },
    { key: 'url', type: 'text', label: 'C' },
  ]);
  assert.equal(errs.length, 1);
});

test('validateManifest applies the rule inside a group and inside an object', () => {
  const bad = [{ key: 'url', type: 'text', label: 'A' }, { key: 'url', type: 'text', label: 'B' }];
  const good = [typeField, { key: 'url', type: 'text', label: 'A', showIf: cond('a') }, { key: 'url', type: 'text', label: 'B', showIf: cond('b') }];
  assert.match(errsFor([{ key: 'svcs', type: 'group', label: 'Services', fields: bad }])[0], /svcs: key "url"/);
  assert.match(errsFor([{ key: 'vpn', type: 'object', label: 'VPN', fields: bad }])[0], /vpn: key "url"/);
  assert.deepEqual(errsFor([{ key: 'svcs', type: 'group', label: 'Services', fields: good }]), []);
});

test('a key repeated across different levels is not a conflict', () => {
  assert.deepEqual(errsFor([
    { key: 'url', type: 'text', label: 'URL' },
    { key: 'vpn', type: 'object', label: 'VPN', fields: [{ key: 'url', type: 'text', label: 'URL' }] },
  ]), []);
});

/* ── Per-view sizes ─────────────────────────────────────────────────────── */

const withViews = views => widgets.validateManifest('w', {
  name: 'w', label: 'W', sizes: ['small', 'medium'], viewField: 'view', views,
  /* viewField has to name a real field offering exactly the view keys. */
  fields: [{ key: 'view', type: 'select', label: 'View', options: Object.keys(views) }],
}).errors;

test('validateManifest accepts a view that narrows the size list', () => {
  assert.deepEqual(withViews({ a: { src: 'a.html', sizes: ['medium'] }, b: { src: 'b.html' } }), []);
});

test('validateManifest rejects a view size the widget does not offer', () => {
  const errs = withViews({ a: { src: 'a.html', sizes: ['large'] } });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /size "large" is not one of/);
});

test('validateManifest rejects an empty or non-array view size list', () => {
  assert.match(withViews({ a: { src: 'a.html', sizes: [] } })[0], /non-empty array/);
  assert.match(withViews({ a: { src: 'a.html', sizes: 'medium' } })[0], /non-empty array/);
});

/* ── Picklist ───────────────────────────────────────────────────────────── */

test('validateManifest accepts a picklist with a fixed count', () => {
  assert.deepEqual(errsFor([{ key: 'bays', type: 'picklist', label: 'Bay', optionsFrom: 'devices', count: 4 }]), []);
});

test('validateManifest accepts a picklist counted by size', () => {
  assert.deepEqual(errsFor([{ key: 'bays', type: 'picklist', label: 'Bay', optionsFrom: 'devices', countBySize: { small: 4, medium: 10 } }]), []);
});

test('validateManifest rejects a picklist with no count', () => {
  const errs = errsFor([{ key: 'bays', type: 'picklist', label: 'Bay', optionsFrom: 'devices' }]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /needs "count" or "countBySize"/);
});

test('validateManifest rejects a picklist with no option source', () => {
  const errs = errsFor([{ key: 'bays', type: 'picklist', label: 'Bay', count: 4 }]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /needs "options" or "optionsFrom"/);
});

test('a manifest card must be one of the known names, at either level', () => {
  const base = { name: 'w', label: 'W', sizes: ['small'] };
  assert.deepEqual(widgets.validateManifest('w', { ...base, card: 'dark' }).errors, []);
  assert.match(widgets.validateManifest('w', { ...base, card: 'chartreuse' }).errors.join(), /unknown card/);
  const withView = c => ({ ...base, views: { a: { src: 'a.html', card: c } } });
  assert.deepEqual(widgets.validateManifest('w', withView('translucent')).errors, []);
  assert.match(widgets.validateManifest('w', withView('nope')).errors.join(), /unknown card/);
});

/* ── P5-9: showIf was never validated ────────────────────────────────────────
   Every way it can be wrong fails silently. visibleFieldKeys resolves a
   condition against its sibling set, so a showIf naming nothing reads undefined,
   never matches, and hides the field for good, which reads as a missing feature
   rather than a typo. A showIf that is not an object also satisfies the
   repeated-key rule while carrying no condition, hiding both declarations. */

test('validateManifest rejects a showIf naming a field that does not exist', () => {
  const errs = errsFor([
    { key: 'provider', type: 'select', label: 'P', options: ['a'] },
    { key: 'url', type: 'text', label: 'U', showIf: { field: 'provdier', equals: 'a' } },
  ]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /"showIf" on "provdier", which is not one of its sibling fields/);
});

test('validateManifest rejects a showIf that is not an object', () => {
  for (const bad of [true, 'provider', 42, ['provider'], null]) {
    const errs = errsFor([{ key: 'a', type: 'text', label: 'A', showIf: bad }]);
    assert.ok(errs.some(e => /"showIf" that is not an object/.test(e)), JSON.stringify(bad));
  }
});

test('validateManifest rejects a showIf with no condition', () => {
  const errs = errsFor([typeField, { key: 'u', type: 'text', label: 'U', showIf: { field: 'type' } }]);
  assert.ok(errs.some(e => /"showIf" needs "equals" or "in"/.test(e)), errs.join('; '));
});

test('validateManifest rejects an empty or non-array showIf.in', () => {
  for (const bad of [[], 'a', {}]) {
    const errs = errsFor([typeField, { key: 'u', type: 'text', label: 'U', showIf: { field: 'type', in: bad } }]);
    assert.ok(errs.some(e => /"showIf\.in" must be a non-empty array/.test(e)), JSON.stringify(bad));
  }
});

test('validateManifest rejects a showIf on the field itself', () => {
  const errs = errsFor([{ key: 'u', type: 'text', label: 'U', showIf: { field: 'u', equals: 'x' } }]);
  assert.ok(errs.some(e => /"showIf" on itself/.test(e)), errs.join('; '));
});

/* Conditions resolve within a sibling set, so reaching out of a group is the
   dangling case again rather than a supported cross-level reference. */
test('validateManifest rejects a group sub-field conditioned on a top-level field', () => {
  const errs = errsFor([
    typeField,
    { key: 'svcs', type: 'group', label: 'Services', fields: [
      { key: 'url', type: 'text', label: 'U', showIf: { field: 'type', equals: 'a' } },
    ] },
  ]);
  assert.ok(errs.some(e => /svcs: field "url" has a "showIf" on "type"/.test(e)), errs.join('; '));
});

test('validateManifest accepts every showIf shape the shipped widgets use', () => {
  assert.deepEqual(errsFor([
    typeField,
    { key: 'one', type: 'text', label: 'One', showIf: { field: 'type', equals: 'a' } },
    { key: 'many', type: 'text', label: 'Many', showIf: { field: 'type', in: ['a', 'b'] } },
    { key: 'off', type: 'text', label: 'Off', showIf: { field: 'type', equals: false } },
  ]), []);
});

/* ── P5-10: viewField was checked for type but not for reference ─────────────
   widget-types.js reads widgetConfig[viewField], so a name that matches no
   field is permanently undefined: the widget pins to defaultView and the view
   selector does nothing. An option with no matching view selects a view that
   does not exist. */

const withViewField = (viewField, fields, views) => widgets.validateManifest('w', {
  name: 'w', label: 'W', sizes: ['small'], viewField, views, fields,
}).errors;

const TWO_VIEWS = { vpn: { src: 'v.html' }, map: { src: 'm.html' } };

test('validateManifest rejects a viewField naming no declared field', () => {
  const errs = withViewField('veiw', [{ key: 'view', type: 'select', label: 'V', options: ['vpn', 'map'] }], TWO_VIEWS);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /"viewField" \("veiw"\) is not a declared field/);
});

test('validateManifest rejects a view no option can select', () => {
  const errs = withViewField('view', [{ key: 'view', type: 'select', label: 'V', options: ['vpn', 'graph'] }], TWO_VIEWS);
  assert.ok(errs.some(e => /view "map" cannot be selected/.test(e)), errs.join('; '));
  assert.ok(errs.some(e => /offers "graph", which is not a declared view/.test(e)), errs.join('; '));
});

test('validateManifest accepts a viewField whose options are exactly the views', () => {
  assert.deepEqual(withViewField('view', [{ key: 'view', type: 'select', label: 'V', options: ['vpn', 'map'] }], TWO_VIEWS), []);
});

test('validateManifest accepts the { value, label } option shape', () => {
  assert.deepEqual(withViewField('view', [{ key: 'view', type: 'select', label: 'V',
    options: [{ value: 'vpn', label: 'VPN' }, { value: 'map', label: 'Map' }] }], TWO_VIEWS), []);
});

/* A runtime-populated selector has nothing to compare against here. */
test('validateManifest does not check the views against an optionsFrom field', () => {
  assert.deepEqual(withViewField('view', [{ key: 'view', type: 'select', label: 'V', optionsFrom: 'modes' }], TWO_VIEWS), []);
});
