import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

/* widget-toolbox imports a peer by its served path ('/js/html.js?v=...') and
   reads location.search at module load, so map the path and stub location
   before loading it. */
register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };
const { poll } = await import('../js/widget-toolbox.js');

const tick = ms => new Promise(r => setTimeout(r, ms));

test('a failure within tolerance leaves the last good render in place', async () => {
  const rendered = [];
  const errors = [];
  let call = 0;
  const p = poll({
    interval: 5,
    fetch: async () => {
      call++;
      if (call === 2) throw new Error('blip');
      return { call };
    },
    render: d => rendered.push(d.call),
    onError: info => errors.push(info),
  });
  await tick(60);
  p.stop();

  assert.ok(rendered.includes(1), 'first success rendered');
  assert.ok(!rendered.includes(2), 'the failed fetch did not render');
  assert.equal(errors.length, 1, 'one failure reported');
  assert.equal(errors[0].stale, false, 'a single failure is not stale');
  assert.equal(errors[0].everOk, true);
});

test('consecutive failures past staleAfter report stale', async () => {
  const errors = [];
  const p = poll({
    interval: 5,
    staleAfter: 2,
    fetch: async () => {
      throw new Error('down');
    },
    onError: info => errors.push(info),
  });
  await tick(40);
  p.stop();

  assert.equal(errors[0].stale, false);
  assert.equal(errors[0].everOk, false);
  assert.ok(
    errors.some(e => e.stale),
    'goes stale once past the threshold',
  );
});

test('interval can be a function of the last successful result', async () => {
  const seen = [];
  const p = poll({
    interval: d => {
      seen.push(d);
      return 5;
    },
    fetch: async () => ({ n: seen.length }),
    render: () => {},
    onError: () => {},
  });
  await tick(40);
  p.stop();

  assert.equal(seen[0].n, 0, 'first delay sees the first result');
  assert.ok(seen.length > 1, 'keeps polling');
});

test('stop halts further fetches', async () => {
  let calls = 0;
  const p = poll({
    interval: 5,
    fetch: async () => {
      calls++;
      return {};
    },
    render: () => {},
    onError: () => {},
  });
  await tick(30);
  p.stop();
  const atStop = calls;
  await tick(30);
  assert.equal(calls, atStop, 'no fetches after stop');
});

test('esc is re-exported and escapes single quotes', async () => {
  const { esc } = await import('../js/widget-toolbox.js');
  assert.equal(esc(`<a href='x'>&"`), '&lt;a href=&#39;x&#39;&gt;&amp;&quot;');
});

/* ── P8-7: polling continued in a hidden tab ─────────────────────────────────
   Each widget is its own document with its own timer, and most ticks reach the
   user's own service through the API, so a backgrounded dashboard kept calling
   Plex, Pi-hole and GitHub. The dashboard already paused its own badge, health
   and config polls; the widgets were the half that did not.

   A fake document, since these tests run outside a browser. Each test passes
   onError, which makes poll skip the status overlay: that needs
   getComputedStyle and real elements, and none of this is about the overlay.

   run() owns the lifecycle. A live poll holds a timer, so a test whose
   assertion throws before stop() leaves the process alive and the whole run
   hangs rather than reporting a failure — and a hung test is dropped from the
   summary silently, so the run still looks green. Stopping in a finally is
   what makes a broken expectation show up as a broken expectation. */
function withDocument(hidden = false) {
  const listeners = [];
  globalThis.document = {
    hidden,
    addEventListener: (type, fn) => {
      if (type === 'visibilitychange') listeners.push(fn);
    },
    removeEventListener: (type, fn) => {
      const i = listeners.indexOf(fn);
      if (type === 'visibilitychange' && i !== -1) listeners.splice(i, 1);
    },
  };
  return {
    listenerCount: () => listeners.length,
    setHidden(v) {
      globalThis.document.hidden = v;
      listeners.slice().forEach(fn => fn());
    },
    cleanup() {
      delete globalThis.document;
    },
  };
}

