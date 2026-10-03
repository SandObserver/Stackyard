import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} };
globalThis.location = /** @type {any} */ ({ host: 'nas.local' });

/* No catalogue is loaded, so t() returns the key it was asked for. */
const { apiPost, errorText, responseError, ShownError } = await import('../js/admin-shared.js');

const reply = (status, text) => ({
  ok: status < 400,
  status,
  text: async () => text,
  json: async () => JSON.parse(text),
});

test('a refused request shows the sentence for its code, never the server text', async () => {
  globalThis.fetch = async () =>
    reply(
      403,
      JSON.stringify({ error: 'Saving is disabled in the live demo.', kind: 'blocked', code: 'blocked.read-only' }),
    );
  const e = await apiPost('/api/config', {}).catch(x => x);
  assert.equal(errorText(e), 'adminError.readOnly');
});

test('a raw fetch refusal keeps its code', async () => {
  const e = await responseError(
    reply(400, JSON.stringify({ error: 'file is not a PNG image', kind: 'invalid', code: 'invalid.file-type' })),
  );
  assert.equal(errorText(e), 'adminError.fileType');
});

test('a web server 413 page is worded as too large', async () => {
  const e = await responseError(reply(413, '<html><body>413 Request Entity Too Large</body></html>'));
  assert.equal(errorText(e), 'toast.imageTooLarge');
});

test('a message the page wrote itself is shown as written', () => {
  assert.equal(errorText(new ShownError('already translated')), 'already translated');
  assert.equal(errorText(new TypeError('Failed to fetch')), 'adminError.genericInternal');
});
