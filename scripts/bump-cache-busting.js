#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UI_DIR = path.join(__dirname, '..', 'ui');
/* An asset reference, with or without a version stamp. The stamp must stay
   optional, or a reference written without one is invisible here and keeps
   being served from cache after an upgrade. */
const REF_RE = /(["'])(\/(?:css|js)\/[a-zA-Z0-9_.-]+\.(?:css|js))(\?v=[0-9a-zA-Z]+)?/g;

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

/* Each file's hash depends on the on-disk content of the files it references,
   so one pass can leave stale hashes. Repeat until a pass makes no changes. */
/* References that had no stamp before this run. */
const unstamped = [];
/* Manifests whose entryVersions no longer match their entry files. */
const staleManifests = [];

function findUnstamped(text, file) {
  const found = [];
  const re = new RegExp(REF_RE.source, 'g');
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (!m[3]) found.push(`${path.relative(UI_DIR, file)} references ${m[2]} without ?v=`);
  }
  return found;
}

/* --check must not write. A check that modifies the tree makes CI pass by
   fixing the thing it reports. */
const CHECK_ONLY = process.argv.includes('--check');

const files = listFiles(UI_DIR, ['.html', '.js']);
const MAX_PASSES = 10;
let pass = 0;
let totalChangedFiles = 0;
let filesChangedThisPass = -1;

while (filesChangedThisPass !== 0) {
  /* Nothing is written in check mode, so a second pass never converges. */
  if (CHECK_ONLY && pass > 0) break;
  if (++pass > MAX_PASSES) throw new Error(`Did not converge after ${MAX_PASSES} passes, check for a reference cycle`);
  filesChangedThisPass = 0;
  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    unstamped.push(...findUnstamped(original, file));
    const updated = original.replace(
      REF_RE,
      (_match, quote, assetPath) => `${quote}${assetPath}?v=${hashFor(assetPath)}`,
    );
    if (updated !== original) {
      if (!CHECK_ONLY) fs.writeFileSync(file, updated, 'utf8');
      filesChangedThisPass++;
      totalChangedFiles++;
    }
  }
}

console.log(`bump-cache-busting: stable after ${pass} pass(es), ${totalChangedFiles} file write(s)`);

if (unstamped.length) {
  const unique = [...new Set(unstamped)];
  console.error(`bump-cache-busting: ${unique.length} reference(s) had no ?v= stamp:`);
  for (const u of unique) console.error(`  ${u}`);
  if (CHECK_ONLY) console.error('Add ?v=1 to each; this script keeps the value current from then on.');
}

/* The dashboard builds a widget's iframe URL from the manifest, not from a
   literal in code, so the pass above cannot reach those files. Stamp them by
   content hash into the manifest under `entryVersions`. */
const WIDGETS_DIR = path.join(UI_DIR, 'widgets');

function stampWidgetManifests() {
  let dirents;
  try {
    dirents = fs.readdirSync(WIDGETS_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  let stamped = 0;
  for (const ent of dirents) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(WIDGETS_DIR, ent.name);
    const manPath = path.join(dir, 'widget.json');
    if (!fs.existsSync(manPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    const files = manifest.views ? [...new Set(Object.values(manifest.views).map(v => v.src))] : ['index.html'];
    const versions = {};
    for (const file of files) {
      const full = path.join(dir, file);
      if (!fs.existsSync(full)) throw new Error(`Widget "${ent.name}" references a missing entry file: ${file}`);
      versions[file] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 8);
    }
    /* Only when something changed. Rewriting unconditionally reformats every
       manifest on every run. */
    const current = JSON.stringify(manifest.entryVersions || {});
    if (current === JSON.stringify(versions)) continue;
    if (CHECK_ONLY) {
      staleManifests.push(ent.name);
      continue;
    }
    manifest.entryVersions = versions;
    fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    stamped++;
  }
  console.log(`bump-cache-busting: stamped ${stamped} widget manifest(s)`);
}

stampWidgetManifests();

if (CHECK_ONLY) {
  /* Manifests are reported but must not fail the check: the release build
     stamps them, so a working tree is expected to be out of date. An unstamped
     asset reference is written by hand and never becomes correct on its own. */
  if (staleManifests.length) {
    console.log(`bump-cache-busting: ${staleManifests.length} widget manifest(s) will be stamped by the build`);
  }
  const problems = [...new Set(unstamped)];
  if (problems.length) {
    console.error('bump-cache-busting --check failed:');
    for (const p of problems) console.error(`  ${p}`);
    console.error('Run `node scripts/bump-cache-busting.js` and commit the result.');
    process.exit(1);
  }
  console.log('bump-cache-busting: every asset reference is stamped');
}
