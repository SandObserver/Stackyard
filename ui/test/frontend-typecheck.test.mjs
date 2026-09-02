import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* The frontend is typechecked. With checkJs off, tsconfig.frontend.json only
   resolves the cache-busted import specifiers, and the test suite cannot see
   the class of mistake that matters most here: a name used before it is
   defined, a misspelled identifier, a property read off the wrong element type.

   Turning checkJs back off, or adding a module the project does not include,
   fails here rather than quietly restoring the blind spot. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cfgPath = path.join(root, 'tsconfig.frontend.json');
/* Comments are allowed in a tsconfig, so it is not plain JSON. Only the leading
   header block is stripped: a blanket comment strip would also eat part of the
   recursive glob in "include", which contains the same character sequence that
   opens and closes a block comment. */
const raw = fs.readFileSync(cfgPath, 'utf8');
const cfg = JSON.parse(raw.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ''));

test('the frontend project is actually a typecheck', () => {
  assert.equal(cfg.compilerOptions.checkJs, true, 'checkJs off makes this a path resolver, not a typecheck');
  assert.equal(cfg.compilerOptions.allowJs, true);
  assert.equal(cfg.compilerOptions.noEmit, true);
});

test('the DOM lib is available, since every module here touches it', () => {
  assert.ok(cfg.compilerOptions.lib.includes('dom'));
});

/* A module missing from paths resolves to nothing, and TypeScript reports the
   import rather than the code inside it, so a whole file can go unchecked. */
test('every module under ui/js has both path entries', () => {
  const paths = cfg.compilerOptions.paths;
  const modules = fs.readdirSync(path.join(root, 'ui', 'js')).filter(f => f.endsWith('.js'));
  assert.ok(modules.length > 20, `only ${modules.length} modules found`);

  const missing = [];
  for (const m of modules) {
    for (const key of [`/js/${m}`, `/js/${m}?v=*`]) {
      if (!paths[key]) missing.push(key);
      else if (paths[key][0] !== `./ui/js/${m}`) missing.push(`${key} points at ${paths[key][0]}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Add both the plain and the ?v=* form; TypeScript allows one wildcard per pattern:\n  ${missing.join('\n  ')}`,
  );
});

test('the project covers ui/js', () => {
  assert.deepEqual(cfg.include, ['ui/js/**/*.js']);
});

/* The check is only enforced if CI runs it. */
test('the shared checks action runs the frontend typecheck', () => {
  const action = fs.readFileSync(path.join(root, '.github', 'actions', 'checks', 'action.yml'), 'utf8');
  assert.match(action, /npm run typecheck:ui/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['typecheck:ui'], 'tsc -p tsconfig.frontend.json');
});
