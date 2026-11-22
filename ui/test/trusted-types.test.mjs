import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

class FakeTrustedHTML {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

function fakeTrustedTypes() {
  const created = [];
  return {
    created,
    createPolicy(name, rules) {
      created.push(name);
      return { createHTML: s => new FakeTrustedHTML(rules.createHTML(s)) };
    },
  };
}

function fakeParser(seen) {
  return class {
    parseFromString(src, type) {
      seen.push(src);
      return { documentElement: { type }, querySelector: () => null };
    }
  };
}

async function withGlobals(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(values))
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  try {
    await fn();
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
}

test('the icon sprite is parsed through its own named policy', async () => {
  const tt = fakeTrustedTypes();
  const seen = [];
  await withGlobals({ trustedTypes: tt, DOMParser: fakeParser(seen) }, async () => {
    const { ensureSprite, SPRITE_POLICY_NAME } = await import(`../js/icon-set.js?tt=${Math.random()}`);
    const added = [];
    const doc = {
      getElementById: () => null,
      importNode: n => n,
      body: { prepend: n => added.push(n) },
    };
    ensureSprite(doc);
    ensureSprite({ ...doc, getElementById: () => null });
    assert.equal(SPRITE_POLICY_NAME, 'stackyard-icons');
    assert.deepEqual(tt.created, ['stackyard-icons'], 'a policy is created once per page');
    assert.equal(seen.length, 2);
    for (const src of seen) {
      assert.ok(src instanceof FakeTrustedHTML, 'a plain string reached the parser');
      assert.match(String(src), /^<svg [^>]*id="sy-sprite"/);
    }
    assert.equal(added.length, 2);
  });
});

test('without Trusted Types the sprite is parsed from a string', async () => {
  const seen = [];
  await withGlobals({ trustedTypes: undefined, DOMParser: fakeParser(seen) }, async () => {
    const { ensureSprite } = await import(`../js/icon-set.js?tt=${Math.random()}`);
    ensureSprite({ getElementById: () => null, importNode: n => n, body: { prepend() {} } });
    assert.equal(typeof seen[0], 'string');
  });
});

/* The dashboard draws a failure glyph into a widget frame with that frame's
   parser, so the frame's rules apply to the parse. */
test('a failure glyph is parsed through the policy with the target document parser', async () => {
  const tt = fakeTrustedTypes();
  await withGlobals({ trustedTypes: tt }, async () => {
    const { kindGlyph } = await import(`../js/widget-error.js?tt=${Math.random()}`);
    const seen = [];
    const doc = { defaultView: { DOMParser: fakeParser(seen) }, importNode: n => n };
    const glyph = kindGlyph('network', doc);
    assert.equal(glyph.type, 'image/svg+xml');
    assert.equal(seen.length, 1);
    assert.ok(seen[0] instanceof FakeTrustedHTML);
    assert.match(String(seen[0]), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
});
