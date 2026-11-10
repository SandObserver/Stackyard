import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
const { ICONS, STYLES, WEIGHTS, symbol } = await import('../js/icon-set.js');
const { MOTION } = await import('../js/icon-motion.js');

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
  const [, { morph }] = MOTION.nowplaying.go[0];
  assert.equal(cmds(morph), cmds(own));
});
