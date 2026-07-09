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
  assert.equal(reg.good.customEditor, false);
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
