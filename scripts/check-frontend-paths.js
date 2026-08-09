#!/usr/bin/env node
/* Every module under ui/js needs two entries in tsconfig.frontend.json, the
   plain path and the cache-busted one, because TypeScript allows one wildcard
   per pattern (TS5061).

   A missing entry fails silently: the import resolves to nothing, that module
   goes unchecked, and typecheck:ui still passes. This makes it a failing check
   instead. */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'tsconfig.frontend.json');
const JS_DIR = path.join(ROOT, 'ui', 'js');

/* The config is JSON with comments, which JSON.parse will not take. Only block
   comments are used, and no string in the file contains the opening sequence.
   Checked below rather than assumed. */
function readConfig(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  try {
    return JSON.parse(stripped);
  } catch (e) {
    console.error(
      `check-frontend-paths: ${path.relative(ROOT, file)} did not parse after removing block comments: ${e.message}`,
    );
    process.exit(1);
  }
}

const cfg = readConfig(CONFIG);
const paths = cfg.compilerOptions?.paths;
if (!paths || typeof paths !== 'object') {
  console.error('check-frontend-paths: tsconfig.frontend.json has no compilerOptions.paths');
  process.exit(1);
}

const modules = fs
  .readdirSync(JS_DIR)
  .filter(f => f.endsWith('.js'))
  .sort();
if (!modules.length) {
  console.error('check-frontend-paths: no modules found under ui/js, which cannot be right');
  process.exit(1);
}

const missing = [];
for (const file of modules) {
  const plain = `/js/${file}`;
  const busted = `${plain}?v=*`;
  if (!(plain in paths)) missing.push(plain);
  if (!(busted in paths)) missing.push(busted);
}

/* The other direction: an entry left behind after a module is renamed or
   deleted resolves to a file that is not there, which is silent in the same
   way. */
const known = new Set(modules.flatMap(f => [`/js/${f}`, `/js/${f}?v=*`]));
const stale = Object.keys(paths)
  .filter(p => p.startsWith('/js/') && !known.has(p))
  .sort();

if (missing.length || stale.length) {
  console.error('check-frontend-paths: tsconfig.frontend.json does not match ui/js.');
  if (missing.length) {
    console.error('\n  Missing entries (add both forms, each mapping to the file):');
    for (const p of missing) console.error(`    "${p}": ["./ui/js/${path.basename(p.split('?')[0])}"],`);
  }
  if (stale.length) {
    console.error('\n  Entries with no matching file:');
    for (const p of stale) console.error(`    ${p}`);
  }
  process.exit(1);
}

console.log(`check-frontend-paths: ${modules.length} modules, both entries present for each`);
