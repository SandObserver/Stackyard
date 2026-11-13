import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
const { ICONS, STYLES, symbol } = await import('../js/icon-set.js');
const { MOTION } = await import('../js/icon-motion.js');

const WEIGHTS = { light: 1.5, regular: 2, bold: 2.5 };

const moving = id => symbol(id, ICONS[id], 'solid', false, 2, { motion: true });
const stepParts = m => [...m.go, ...m.back].map(([part]) => part);

test('every motion names an icon and parts the moving copy draws', () => {
  for (const [id, m] of Object.entries(MOTION)) {
    assert.ok(ICONS[id], `${id} is not an icon`);
    const { defs, sym } = moving(id);
    for (const part of new Set([...stepParts(m), ...Object.keys(m.origin || {})])) {
      assert.match(defs + sym, new RegExp(`data-part="${part}"`), `${id} has no part ${part}`);
    }
  }
});

test('no part name sits inside a clip path', () => {
  const inClip = /<clipPath[^>]*>(?:(?!<\/clipPath>).)*data-part/;
  for (const id of Object.keys(ICONS)) {
    for (const st of Object.keys(STYLES)) {
      for (const sw of Object.values(WEIGHTS)) {
        for (const opts of [{}, { motion: true }]) {
          const { defs, sym } = symbol(id, ICONS[id], st, false, sw, opts);
          assert.doesNotMatch(defs + sym, inClip, `${id} ${st} ${sw}`);
        }
      }
    }
  }
});

test('the still drawing has no motion-only shapes', () => {
  for (const [id, ic] of Object.entries(ICONS)) {
    for (const st of Object.keys(STYLES)) {
      for (const sharp of [false, true]) {
        for (const sw of Object.values(WEIGHTS)) {
          const { defs, sym } = symbol(id, ic, st, sharp, sw);
          assert.doesNotMatch(defs + sym, /visibility=/, `${id} ${st}`);
          for (const p of ic.shapes.filter(s => s.only === 'motion' && s.d)) {
            assert.ok(!sym.includes(`d="${p.d}"`), `${id} ${st} draws motion path ${p.d}`);
          }
        }
      }
    }
  }
});

test('shapes hidden at rest are shown by their motion', () => {
  for (const [id, m] of Object.entries(MOTION)) {
    const hidden = [...moving(id).sym.matchAll(/data-part="([^"]+)" visibility="hidden"/g)].map(x => x[1]);
    for (const part of hidden) {
      const shows = m.go.some(([p, f]) => p === part && JSON.stringify(f).includes('"visible"'));
      assert.ok(shows, `${id} never shows ${part}`);
    }
  }
});

test('every id in a moving copy carries the icon prefix, so each copy can be renamed', () => {
  for (const id of Object.keys(MOTION)) {
    const { defs, sym } = moving(id);
    for (const [, v] of `${defs}${sym}`.matchAll(/ id="([^"]+)"/g))
      assert.ok(v.startsWith(`sy-solid-${id}`), `${id}: ${v}`);
  }
});

test('the Now Playing morph keeps the path commands of its play shape', () => {
  const cmds = d => d.replace(/[^A-Za-z]/g, '');
  const own = moving('nowplaying').sym.match(/<path d="([^"]+)" data-part="play"/)[1];
  const [, { morph }] = MOTION.nowplaying.go.find(([, f]) => 'morph' in f);
  assert.equal(cmds(morph), cmds(own));
});

const MOTION_KEYS = ['part', 'only', 'hidden', 'clip', 'clipCaps', 'fixedHole'];
const plain = list =>
  list
    ?.filter(p => p.only !== 'motion')
    .map(p => Object.fromEntries(Object.entries(p).filter(([k]) => !MOTION_KEYS.includes(k))));
const unparted = s => s.replace(/ data-part="[^"]*"/g, '');

test('motion options change nothing in the still drawing but the part names', () => {
  for (const [id, ic] of Object.entries(ICONS)) {
    const bare = { ...ic, shapes: plain(ic.shapes), accentCut: plain(ic.accentCut) };
    if (ic.filled) bare.filled = { ...ic.filled, shapes: plain(ic.filled.shapes) };
    for (const st of Object.keys(STYLES)) {
      for (const sharp of [false, true]) {
        for (const sw of Object.values(WEIGHTS)) {
          const a = symbol(id, ic, st, sharp, sw);
          const b = symbol(id, bare, st, sharp, sw);
          assert.equal(unparted(a.defs + a.sym), b.defs + b.sym, `${id} ${st} ${sharp} ${sw}`);
        }
      }
    }
  }
});

