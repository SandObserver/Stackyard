const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const widgets = require('../src/widgets');

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
  assert.deepEqual(widgets.loadRegistry(), {});
});

test('loadRegistry returns an empty registry when the directory is unreadable', (t) => {
  t.mock.method(process.stdout, 'write', () => true);
  t.mock.method(fs, 'readdirSync', () => { throw new Error('ENOENT'); });
  assert.deepEqual(widgets.loadRegistry(), {});
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

test('validateManifest accepts a repeated key when every declaration is conditional', () => {
  assert.deepEqual(errsFor([
    { key: 'type', type: 'select', label: 'Service', options: [{ value: 'a', label: 'A' }] },
    { key: 'url', type: 'text', label: 'Metrics URL', showIf: cond('a') },
    { key: 'url', type: 'text', label: 'Management API URL', showIf: cond('b') },
  ]), []);
});

test('validateManifest rejects a repeated key when one declaration is unconditional', () => {
  const errs = errsFor([
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
  const good = [{ key: 'url', type: 'text', label: 'A', showIf: cond('a') }, { key: 'url', type: 'text', label: 'B', showIf: cond('b') }];
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
