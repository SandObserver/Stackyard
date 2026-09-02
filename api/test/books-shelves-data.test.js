const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { dispatchProvider } = require('../src/provider-dispatch');
const { errorParts } = require('../test-support/widget-ctx');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'books', 'data.js'));

function ctxFor(config, reply) {
  const ctx = { endpoint: undefined, config, normalizeBase, fetchJSON: async url => reply(url), ...errorParts() };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return ctx;
}

function item(title) {
  return { media: { metadata: { title, authorName: 'A' } } };
}

const ABS = {
  provider: 'audiobookshelf',
  absUrl: 'http://abs:13378',
  absKey: 'k',
};

test('each shelf fetches its own source and keeps its order', async () => {
  const seen = [];
  const ctx = ctxFor({ ...ABS, shelves: [{ source: 'recently' }, { source: 'unread' }] }, url => {
    seen.push(url);
    if (url.endsWith('/api/libraries')) return { status: 200, data: { libraries: [{ id: 'L', mediaType: 'book' }] } };
    return { status: 200, data: { results: [item(url.includes('filter=progress') ? 'Unread one' : 'Recent one')] } };
  });
  const r = await dataFn(ctx);
  assert.deepEqual(
    r.shelves.map(s => [s.source, s.books.map(b => b.title)]),
    [
      ['recently', ['Recent one']],
      ['unread', ['Unread one']],
    ],
  );
  assert.equal(
    seen.filter(u => u.endsWith('/api/libraries')).length,
    1,
    'the library is resolved once for all shelves',
  );
});

test('a shelf with no source falls back to the most recent books', async () => {
  const ctx = ctxFor({ ...ABS, shelves: [{}] }, url =>
    url.endsWith('/api/libraries')
      ? { status: 200, data: { libraries: [{ id: 'L', mediaType: 'book' }] } }
      : { status: 200, data: { results: [item('One')] } },
  );
  const r = await dataFn(ctx);
  assert.equal(r.shelves.length, 1);
  assert.equal(r.shelves[0].source, 'recently');
});

test('a config that predates shelves still reads as one shelf', async () => {
  const ctx = ctxFor({ ...ABS, source: 'unread' }, url =>
    url.endsWith('/api/libraries')
      ? { status: 200, data: { libraries: [{ id: 'L', mediaType: 'book' }] } }
      : { status: 200, data: { results: [item('One')] } },
  );
  const r = await dataFn(ctx);
  assert.deepEqual(
    r.shelves.map(s => s.source),
    ['unread'],
  );
});

test('Komga asks a different path per shelf', async () => {
  const paths = [];
  const ctx = ctxFor(
    {
      provider: 'komga',
      komgaUrl: 'http://komga:25600',
      komgaKey: 'k',
      shelves: [{ source: 'unread' }, { source: 'list', listId: '7' }, { source: 'recently' }],
    },
    url => {
      paths.push(url.replace('http://komga:25600', ''));
      return { status: 200, data: { content: [{ name: 'B', metadata: {} }] } };
    },
  );
  const r = await dataFn(ctx);
  assert.equal(r.shelves.length, 3);
  assert.deepEqual(paths, [
    '/api/v1/books/ondeck?size=16',
    '/api/v1/readlists/7/books?size=16',
    '/api/v1/books/latest?size=16',
  ]);
});
