import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };

let fresh = 0;

/** A page whose canvas returns `gl`, with a session store, counting contexts made. */
async function page({ gl, stored = new Map(), blocked = false }) {
  let made = 0;
  globalThis.document = {
    createElement: () => ({
      getContext: (kind, opts) => {
        made++;
        assert.equal(kind, 'webgl');
        assert.equal(opts.failIfMajorPerformanceCaveat, true);
        return typeof gl === 'function' ? gl() : gl;
      },
    }),
  };
  const fail = () => {
    throw new Error('blocked');
  };
  globalThis.sessionStorage = blocked
    ? { getItem: fail, setItem: fail }
    : { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) };
  const { softwareRendering } = await import(`../js/widget-toolbox.js?software=${++fresh}`);
  return { softwareRendering, made: () => made, stored };
}

const gpu = renderer => {
  let lost = false;
  return {
    getExtension: name =>
      name === 'WEBGL_debug_renderer_info'
        ? { UNMASKED_RENDERER_WEBGL: 37446 }
        : name === 'WEBGL_lose_context'
          ? { loseContext: () => (lost = true) }
          : null,
    getParameter: p => (p === 37446 ? renderer : ''),
    get lost() {
      return lost;
    },
  };
};

test('a graphics chip is not software rendering, and the probe context is released', async () => {
  const gl = gpu('ANGLE (Apple, Apple M1, OpenGL 4.1)');
  const p = await page({ gl });
  assert.equal(p.softwareRendering(), false);
  assert.equal(gl.lost, true);
});

test('SwiftShader and llvmpipe are software rendering', async () => {
  for (const name of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))', 'llvmpipe (LLVM 15.0.6, 128 bits)']) {
    const p = await page({ gl: gpu(name) });
    assert.equal(p.softwareRendering(), true, name);
  }
});

test('a browser that refuses a fast WebGL context is software rendering', async () => {
  const p = await page({ gl: null });
  assert.equal(p.softwareRendering(), true);
});

test('a throwing canvas counts as software rendering', async () => {
  const p = await page({
    gl: () => {
      throw new Error('no canvas');
    },
  });
  assert.equal(p.softwareRendering(), true);
});

test('the answer is checked once and shared with the other widgets in the tab', async () => {
  const p = await page({ gl: gpu('Apple GPU') });
  assert.equal(p.softwareRendering(), false);
  assert.equal(p.softwareRendering(), false);
  assert.equal(p.made(), 1);
  const next = await page({ gl: null, stored: p.stored });
  assert.equal(next.softwareRendering(), false, 'the second widget reads the first one’s answer');
  assert.equal(next.made(), 0);
});

test('blocked storage still gives an answer', async () => {
  const p = await page({ gl: gpu('Mali-G52'), blocked: true });
  assert.equal(p.softwareRendering(), false);
});
