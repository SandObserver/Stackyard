const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateManifest } = require('../src/widgets');

/* The shipped manifests, checked against the same validator the server uses at
   startup. Without this a typo only shows up as a widget silently missing from
   a running container. */
const WIDGETS_DIR = path.join(__dirname, '..', '..', 'ui', 'widgets');

function widgetFolders() {
  return fs.readdirSync(WIDGETS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(WIDGETS_DIR, e.name, 'widget.json')))
    .map(e => e.name);
}

test('every widget folder ships a widget.json', () => {
  const missing = fs.readdirSync(WIDGETS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !fs.existsSync(path.join(WIDGETS_DIR, e.name, 'widget.json')))
    .map(e => e.name);
  assert.deepEqual(missing, [], `widget folders without a manifest: ${missing.join(', ')}`);
});

for (const name of widgetFolders()) {
  test(`${name}: widget.json is valid`, () => {
    const raw = fs.readFileSync(path.join(WIDGETS_DIR, name, 'widget.json'), 'utf8');
    let manifest;
    assert.doesNotThrow(() => { manifest = JSON.parse(raw); }, `${name}/widget.json is not valid JSON`);
    const { errors } = validateManifest(name, manifest);
    assert.deepEqual(errors, [], `${name}/widget.json: ${errors.join('; ')}`);
  });
}

test('the widget template manifest is valid', () => {
  const dir = path.join(__dirname, '..', '..', 'docs', 'widget-template');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'widget.json'), 'utf8'));
  const { errors } = validateManifest(manifest.name, manifest);
  assert.deepEqual(errors, [], `widget-template: ${errors.join('; ')}`);
});
