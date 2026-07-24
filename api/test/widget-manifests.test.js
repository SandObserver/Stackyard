const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateManifest } = require('../src/widgets');

/* The shipped manifests, checked against the same validator the server uses at
   startup. Without this a typo only shows up as a widget silently missing from
   a running container. */
const WIDGETS_DIR = path.join(__dirname, '..', '..', 'ui', 'widgets');

/* Every top-level key a manifest may carry. The validator ignores keys it does
   not know, which lets the format grow, but means a typo like "veiws" reads as
   valid and the widget quietly falls back to index.html. Checking the shipped
   manifests here catches that at review time without making the runtime stricter.

   entryVersions is listed because scripts/bump-cache-busting.js writes it into
   the manifests inside the release image; it must never appear in a committed
   one, which the separate test below enforces. */
const KNOWN_KEYS = new Set([
  'name', 'label', 'sizes', 'fields',
  'views', 'viewField', 'defaultView', 'entryVersions',
]);

function unknownKeys(manifest) {
  return Object.keys(manifest).filter(k => !KNOWN_KEYS.has(k));
}

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

  test(`${name}: widget.json has no unrecognised top-level keys`, () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(WIDGETS_DIR, name, 'widget.json'), 'utf8'));
    const extra = unknownKeys(manifest);
    assert.deepEqual(extra, [], `${name}/widget.json: unrecognised key(s) ${extra.join(', ')}`);
  });

  test(`${name}: every declared view points at a file that exists`, () => {
    const dir = path.join(WIDGETS_DIR, name);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'widget.json'), 'utf8'));
    const missing = Object.entries(manifest.views || {})
      .filter(([, v]) => !fs.existsSync(path.join(dir, v.src)))
      .map(([key, v]) => `${key} -> ${v.src}`);
    assert.deepEqual(missing, [], `${name}/widget.json: view src not found: ${missing.join(', ')}`);
  });

  test(`${name}: widget.json carries no entryVersions`, () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(WIDGETS_DIR, name, 'widget.json'), 'utf8'));
    assert.equal('entryVersions' in manifest, false,
      `${name}/widget.json: entryVersions is written into the image at release time and must not be committed`);
  });
}

test('the widget template manifest is valid', () => {
  const dir = path.join(__dirname, '..', '..', 'docs', 'widget-template');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'widget.json'), 'utf8'));
  const { errors } = validateManifest(manifest.name, manifest);
  assert.deepEqual(errors, [], `widget-template: ${errors.join('; ')}`);
  const extra = unknownKeys(manifest);
  assert.deepEqual(extra, [], `widget-template: unrecognised key(s) ${extra.join(', ')}`);
});
