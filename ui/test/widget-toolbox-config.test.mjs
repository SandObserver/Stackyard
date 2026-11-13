import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=a%2Fb%20c%3Fd' };
const { getConfig } = await import('../js/widget-toolbox.js');

test('the config read escapes the widget id and skips the cache', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    return { ok: true, status: 200, json: async () => ({ widgetConfig: { href: 'x' } }) };
  };
  assert.deepEqual(await getConfig(), { widgetConfig: { href: 'x' } });
  assert.deepEqual(calls, [['/api/widget-config/a%2Fb%20c%3Fd', { cache: 'no-store' }]]);
});

test('a failed config read throws with its status', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(getConfig(), e => e.status === 404);
});
