const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'github', 'data.js'));
const { errorParts } = require('../test-support/widget-ctx');

const PRS = { githubToken: 't', githubUser: 'octo' };
const CONTRIBUTIONS = { ...PRS, githubView: 'contributions' };

const ctxFor = (config, reply) => ({ config, fetchJSON: async () => reply, ...errorParts() });

for (const status of [403, 429, 500, 502]) {
  test(`a pull request search answered ${status} fails instead of showing no pull requests`, async () => {
    await assert.rejects(dataFn(ctxFor(PRS, { status, data: { message: 'API rate limit exceeded' } })), /HTTP/);
  });

  test(`a contributions query answered ${status} fails instead of an empty calendar`, async () => {
    await assert.rejects(dataFn(ctxFor(CONTRIBUTIONS, { status, data: { message: 'x' } })), /HTTP/);
  });
}

test('a search reply without items fails', async () => {
  await assert.rejects(dataFn(ctxFor(PRS, { status: 200, data: {} })), /no search results/);
});

test('a contributions reply without a calendar fails', async () => {
  await assert.rejects(
    dataFn(ctxFor(CONTRIBUTIONS, { status: 200, data: { data: { user: null } } })),
    /no contribution/,
  );
});

test('a search with results lists them', async () => {
  const r = await dataFn(
    ctxFor(PRS, {
      status: 200,
      data: {
        total_count: 1,
        items: [{ number: 7, title: 'Fix', repository_url: 'https://api.github.com/repos/o/r', html_url: 'https://x' }],
      },
    }),
  );
  assert.equal(r.totalCount, 1);
  assert.deepEqual(r.items, [{ number: 7, title: 'Fix', repo: 'o/r', url: 'https://x' }]);
});

test('an empty search is a valid empty list', async () => {
  const r = await dataFn(ctxFor(PRS, { status: 200, data: { total_count: 0, items: [] } }));
  assert.deepEqual(r.items, []);
});
