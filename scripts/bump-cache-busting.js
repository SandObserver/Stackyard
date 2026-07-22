#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UI_DIR = path.join(__dirname, '..', 'ui');
const REF_RE = /(["'])(\/(?:css|js)\/[a-zA-Z0-9_.-]+\.(?:css|js))\?v=[0-9a-zA-Z]+/g;

function listFiles(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) listFiles(full, exts, out);
    else if (exts.some(e => name.endsWith(e))) out.push(full);
  }
  return out;
}

function hashFor(assetPath) {
  const full = path.join(UI_DIR, assetPath);
  if (!fs.existsSync(full)) throw new Error(`Referenced asset does not exist: ${assetPath}`);
  return crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 8);
}

/* Some files reference each other (dashboard.js imports ui.js, which imports
   utils.js, etc). Each file's hash depends on the current on-disk content of
   the files it references, so rewriting in one pass can still leave stale
   hashes for anything processed before its dependency was updated. Repeat
   until a pass makes no changes. */
const files = listFiles(UI_DIR, ['.html', '.js']);
const MAX_PASSES = 10;
let pass = 0;
let totalChangedFiles = 0;
let filesChangedThisPass = -1;

while (filesChangedThisPass !== 0) {
  if (++pass > MAX_PASSES) throw new Error(`Did not converge after ${MAX_PASSES} passes, check for a reference cycle`);
  filesChangedThisPass = 0;
  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    const updated = original.replace(REF_RE, (_match, quote, assetPath) => `${quote}${assetPath}?v=${hashFor(assetPath)}`);
    if (updated !== original) {
      fs.writeFileSync(file, updated, 'utf8');
      filesChangedThisPass++;
      totalChangedFiles++;
    }
  }
}

console.log(`bump-cache-busting: stable after ${pass} pass(es), ${totalChangedFiles} file write(s)`);

/* Widget iframe entry files are referenced indirectly: the dashboard builds each
   URL from the manifest, not from a literal string in code, so the pass above
   cannot reach them. Stamp each widget's entry files by content hash into its
   manifest under `entryVersions` instead, so the dashboard cache-busts them
   without a hand-maintained number. Entry files are the manifest's view srcs,
   or index.html when the widget declares no views. */
const WIDGETS_DIR = path.join(UI_DIR, 'widgets');

function stampWidgetManifests() {
  let dirents;
  try { dirents = fs.readdirSync(WIDGETS_DIR, { withFileTypes: true }); }
  catch { return; }
  let stamped = 0;
  for (const ent of dirents) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(WIDGETS_DIR, ent.name);
    const manPath = path.join(dir, 'widget.json');
    if (!fs.existsSync(manPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    const files = manifest.views
      ? [...new Set(Object.values(manifest.views).map(v => v.src))]
      : ['index.html'];
    const versions = {};
    for (const file of files) {
      const full = path.join(dir, file);
      if (!fs.existsSync(full)) throw new Error(`Widget "${ent.name}" references a missing entry file: ${file}`);
      versions[file] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 8);
    }
    manifest.entryVersions = versions;
    fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    stamped++;
  }
  console.log(`bump-cache-busting: stamped ${stamped} widget manifest(s)`);
}

stampWidgetManifests();
