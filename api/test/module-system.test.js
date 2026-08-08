const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* The two halves of this project use different module systems, and mixing them
   fails at runtime rather than at review.

   CONTRIBUTING.md states the split. Biome now enforces one direction: an
   override sets noCommonJs to error under ui/js, so a require() there fails
   lint. Biome has no rule for the other direction, so an `import` in api/src is
   checked here instead.

   Note what is deliberately not covered. ui/widgets/<name>/data.js and demo.js
   live under ui/ but run on the server: the API loads them with require()
   (api/src/widget-data.js). They are CommonJS on purpose, which is why the lint
   override names ui/js rather than all of ui. */

const root = path.join(__dirname, '..', '..');

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/* A statement, not the word: `import` appears inside strings and comments, and
   a dynamic import() is legal in CommonJS. */
const ESM_STATEMENT = /^\s*(?:import\s+[\w{*][^\n]*from\s+['"]|import\s+['"]|export\s+(?:default|const|let|var|function|class|\{))/m;

test('no module under api/src uses ESM syntax', () => {
  const offenders = jsFiles(path.join(root, 'api', 'src'))
    .filter(f => ESM_STATEMENT.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(root, f));
  assert.deepEqual(offenders, [], 'the API is CommonJS; use require() and module.exports');
});

test('the scan would notice ESM if it appeared', () => {
  /* A checker that cannot fail is worse than none. */
  assert.match("import { x } from './y.js';", ESM_STATEMENT);
  assert.match("export default foo;", ESM_STATEMENT);
  assert.match("export function bar() {}", ESM_STATEMENT);
  assert.doesNotMatch("const x = require('./y');", ESM_STATEMENT);
  assert.doesNotMatch("/* import is mentioned here */", ESM_STATEMENT);
  assert.doesNotMatch("const mod = await import('./y.js');", ESM_STATEMENT);
});

test('the lint override covers ui/js and leaves widget data functions alone', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'biome.json'), 'utf8'));
  const rule = (cfg.overrides || []).find(o => o.linter?.rules?.style?.noCommonJs);
  assert.ok(rule, 'the noCommonJs override is gone');
  assert.deepEqual(rule.includes, ['ui/js/**/*.js']);
  assert.equal(rule.linter.rules.style.noCommonJs, 'error');
});

test('widget data functions are still CommonJS, because the server requires them', () => {
  /* If these ever became ESM the API could not load them, and the lint override
     above would have to change with them. */
  const widgets = path.join(root, 'ui', 'widgets');
  const dataFns = fs.readdirSync(widgets, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(widgets, d.name, 'data.js'))
    .filter(f => fs.existsSync(f));
  assert.ok(dataFns.length, 'no widget data functions found');
  for (const f of dataFns) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), ESM_STATEMENT,
      `${path.relative(root, f)} runs on the server and must stay CommonJS`);
  }
});
