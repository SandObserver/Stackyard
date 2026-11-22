#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_DIR = path.join(__dirname, '..');
const UI_DIR = path.join(REPO_DIR, 'ui');
const TEMPLATE_DIR = path.join(REPO_DIR, 'docs', 'widget-template');
/* An asset reference, with or without a version stamp. The stamp must stay
   optional, or a reference written without one is invisible here and keeps
   being served from cache after an upgrade. */
const REF_RE = /(["'])(\/(?:css|js)\/[a-zA-Z0-9_.-]+\.(?:css|js))(\?v=[0-9a-zA-Z]+)?/g;

/* A widget page's own script, named relative to the page. The page is cached
   for a year under a stamp of its own content, so this stamp is what makes a
   change to the script change the page. */
const PAGE_SCRIPT_RE = /(\bsrc=)(["'])([a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.js)(\?v=[0-9a-zA-Z]+)?\2/g;
const WIDGET_PAGES_DIR = path.join(UI_DIR, 'widgets') + path.sep;

function listFiles(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) listFiles(full, exts, out);
    else if (exts.some(e => name.endsWith(e))) out.push(full);
  }
  return out;
}

function hashOfFile(full, name) {
  if (!fs.existsSync(full)) throw new Error(`Referenced asset does not exist: ${name}`);
  return crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 8);
}

function hashFor(assetPath) {
  return hashOfFile(path.join(UI_DIR, assetPath), assetPath);
}

function isWidgetPage(file) {
  return file.startsWith(WIDGET_PAGES_DIR) && file.endsWith('.html');
}

function referencesIn(text, file) {
  const found = [];
  const re = new RegExp(REF_RE.source, 'g');
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    found.push({ name: m[2], stamp: m[3], hash: () => hashFor(m[2]) });
  }
  if (isWidgetPage(file)) {
    const local = new RegExp(PAGE_SCRIPT_RE.source, 'g');
    for (let m = local.exec(text); m !== null; m = local.exec(text)) {
      const name = m[3];
      found.push({ name, stamp: m[4], hash: () => hashOfFile(path.join(path.dirname(file), name), name) });
    }
  }
  return found;
}

function stampAll(text, file) {
  let out = text.replace(REF_RE, (_match, quote, assetPath) => `${quote}${assetPath}?v=${hashFor(assetPath)}`);
  if (isWidgetPage(file)) {
    out = out.replace(
      PAGE_SCRIPT_RE,
      (_match, attr, quote, name) =>
        `${attr}${quote}${name}?v=${hashOfFile(path.join(path.dirname(file), name), name)}${quote}`,
    );
  }
  return out;
}

/* Each file's hash depends on the on-disk content of the files it references,
   so one pass can leave stale hashes. Repeat until a pass makes no changes. */
/* References that had no stamp before this run. */
const unstamped = [];
/* References whose stamp does not match the content it names. */
const stale = [];
/* Manifests whose entryVersions no longer match their entry files. */
const staleManifests = [];

function findUnstamped(text, file) {
  return referencesIn(text, file)
    .filter(r => !r.stamp)
    .map(r => `${path.relative(REPO_DIR, file)} references ${r.name} without ?v=`);
}

/* A stamp that names content the file no longer has. The browser keeps serving
   the cached copy, so the page runs a mix of versions after an upgrade. This is
   the same failure an unstamped reference causes, and it has to fail the check
   for the same reason. */
function findStale(text, file) {
  const found = [];
  for (const r of referencesIn(text, file)) {
    if (!r.stamp) continue; /* reported as unstamped instead */
    const want = `?v=${r.hash()}`;
    if (r.stamp !== want) {
      found.push(`${path.relative(REPO_DIR, file)} references ${r.name}${r.stamp}, but its content is ${want}`);
    }
  }
  return found;
}

/* --check must not write. A check that modifies the tree makes CI pass by
   fixing the thing it reports. */
const CHECK_ONLY = process.argv.includes('--check');
const RELEASE = process.argv.includes('--release') && !CHECK_ONLY;

const files = listFiles(UI_DIR, ['.html', '.js']);
if (fs.existsSync(TEMPLATE_DIR)) listFiles(TEMPLATE_DIR, ['.html', '.js'], files);
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
    if (CHECK_ONLY) stale.push(...findStale(original, file));
    const updated = stampAll(original, file);
    if (updated !== original) {
      if (!CHECK_ONLY) fs.writeFileSync(file, updated, 'utf8');
      filesChangedThisPass++;
      totalChangedFiles++;
    }
  }
}

console.log(`bump-cache-busting: stable after ${pass} pass(es), ${totalChangedFiles} file write(s)`);

if (unstamped.length && !CHECK_ONLY) {
  const unique = [...new Set(unstamped)];
  console.log(`bump-cache-busting: added a ?v= stamp to ${unique.length} reference(s):`);
  for (const u of unique) console.log(`  ${u.replace(/ without \?v=$/, '')}`);
}

/* The dashboard builds a widget's iframe URL from the manifest, not from a
   literal in code, so the pass above cannot reach those files. Stamp them by
   content hash into the manifest under `entryVersions`. */
const WIDGETS_DIR = path.join(UI_DIR, 'widgets');
/* A cached widget page keeps the headers it was served with, including its
   Content-Security-Policy. The stamp must cover the files that set them, or a
   header change does not reach a page whose body is unchanged. */
const WIDGET_HEADER_FILES = ['dashboard.conf', 'security-headers.conf'].map(f =>
  path.join(__dirname, '..', 'nginx', f),
);

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
    const entries = manifest.views ? [...new Set(Object.values(manifest.views).map(v => v.src))] : ['index.html'];
    const versions = {};
    for (const file of entries) {
      const full = path.join(dir, file);
      if (!fs.existsSync(full)) throw new Error(`Widget "${ent.name}" references a missing entry file: ${file}`);
      const hash = crypto.createHash('sha256').update(fs.readFileSync(full));
      for (const conf of WIDGET_HEADER_FILES) hash.update(fs.readFileSync(conf));
      versions[file] = hash.digest('hex').slice(0, 8);
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

if (CHECK_ONLY || RELEASE) stampWidgetManifests();

if (CHECK_ONLY) {
  /* Manifests are reported but must not fail the check: the release build
     stamps them, so a working tree is expected to be out of date. An unstamped
     asset reference is written by hand and never becomes correct on its own. */
  if (staleManifests.length) {
    console.log(`bump-cache-busting: ${staleManifests.length} widget manifest(s) will be stamped by the release build`);
  }
  const problems = [...new Set([...unstamped, ...stale])];
  if (problems.length) {
    console.error('bump-cache-busting --check failed:');
    for (const p of problems) console.error(`  ${p}`);
    console.error('Run `node scripts/bump-cache-busting.js` and commit the result.');
    process.exit(1);
  }
  console.log('bump-cache-busting: every asset reference is stamped and current');
}
