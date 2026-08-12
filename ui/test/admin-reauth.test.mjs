import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

/* admin-shared imports its peers by their served paths, so map them first. */
register('./js-root-hooks.mjs', import.meta.url);

/* toast writes into an element; nothing here asserts on it. */
globalThis.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} };

const { ag, ap, setReauthHandler } = await import('../js/admin-shared.js');

/* A session that expired under someone who was still working. The first request
   answers 401, and whatever the queue does next decides whether their work
   survives. */
function fakeFetch(plan) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, method: opts?.method || 'GET' });
    const status = plan.shift();
    return {
      ok: status < 400,
      status,
      /* A 401 comes back from the auth gate with no JSON body, which is the
         case the helpers' fallback message exists for. */
      json: async () => {
        if (status >= 400) throw new Error('not json');
        return { ok: true };
      },
    };
  };
  return calls;
}

test('a 401 signs back in and sends the same request again', async () => {
  const calls = fakeFetch([401, 200]);
  let signIns = 0;
  setReauthHandler(async () => {
    signIns++;
    return true;
  });

  const out = await ap('/api/config', { items: [] });

  assert.equal(signIns, 1, 'the sign-in box is raised once');
  assert.equal(calls.length, 2, 'the save is retried rather than abandoned');
  assert.deepEqual(
    calls.map(c => c.method),
    ['POST', 'POST'],
    'the retry is the same write, not a read',
  );
  assert.deepEqual(out, { ok: true });
});

test('a second 401 after signing in gives up rather than looping', async () => {
  fakeFetch([401, 401]);
  let signIns = 0;
  setReauthHandler(async () => {
    signIns++;
    return true;
  });

  await assert.rejects(ap('/api/config', {}), /Unauthorised/);
  assert.equal(signIns, 1, 'the retry does not raise a second sign-in box');
});

test('declining to sign in reports the failure instead of hanging', async () => {
  fakeFetch([401]);
  setReauthHandler(async () => false);

  await assert.rejects(ag('/api/config'), /Unauthorised/);
});

/* A settings save makes three writes in a row. Without one sign-in shared
   between them, each would raise its own box over the last. */
test('requests failing together share one sign-in', async () => {
  fakeFetch([401, 401, 401, 200, 200, 200]);
  let signIns = 0;
  let release;
  const gate = new Promise(r => {
    release = r;
  });
  setReauthHandler(async () => {
    signIns++;
    await gate;
    return true;
  });

  const all = Promise.all([ap('/api/config', {}), ap('/api/auth/toggle', {}), ag('/api/widgets')]);
  await new Promise(r => setImmediate(r));
  release();
  await all;

  assert.equal(signIns, 1, 'three failures, one sign-in');
});

/* Signing in is itself two requests that answer 401. Recovering from those
   would put a sign-in box on top of the sign-in box. */
test('the sign-in requests themselves never trigger a sign-in', async () => {
  fakeFetch([401, 401]);
  let signIns = 0;
  setReauthHandler(async () => {
    signIns++;
    return true;
  });

  await assert.rejects(ag('/api/auth/check'), /Unauthorised/);
  await assert.rejects(ap('/api/auth/login', { password: 'x' }), /Unauthorised/);
  assert.equal(signIns, 0);
});

test('a later save signs in again, rather than the first one being the only chance', async () => {
  fakeFetch([401, 200, 401, 200]);
  let signIns = 0;
  setReauthHandler(async () => {
    signIns++;
    return true;
  });

  await ap('/api/config', {});
  await ap('/api/config', {});
  assert.equal(signIns, 2, 'the shared sign-in is cleared once it resolves');
});

test('a request that succeeds never asks anyone to sign in', async () => {
  const calls = fakeFetch([200]);
  let signIns = 0;
  setReauthHandler(async () => {
    signIns++;
    return true;
  });

  await ag('/api/config');
  assert.equal(signIns, 0);
  assert.equal(calls.length, 1);
});
