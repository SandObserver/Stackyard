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

const { normalizeBase } = require('../src/widget-data');
const { serviceLink } = require('../../ui/js/service-link.js');

function recordingCtx(config, reply) {
  const calls = [];
  const ctx = {
    config,
    normalizeBase,
    serviceLink,
    fetchJSON: async (url, opts) => {
      calls.push({ url: new URL(url), opts });
      return typeof reply === 'function' ? reply(url) : reply;
    },
    ...errorParts(),
  };
  return { ctx, calls };
}

const GITEA = { githubService: 'gitea', githubUrl: 'https://git.lan/', githubUser: 'me', githubToken: 't' };

for (const service of ['gitea', 'forgejo']) {
  test(`${service} pull requests search the token owner's open pull requests`, async () => {
    const { ctx, calls } = recordingCtx(
      { ...GITEA, githubService: service, githubPrFilters: ['created', 'review-requested'] },
      {
        status: 200,
        headers: { 'x-total-count': '31' },
        data: [
          { number: 4, title: 'Fix', repository: { full_name: 'me/app' }, html_url: 'https://git.lan/me/app/pulls/4' },
        ],
      },
    );
    const r = await dataFn(ctx);
    const { url, opts } = calls[0];
    assert.equal(url.origin + url.pathname, 'https://git.lan/api/v1/repos/issues/search');
    assert.equal(url.searchParams.get('type'), 'pulls');
    assert.equal(url.searchParams.get('state'), 'open');
    assert.equal(url.searchParams.get('created'), 'true');
    assert.equal(url.searchParams.get('review_requested'), 'true');
    assert.equal(opts.headers.Authorization, 'token t');
    assert.equal(r.totalCount, 31);
    assert.deepEqual(r.items, [{ number: 4, title: 'Fix', repo: 'me/app', url: 'https://git.lan/me/app/pulls/4' }]);
    assert.equal(r.allUrl, 'https://git.lan/pulls');
  });
}

test('gitea counts the listed pull requests when the total header is missing', async () => {
  const { ctx } = recordingCtx(GITEA, {
    status: 200,
    data: [
      { number: 1, title: 'a' },
      { number: 2, title: 'b' },
    ],
  });
  assert.equal((await dataFn(ctx)).totalCount, 2);
});

test('gitea without a server URL fails as a setup problem', async () => {
  const { ctx } = recordingCtx({ ...GITEA, githubUrl: '' }, { status: 200, data: [] });
  await assert.rejects(dataFn(ctx), e => e.kind === ctx.KIND.INVALID && /URL/.test(e.message));
});

for (const [status, kind] of [
  [401, 'AUTH'],
  [403, 'AUTH'],
  [404, 'INVALID'],
]) {
  test(`gitea answering ${status} fails as ${kind}`, async () => {
    const { ctx } = recordingCtx(GITEA, { status, data: { message: 'x' } });
    await assert.rejects(dataFn(ctx), e => e.kind === ctx.KIND[kind]);
  });
}

test('gitea contributions add the heatmap slots up per day', async () => {
  const now = new Date();
  const at = (daysAgo, hour) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 15, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };
  const { ctx, calls } = recordingCtx(
    { ...GITEA, githubView: 'contributions' },
    {
      status: 200,
      data: [
        { timestamp: at(0, 9), contributions: 2 },
        { timestamp: at(0, 10), contributions: 3 },
        { timestamp: at(3, 12), contributions: 4 },
        { timestamp: at(400, 12), contributions: 9 },
      ],
    },
  );
  const r = await dataFn(ctx);
  assert.equal(calls[0].url.pathname, '/api/v1/users/me/heatmap');
  assert.equal(r.view, 'contributions');
  assert.equal(r.totalContributions, 9);
  const days = r.weeks.flatMap(w => w.contributionDays);
  assert.equal(days.at(-1).contributionCount, 5);
  assert.ok(r.weeks.every(w => new Date(w.contributionDays[0].date + 'T00:00:00Z').getUTCDay() === 0));
  assert.equal(r.profileUrl, 'https://git.lan/me');
});

const GITLAB = { githubService: 'gitlab', githubUrl: 'https://gitlab.com', githubUser: 'me', githubToken: 't' };

test('gitlab lists open merge requests by the chosen filters', async () => {
  const { ctx, calls } = recordingCtx(
    { ...GITLAB, githubPrFilters: ['assigned', 'mentioned'] },
    {
      status: 200,
      headers: { 'x-total': '12' },
      data: [
        {
          iid: 9,
          title: 'Bump',
          references: { full: 'me/app!9' },
          web_url: 'https://gitlab.com/me/app/-/merge_requests/9',
        },
      ],
    },
  );
  const r = await dataFn(ctx);
  const { url, opts } = calls[0];
  assert.equal(url.pathname, '/api/v4/merge_requests');
  assert.equal(url.searchParams.get('state'), 'opened');
  assert.equal(url.searchParams.get('assignee_username'), 'me');
  assert.equal(url.searchParams.has('author_username'), false);
  assert.equal(opts.headers['PRIVATE-TOKEN'], 't');
  assert.deepEqual(r.filters, ['assigned']);
  assert.equal(r.totalCount, 12);
  assert.deepEqual(r.items, [
    { number: 9, title: 'Bump', repo: 'me/app', url: 'https://gitlab.com/me/app/-/merge_requests/9' },
  ]);
  assert.equal(r.allUrl, 'https://gitlab.com/dashboard/merge_requests');
});

test('gitlab with a saved contributions view fails as a setup problem', async () => {
  const { ctx, calls } = recordingCtx({ ...GITLAB, githubView: 'contributions' }, { status: 200, data: [] });
  await assert.rejects(dataFn(ctx), e => e.kind === ctx.KIND.INVALID && /contribution/.test(e.message));
  assert.equal(calls.length, 0);
});

test('gitlab with only unsupported filters searches by author', async () => {
  const { ctx, calls } = recordingCtx({ ...GITLAB, githubPrFilters: ['mentioned'] }, { status: 200, data: [] });
  assert.deepEqual((await dataFn(ctx)).filters, ['created']);
  assert.equal(calls[0].url.searchParams.get('author_username'), 'me');
});

test('an unknown service reads GitHub', async () => {
  const { ctx, calls } = recordingCtx({ ...PRS, githubService: 'svn' }, { status: 200, data: { items: [] } });
  await dataFn(ctx);
  assert.equal(calls[0].url.host, 'api.github.com');
});

test('github contributions link the profile unless a link URL is set', async () => {
  const reply = {
    status: 200,
    data: { data: { user: { contributionsCollection: { contributionCalendar: { weeks: [] } } } } },
  };
  assert.equal((await dataFn(recordingCtx(CONTRIBUTIONS, reply).ctx)).profileUrl, 'https://github.com/octo');
  const own = { ...CONTRIBUTIONS, githubHref: 'https://me.example' };
  assert.equal((await dataFn(recordingCtx(own, reply).ctx)).profileUrl, 'https://me.example');
});
