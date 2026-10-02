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
    '/api/v1/readlists?size=100',
    '/api/v1/books/latest?size=16',
  ]);
});

test('a shelf the reader named keeps that name', async () => {
  const ctx = ctxFor({ ...ABS, shelves: [{ source: 'recently', label: '  Bedside pile  ' }] }, url =>
    url.endsWith('/api/libraries')
      ? { status: 200, data: { libraries: [{ id: 'L', mediaType: 'book' }] } }
      : { status: 200, data: { results: [item('One')] } },
  );
  const r = await dataFn(ctx);
  assert.equal(r.shelves[0].name, 'Bedside pile');
});

test('an unnamed list shelf carries the list name the service reports', async () => {
  const ctx = ctxFor({ ...ABS, shelves: [{ source: 'list', listId: 'collection:c1' }] }, url => {
    if (url.endsWith('/api/libraries')) return { status: 200, data: { libraries: [{ id: 'L', mediaType: 'book' }] } };
    return { status: 200, data: { name: 'Sci-fi to read', books: [item('One')] } };
  });
  const r = await dataFn(ctx);
  assert.equal(r.shelves[0].name, 'Sci-fi to read');
});

test('a named list shelf does not ask the service for a name', async () => {
  const seen = [];
  const ctx = ctxFor(
    {
      provider: 'komga',
      komgaUrl: 'http://komga:25600',
      komgaKey: 'k',
      shelves: [{ source: 'list', listId: '7', label: 'Mine' }],
    },
    url => {
      seen.push(url);
      return { status: 200, data: { content: [{ name: 'One', metadata: { title: 'One' } }] } };
    },
  );
  const r = await dataFn(ctx);
  assert.equal(r.shelves[0].name, 'Mine');
  assert.deepEqual(
    seen.filter(u => u.includes('/readlists?')),
    [],
    'it looked the name up anyway',
  );
});

test('komga reads an unnamed list name from the same listing the picker uses', async () => {
  const ctx = ctxFor(
    { provider: 'komga', komgaUrl: 'http://komga:25600', komgaKey: 'k', shelves: [{ source: 'list', listId: '7' }] },
    url =>
      url.includes('/readlists?')
        ? { status: 200, data: { content: [{ id: 7, name: 'Weekly pulls' }] } }
        : { status: 200, data: { content: [{ name: 'One', metadata: { title: 'One' } }] } },
  );
  const r = await dataFn(ctx);
  assert.equal(r.shelves[0].name, 'Weekly pulls');
});

test('a shelf with no name of any kind reports none, so the widget picks the wording', async () => {
  const ctx = ctxFor({ ...ABS, shelves: [{ source: 'unread' }] }, url =>
    url.endsWith('/api/libraries')
      ? { status: 200, data: { libraries: [{ id: 'L', mediaType: 'book' }] } }
      : { status: 200, data: { results: [item('One')] } },
  );
  const r = await dataFn(ctx);
  assert.equal(r.shelves[0].name, '');
});

const KOMGA = { provider: 'komga', komgaUrl: 'http://komga:25600', komgaKey: 'k' };
const KAVITA = { provider: 'kavita', kavitaUrl: 'http://kavita:5000', kavitaKey: 'k' };
const ABS_LIBRARY = { status: 200, data: { libraries: [{ id: 'L', mediaType: 'book' }] } };
const KAVITA_TOKEN = { status: 200, data: { token: 't' } };

for (const status of [404, 429, 500, 503]) {
  test(`an Audiobookshelf ${status} fails the poll instead of showing an empty shelf`, async () => {
    const ctx = ctxFor(ABS, url => (url.endsWith('/api/libraries') ? ABS_LIBRARY : { status, data: null }));
    await assert.rejects(dataFn(ctx), new RegExp(`Audiobookshelf HTTP ${status}`));
  });

  test(`a Komga ${status} fails the poll instead of showing an empty shelf`, async () => {
    const ctx = ctxFor(KOMGA, () => ({ status, data: null }));
    await assert.rejects(dataFn(ctx), new RegExp(`Komga HTTP ${status}`));
  });

  test(`a Kavita ${status} fails the poll instead of showing an empty shelf`, async () => {
    const ctx = ctxFor(KAVITA, url =>
      url.includes('/api/Plugin/authenticate') ? KAVITA_TOKEN : { status, data: null },
    );
    await assert.rejects(dataFn(ctx), new RegExp(`Kavita HTTP ${status}`));
  });
}

test('a rejected key on a shelf request reports an auth failure', async () => {
  const ctx = ctxFor(ABS, url => (url.endsWith('/api/libraries') ? ABS_LIBRARY : { status: 403, data: null }));
  await assert.rejects(dataFn(ctx), err => err.kind === 'auth');
});

test('a failed list name lookup keeps the shelf and leaves it unnamed', async () => {
  const ctx = ctxFor({ ...KOMGA, shelves: [{ source: 'list', listId: '7' }] }, url =>
    url.includes('/api/v1/readlists?') ? { status: 500, data: null } : { status: 200, data: { content: [] } },
  );
  const r = await dataFn(ctx);
  assert.equal(r.shelves.length, 1);
  assert.equal(r.shelves[0].name, '');
});
