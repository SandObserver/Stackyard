import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from '../js/html.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'widgets/connections/connections-vpn.html'), 'utf8');
const scripts = [...source.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const dataScript = scripts.find(s => s.includes('window.__DOTS='));
const moduleScript = scripts.find(s => /^import /m.test(s));
const importLine = /^import \{([^}]+)\} from '[^']+';$/m;
const toolboxNames = moduleScript
  .match(importLine)[1]
  .split(',')
  .map(s => s.trim());
const body = moduleScript.replace(importLine, '');

function node() {
  const n = {
    innerHTML: '',
    textContent: '',
    className: '',
    attrs: {},
    children: [],
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) {
      n.attrs[k] = v;
    },
    appendChild(c) {
      n.children.push(c);
      return c;
    },
    append(...c) {
      n.children.push(...c);
    },
    replaceChildren(...c) {
      n.children = c;
    },
    getContext: () => new Proxy({}, { get: () => () => {} }),
    getBoundingClientRect: () => ({ width: 300, height: 150 }),
  };
  return n;
}

async function mountVpn() {
  const els = {};
  const document = {
    getElementById: id => {
      els[id] ??= node();
      return els[id];
    },
    createElement: () => node(),
    body: node(),
    documentElement: node(),
  };
  const window = {};
  new Function('window', dataScript)(window);
  let pollOpts;
  const toolbox = {
    readableInk: () => '#000000',
    poll: opts => {
      pollOpts = opts;
      return { stop() {} };
    },
    fetchData: async () => ({}),
    linkTo() {},
    esc,
    loadStrings: async () => {},
    wt: (_key, fallback) => fallback,
    wtCount: (_key, count) => String(count),
    formatNumber: String,
    errorLine: () => 'Unavailable',
    placeholder: () => '',
    whileOnScreen() {},
  };
  const AsyncFunction = (async () => {}).constructor;
  const run = new AsyncFunction(
    'window',
    'document',
    'location',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'addEventListener',
    ...toolboxNames,
    body,
  );
  await run(
    window,
    document,
    { search: '?id=test' },
    () => 0,
    () => {},
    () => {},
    ...toolboxNames.map(n => toolbox[n]),
  );
  return { render: d => pollOpts.render(d), wrap: els.wrap };
}

const HOSTILE = '<img src=x onerror=alert(1)>';

const cases = [
  ['city', { connected: true, city: HOSTILE, country: 'Norway' }],
  ['country', { connected: true, city: 'Oslo', country: HOSTILE }],
  ['IP', { connected: true, ip: HOSTILE }],
  ['organisation', { connected: true, org: HOSTILE }],
  ['name', { connected: true, name: HOSTILE }],
  ['NetBird hostname metric', { service: 'netbird', connected: true, peersConnected: 2, hostname: HOSTILE }],
  ['NetBird hostname place', { service: 'netbird', connected: true, hostname: HOSTILE }],
];

for (const [field, data] of cases) {
  test(`an upstream ${field} is shown as text, never as markup`, async () => {
    const { render, wrap } = await mountVpn();
    render(data);
    assert.ok(!wrap.innerHTML.includes('<img'), `the ${field} reached the card as markup`);
    const shown = field === 'name' ? esc(HOSTILE).toUpperCase() : esc(HOSTILE);
    assert.ok(wrap.innerHTML.includes(shown), `the ${field} is not shown at all`);
  });
}

test('an upstream error message is never drawn', async () => {
  const { render, wrap } = await mountVpn();
  render({ error: HOSTILE, errorKind: 'network', connected: false });
  assert.ok(!wrap.innerHTML.includes('img'), 'the error text reached the card');
  assert.ok(wrap.innerHTML.includes('Unavailable'));
});
