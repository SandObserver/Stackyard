const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('@typescript/typescript6');

const SRC = path.join(__dirname, '..', 'src');
const UI_JS = path.join(__dirname, '..', '..', 'ui', 'js');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

function resolveSpecifier(from, spec) {
  const bare = spec.split('?')[0];
  let target;
  if (bare.startsWith('/js/')) target = path.join(UI_JS, bare.slice(4));
  else if (bare.startsWith('.')) target = path.resolve(path.dirname(from), bare);
  else return null;
  for (const p of [target, `${target}.js`, path.join(target, 'index.js')]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  throw new Error(`${path.relative(SRC, from)}: cannot resolve "${spec}"`);
}

/* preProcessFile reads every require() call and import, including those inside functions. */
function requireGraph() {
  const graph = new Map();
  const queue = sourceFiles(SRC);
  while (queue.length) {
    const file = queue.pop();
    if (graph.has(file)) continue;
    const { importedFiles } = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true);
    const deps = importedFiles
      .map(f => resolveSpecifier(file, f.fileName))
      .filter(p => p && p.endsWith('.js') && !p.includes(`${path.sep}node_modules${path.sep}`));
    graph.set(file, new Set(deps));
    queue.push(...deps);
  }
  return graph;
}

function cycles(graph) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const found = [];
  const visit = v => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) || []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) !== idx.get(v)) return;
    const scc = [];
    let w;
    do {
      w = stack.pop();
      onStack.delete(w);
      scc.push(w);
    } while (w !== v);
    if (scc.length > 1 || graph.get(v)?.has(v)) found.push(scc);
  };
  for (const v of graph.keys()) if (!idx.has(v)) visit(v);
  return found;
}

const rel = p => path.relative(path.join(SRC, '..', '..'), p);

test('the graph reaches requires inside functions and the ui/js modules', () => {
  const graph = requireGraph();
  assert.ok(graph.size > 40, `only ${graph.size} modules found`);
  const config = graph.get(path.join(SRC, 'config.js'));
  assert.ok(config.has(path.join(SRC, 'widget-secrets.js')), 'the lazy require in config.js was missed');
  assert.ok(
    [...graph.keys()].some(p => p.startsWith(UI_JS)),
    'no ui/js module is in the graph',
  );
});

test('no require cycle among the API modules', () => {
  const found = cycles(requireGraph()).map(scc => scc.map(rel).sort());
  assert.deepEqual(found, [], `require cycles:\n${found.map(c => `  ${c.join(', ')}`).join('\n')}`);
});