/* Run body(dom, start) with a fake document, always tearing down. `start`
   creates a poll whose stop() is guaranteed to run. */
async function run(body, { hidden = false } = {}) {
  const dom = withDocument(hidden);
  const polls = [];
  const start = opts => {
    const p = poll({ render: () => {}, onError: () => {}, ...opts });
    polls.push(p);
    return p;
  };
  try {
    await body(dom, start);
  } finally {
    polls.forEach(p => p.stop());
    dom.cleanup();
  }
}

test('polling stops while the tab is hidden', async () => {
  await run(async (dom, start) => {
    let calls = 0;
    start({ interval: 5, fetch: async () => ({ n: ++calls }) });
    await tick(30);
    const before = calls;
    assert.ok(before >= 2, `expected several polls while visible, got ${before}`);

    dom.setHidden(true);
    await tick(60);
    /* At most one more: a tick already in flight when it hid may still land. */
    assert.ok(calls - before <= 1, `expected polling to stop, got ${calls - before} more calls`);
  });
});

/* With a long interval the loop is almost always sitting on an armed timer when
   the tab hides, so a pause that only took effect at the next tick would leave
   that timer to fire in the background. Hiding must cancel it. */
test('hiding cancels a timer that is already armed', async () => {
  await run(async (dom, start) => {
    let calls = 0;
    start({ interval: 30, fetch: async () => ({ n: ++calls }) });
    await tick(10);
    assert.equal(calls, 1, 'one fetch, with the next already scheduled');

    dom.setHidden(true);
    await tick(90);
    assert.equal(calls, 1, 'the armed timer must not fire while hidden');
  });
});

test('becoming visible fetches at once rather than waiting out the interval', async () => {
  await run(async (dom, start) => {
    let calls = 0;
    start({ interval: 10_000, fetch: async () => ({ n: ++calls }) });
    await tick(20);
    assert.equal(calls, 1, 'one initial fetch');

    dom.setHidden(true);
    await tick(20);
    dom.setHidden(false);
    await tick(20);
    assert.equal(calls, 2, 'returning should fetch immediately, not after 10s');
  });
});

/* Returning must not fire a burst: nothing is armed while hidden, and repeated
   visibility events must not stack loops. */
test('repeated visibility changes do not multiply the loop', async () => {
  await run(async (dom, start) => {
    let calls = 0;
    start({ interval: 10_000, fetch: async () => ({ n: ++calls }) });
    await tick(20);
    assert.equal(calls, 1);

    dom.setHidden(true);
    await tick(10);
    dom.setHidden(false);
    dom.setHidden(false);
    dom.setHidden(false);
    await tick(30);
    assert.equal(calls, 2, 'one fetch on return regardless of how many events arrive');
  });
});

test('a poll started while hidden does not keep polling', async () => {
  await run(
    async (dom, start) => {
      let calls = 0;
      start({ interval: 5, fetch: async () => ({ n: ++calls }) });
      await tick(40);
      assert.equal(calls, 1, 'the first fetch runs, then it waits for visibility');

      dom.setHidden(false);
      await tick(30);
      assert.ok(calls > 1, 'and it resumes when shown');
    },
    { hidden: true },
  );
});

test('stop detaches the visibility listener', async () => {
  await run(async (dom, start) => {
    const p = start({ interval: 5, fetch: async () => ({}) });
    await tick(10);
    assert.equal(dom.listenerCount(), 1, 'poll registers one listener');
    p.stop();
    assert.equal(dom.listenerCount(), 0, 'and removes it, so a torn-down widget leaks nothing');
  });
});

test('stop while hidden stays stopped when the tab returns', async () => {
  await run(async (dom, start) => {
    let calls = 0;
    const p = start({ interval: 5, fetch: async () => ({ n: ++calls }) });
    await tick(20);
    dom.setHidden(true);
    p.stop();
    const after = calls;

    dom.setHidden(false);
    await tick(30);
    assert.equal(calls, after, 'a stopped poll must not resurrect on visibility');
  });
});