test('a moving copy at rest draws the same as the still icon', () => {
  const atRest = s => {
    let out = s;
    for (const [, cid] of s.matchAll(/<clipPath id="([^"]+w)">/g)) {
      out = out
        .replace(new RegExp(`<clipPath id="${cid}">.*?</clipPath>`), '')
        .replace(new RegExp(`<g clip-path="url\\(#${cid}\\)">(<[^>]*/>)</g>`), '$1');
    }
    return unparted(out.replace(/<(?:path|rect|circle)[^>]* visibility="hidden"[^>]*\/>/g, ''));
  };
  for (const id of Object.keys(MOTION)) {
    const still = symbol(id, ICONS[id], 'solid', false, 2);
    const m = moving(id);
    assert.equal(atRest(m.defs + m.sym), unparted(still.defs + still.sym), id);
  }
});

function fakeMedia() {
  const q = { hover: { matches: true }, reduce: { matches: false } };
  for (const m of Object.values(q)) m.addEventListener = (_, fn) => (m.change = fn);
  globalThis.matchMedia = s => (s.includes('reduced') ? q.reduce : q.hover);
  return q;
}
const media = fakeMedia();
const parsed = [];
globalThis.DOMParser = class {
  parseFromString(src) {
    parsed.push(src);
    return { querySelector: () => null, documentElement: { childNodes: [] } };
  }
};

function fakeIcon(id) {
  const made = [];
  const parts = new Map();
  const part = name => ({
    style: {},
    animate(kf, opts) {
      let done;
      let fail;
      const finished = new Promise((res, rej) => {
        done = res;
        fail = rej;
      });
      finished.catch(() => {});
      const a = { name, kf, opts, finished, cancelled: false, finish: () => done(a) };
      a.cancel = () => {
        if (!a.cancelled) fail(new Error('cancelled'));
        a.cancelled = true;
      };
      made.push(a);
      return a;
    },
  });
  const svg = {
    isConnected: true,
    animate() {},
    setAttribute() {},
    replaceChildren() {},
    ownerDocument: { importNode: n => n },
    querySelector: () => null,
    querySelectorAll(sel) {
      const name = sel.match(/data-part="([^"]+)"/)[1];
      if (!parts.has(name)) parts.set(name, part(name));
      return [parts.get(name)];
    },
  };
  const trigger = new EventTarget();
  const point = (type, pointerType = 'mouse') => trigger.dispatchEvent(Object.assign(new Event(type), { pointerType }));
  animateIcon(svg, id, trigger);
  return { made, enter: t => point('pointerenter', t), leave: () => point('pointerleave') };
}
const { animateIcon } = await import('../js/icon-motion.js');
const settle = () => new Promise(r => setImmediate(r));

test('a leave during the trip finishes it, plays the way back, then rests', async () => {
  const icon = fakeIcon('dashboard');
  icon.enter();
  icon.leave();
  assert.equal(icon.made.length, 2);
  for (const a of icon.made) a.finish();
  await settle();
  assert.equal(icon.made.length, 4);
  assert.ok(
    icon.made.slice(0, 2).every(a => !a.cancelled),
    'the held pose stays under the way back',
  );
  for (const a of icon.made.slice(2)) a.finish();
  await settle();
  assert.ok(icon.made.every(a => a.cancelled));
});

test('a trailing settle plays on under the way back', async () => {
  const icon = fakeIcon('appearance');
  icon.enter();
  icon.leave();
  const [turn, slosh] = icon.made;
  turn.finish();
  await settle();
  assert.equal(icon.made.length, 3, 'the way back waits only for the turn');
  assert.equal(slosh.cancelled, false);
  icon.made[2].finish();
  await settle();
  assert.equal(slosh.cancelled, false, 'the settle is not cut off');
  slosh.finish();
  await settle();
  assert.ok(icon.made.every(a => a.cancelled));
});

test('with reduced motion on, a leave rests the icon without a way back', async () => {
  const icon = fakeIcon('dashboard');
  icon.enter();
  for (const a of icon.made) a.finish();
  await settle();
  media.reduce.matches = true;
  icon.leave();
  await settle();
  media.reduce.matches = false;
  assert.equal(icon.made.length, 2);
  assert.ok(icon.made.every(a => a.cancelled));
});

test('turning on reduced motion stops a trip in progress', async () => {
  const icon = fakeIcon('dashboard');
  icon.enter();
  media.reduce.matches = true;
  media.reduce.change();
  assert.ok(icon.made.every(a => a.cancelled));
  icon.leave();
  await settle();
  assert.equal(icon.made.length, 2);
  media.reduce.matches = false;
  icon.enter();
  assert.equal(icon.made.length, 4, 'the next hover plays again');
});

test('a touch plays nothing', () => {
  const icon = fakeIcon('dashboard');
  icon.enter('touch');
  assert.equal(icon.made.length, 0);
});

test('every inline copy gets its own mask and clip ids', () => {
  parsed.length = 0;
  fakeIcon('app');
  fakeIcon('app');
  const ids = parsed.map(src => [...src.matchAll(/ id="([^"]+)"/g)].map(x => x[1]));
  assert.ok(ids[0].length > 0);
  for (const list of ids) for (const v of list) assert.match(v, /^sy-solid-app-x\d+-/);
  assert.equal(new Set([...ids[0], ...ids[1]]).size, ids[0].length + ids[1].length);
});
