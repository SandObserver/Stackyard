#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UI_DIR = path.join(__dirname, '..', 'ui');
/* An asset reference, with or without a version stamp.

   The stamp used to be required by this pattern, so a reference written without
   one was invisible to this script and stayed unstamped forever. A browser then
   kept serving that file from cache after an upgrade while every other file was
   refreshed, leaving one page running mixed versions.

   The stamp is optional here, so a new reference is picked up the first time
   this runs rather than being silently skipped. */
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

/* Some files reference each other (dashboard.js imports ui.js, which imports
   utils.js, etc). Each file's hash depends on the current on-disk content of
   the files it references, so rewriting in one pass can still leave stale
   hashes for anything processed before its dependency was updated. Repeat
   until a pass makes no changes. */
/* References that had no stamp before this run. Reported at the end so CI fails
   on a reference someone wrote without one, rather than the script quietly
   fixing it and the next person repeating the mistake. */
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

/* --check reports without writing. A check that modifies the tree is not a
   check: it would make CI pass by fixing the thing it is meant to report, and
   leave the working tree dirty. */
const CHECK_ONLY = process.argv.includes('--check');

const files = listFiles(UI_DIR, ['.html', '.js']);
const MAX_PASSES = 10;
let pass = 0;
let totalChangedFiles = 0;
let filesChangedThisPass = -1;

while (filesChangedThisPass !== 0) {
  /* Nothing is written in check mode, so a second pass would see the same work
     again and never converge. */
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

/* --check reports rather than accepts. The build runs this script before
   packaging, so an unstamped reference becomes a failing check instead of a file
   that silently never cache-busts. */
if (unstamped.length) {
  const unique = [...new Set(unstamped)];
  console.error(`bump-cache-busting: ${unique.length} reference(s) had no ?v= stamp:`);
  for (const u of unique) console.error(`  ${u}`);
  if (CHECK_ONLY) console.error('Add ?v=1 to each; this script keeps the value current from then on.');
}

/* Widget iframe entry files are referenced indirectly: the dashboard builds each
   URL from the manifest, not from a literal string in code, so the pass above
   cannot reach them. Stamp each widget's entry files by content hash into its
   manifest under `entryVersions` instead, so the dashboard cache-busts them
   without a hand-maintained number. Entry files are the manifest's view srcs,
   or index.html when the widget declares no views. */
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
    /* Only when something actually changed. Rewriting unconditionally reformats
       every manifest on every run, which buries a real change in noise. */
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

/* Reported last, so one run lists everything that needs attention rather than
   stopping at the first problem. */
if (CHECK_ONLY) {
  /* Manifests are reported but do not fail the check. They are stamped by the
     release build, so they are expected to be out of date in a working tree and
     failing on that would make the check useless day to day. An unstamped asset
     reference is different: it is written by hand and never becomes correct on
     its own. */
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
