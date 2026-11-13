import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from '../js/html.js';
import * as worldMap from '../widgets/connections/world-map.js';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location ??= { search: '' };
const { rgbOf } = await import('../js/widget-toolbox.js');
const world = { ...worldMap };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, 'widgets/connections', f), 'utf8');
const source = read('connections-vpn.html');
const scripts = [...source.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const moduleScript = scripts.find(s => /^import /m.test(s));
const importLine = /^import \{([^}]+)\} from '\/js\/widget-toolbox\.js[^']*';$/m;
const worldLine = /^import \{([^}]+)\} from '\.\/world-map\.js';$/m;
const names = line =>
  moduleScript
    .match(line)[1]
    .split(',')
    .map(s => s.trim());
const toolboxNames = names(importLine);
const worldNames = names(worldLine);
const body = moduleScript.replace(importLine, '').replace(worldLine, '');

function node() {
  const n = {
    innerHTML: '',
    textContent: '',
    className: '',
    attrs: {},
    children: [],
    props: {},
    arcs: 0,
    style: {
      setProperty(k, v) {
        n.props[k] = v;
      },
    },
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
    getContext: () => new Proxy({}, { get: (_, k) => (k === 'arc' ? () => n.arcs++ : () => {}) }),
    getBoundingClientRect: () => ({ width: 300, height: 150 }),
  };
  return n;
}

async function mountVpn() {
  const els = {};
  const created = [];
  const frames = [];
  const document = {
    getElementById: id => {
      els[id] ??= node();
      return els[id];
    },
    createElement: () => {
      const n = node();
      created.push(n);
      return n;
    },
    body: node(),
    documentElement: node(),
  };
  let pollOpts;
  const toolbox = {
    readableInk: () => '#000000',
    rgbOf,
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
    'document',
    'location',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'addEventListener',
    ...worldNames,
    ...toolboxNames,
    body,
  );
  await run(
    document,
    { search: '?id=test' },
    fn => frames.push(fn),
    () => {},
    () => {},
    ...worldNames.map(n => world[n]),
    ...toolboxNames.map(n => toolbox[n]),
  );
  return {
    render: d => pollOpts.render(d),
    wrap: els.wrap,
    accent: () => document.documentElement.props['--accent'],
    dotsDrawn: () => {
      for (const fn of frames.splice(0)) fn();
      return created.reduce((sum, c) => sum + c.arcs, 0);
    },
  };
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

test('the VPN view draws every country the Map view knows', async () => {
  for (const cc of ['CH', 'SG', 'HK', 'TW', 'US']) {
    const vpn = await mountVpn();
    vpn.render({ connected: true, countryCode: cc.toLowerCase() });
    assert.ok(vpn.dotsDrawn() > 0, `${cc} drew no map`);
  }
  const vpn = await mountVpn();
  vpn.render({ connected: true, countryCode: 'ZZ' });
  assert.equal(vpn.dotsDrawn(), 0, 'a code not on the map drew dots');
});

test('both Connections views read the one shared world map', () => {
  for (const f of ['connections-map.html', 'connections-vpn.html']) {
    const page = read(f);
    assert.match(page, /^import .* from '\.\/world-map\.js';$/m, `${f} does not load the shared map`);
    assert.doesNotMatch(page, /"dots":\[|__DOTS/, `${f} carries its own copy of the map`);
  }
});

test('the VPN accent reads every colour form the toolbox reads', async () => {
  for (const [color, on, want] of [
    ['#30D15880', true, 'rgba(48,209,88,1)'],
    ['#0a84ff', true, 'rgba(10,132,255,1)'],
    ['#f00', true, 'rgba(255,0,0,1)'],
    ['blue', true, 'rgba(48,209,88,1)'],
    ['blue', false, 'rgba(142,142,147,1)'],
  ]) {
    const vpn = await mountVpn();
    vpn.render({ connected: on, color });
    assert.equal(vpn.accent(), want, color);
  }
});
