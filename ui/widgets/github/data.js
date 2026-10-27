const SERVICE_NAME = { github: 'GitHub', gitea: 'Gitea', forgejo: 'Forgejo', gitlab: 'GitLab' };

module.exports = async function (ctx) {
  const { config } = ctx;
  const service = Object.hasOwn(SERVICE_NAME, config.githubService) ? config.githubService : 'github';
  const name = SERVICE_NAME[service];
  const token = config.githubToken;
  if (!token) ctx.fail(`${name} token not configured`, { kind: ctx.KIND.INVALID });

  const username = config.githubUser;
  if (!username) ctx.fail(`${name} username not configured`, { kind: ctx.KIND.INVALID });

  if (service === 'github') {
    if (config.githubView === 'contributions') return contributions(ctx, token, username);
    return pullRequests(ctx, token, username, config);
  }
  const raw = String(config.githubUrl || '').trim();
  /* Never send the token over http unless the address says so. */
  const base = ctx.normalizeBase(!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!base) ctx.fail(`${name} URL not configured`, { kind: ctx.KIND.INVALID });
  if (service === 'gitlab') {
    if (config.githubView === 'contributions')
      ctx.fail('GitLab offers no contribution calendar. Save the widget again to show merge requests.', {
        kind: ctx.KIND.INVALID,
      });
    return gitlabMergeRequests(ctx, base, token, username, config);
  }
  if (config.githubView === 'contributions') return giteaContributions(ctx, base, token, username, name);
  return giteaPullRequests(ctx, base, token, config, name);
};

function prFilters(config) {
  const raw =
    Array.isArray(config.githubPrFilters) && config.githubPrFilters.length
      ? config.githubPrFilters
      : [config.githubPrFilter || 'created'];
  return Array.isArray(raw) ? raw : [raw];
}

function replyStatus(ctx, r, name) {
  if (r.status === 401) ctx.fail(`Invalid ${name} token`, { kind: ctx.KIND.AUTH });
  if (r.status === 403) ctx.fail(`${name} refused the token, check its scopes`, { kind: ctx.KIND.AUTH });
  if (r.status === 404)
    ctx.fail(`${name} has no such user or API, check the URL and username`, { kind: ctx.KIND.INVALID });
  if (r.status >= 400) ctx.fail(`${name} HTTP ${r.status}`);
}

function headerCount(r, header, fallback) {
  const n = Number(r.headers?.[header]);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/* Needs a classic PAT with read:user, or a fine-grained PAT with "User
   contributions" read access. */
async function contributions(ctx, token, username) {
  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { contributionCount date } }
        }
      }
    }
  }`;
  const r = await ctx.fetchJSON('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'stackyard-dashboard/1.0',
    },
    body: JSON.stringify({ query, variables: { login: username } }),
    timeout: 10000,
  });

  if (r.status === 401) ctx.fail('Invalid GitHub token', { kind: ctx.KIND.AUTH });
  if (r.data && r.data.errors) ctx.fail('GitHub rejected the query — check the token scopes');
  if (r.status >= 400) ctx.fail('GitHub HTTP ' + r.status);

  const cal = r.data?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal || !Array.isArray(cal.weeks)) ctx.fail('GitHub returned no contribution calendar');
  return {
    view: 'contributions',
    weeks: cal.weeks,
    totalContributions: cal.totalContributions || 0,
    profileUrl: ctx.config.githubHref || `https://github.com/${encodeURIComponent(username)}`,
  };
}

async function pullRequests(ctx, token, username, config) {
  const filterArr = prFilters(config);
  const qualifiers = filterArr.map(f => {
    if (f === 'assigned') return `assignee:${username}`;
    if (f === 'mentioned') return `mentions:${username}`;
    if (f === 'review-requested') return `review-requested:${username}`;
    return `author:${username}`;
  });
  const qualifier = qualifiers.join(' ');
  const q = encodeURIComponent(`is:open is:pr ${qualifier}`);
  const url = `https://api.github.com/search/issues?q=${q}&advanced_search=true&sort=updated&order=desc&per_page=20`;

  const r = await ctx.fetchJSON(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'stackyard-dashboard/1.0',
    },
    timeout: 10000,
  });

  if (r.status === 401) ctx.fail('Invalid GitHub token', { kind: ctx.KIND.AUTH });
  if (r.status === 422) ctx.fail('Invalid search query — check username', { kind: ctx.KIND.INVALID });
  if (r.status >= 400) ctx.fail('GitHub HTTP ' + r.status);
  if (!Array.isArray(r.data?.items)) ctx.fail('GitHub returned no search results');

  const items = r.data.items.map(pr => {
    const m = (pr.repository_url || '').match(/repos\/(.+)$/);
    return { number: pr.number, title: pr.title, repo: m ? m[1] : '—', url: pr.html_url };
  });

  const allUrl = `https://github.com/pulls?q=${encodeURIComponent(`is:open is:pr ${qualifier}`)}`;

  /* The filters travel as keys. Naming them here would send English to a page
     that already holds the translation. */
  return { view: 'prs', totalCount: r.data?.total_count ?? items.length, filters: filterArr, allUrl, items };
}

const GITEA_FILTER = {
  created: 'created',
  assigned: 'assigned',
  mentioned: 'mentioned',
  'review-requested': 'review_requested',
};

async function giteaPullRequests(ctx, base, token, config, name) {
  const filterArr = prFilters(config).filter(f => Object.hasOwn(GITEA_FILTER, f));
  if (!filterArr.length) filterArr.push('created');
  const q = new URLSearchParams({ type: 'pulls', state: 'open', limit: '20' });
  for (const f of filterArr) q.set(GITEA_FILTER[f], 'true');
  if (config.githubService === 'forgejo') q.set('sort', 'recentupdate');
  const r = await ctx.fetchJSON(`${base}/api/v1/repos/issues/search?${q}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/json' },
    withHeaders: true,
    timeout: 10000,
  });
  replyStatus(ctx, r, name);
  if (!Array.isArray(r.data)) ctx.fail(`${name} returned no search results`);

  const items = r.data.map(pr => ({
    number: pr?.number,
    title: pr?.title,
    repo: pr?.repository?.full_name || '—',
    url: pr?.html_url,
  }));
  return {
    view: 'prs',
    totalCount: headerCount(r, 'x-total-count', items.length),
    filters: filterArr,
    allUrl: ctx.serviceLink(config.githubHref, base, '/pulls'),
    items,
  };
}

async function giteaContributions(ctx, base, token, username, name) {
  const r = await ctx.fetchJSON(`${base}/api/v1/users/${encodeURIComponent(username)}/heatmap`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/json' },
    timeout: 10000,
  });
  replyStatus(ctx, r, name);
  if (!Array.isArray(r.data)) ctx.fail(`${name} returned no contribution heatmap`);
  const since = Date.now() / 1000 - 380 * 86400;
  const slots = [];
  for (const s of r.data) {
    const t = Number(s?.timestamp);
    const c = Number(s?.contributions);
    if (Number.isFinite(t) && t >= since && Number.isFinite(c) && c > 0) slots.push([t, c]);
  }
  return {
    view: 'contributions',
    slots,
    profileUrl: ctx.serviceLink(ctx.config.githubHref, base, '/' + encodeURIComponent(username)),
  };
}

const GITLAB_FILTER = {
  created: 'author_username',
  assigned: 'assignee_username',
  'review-requested': 'reviewer_username',
};

async function gitlabMergeRequests(ctx, base, token, username, config) {
  const filterArr = prFilters(config).filter(f => Object.hasOwn(GITLAB_FILTER, f));
  if (!filterArr.length) filterArr.push('created');
  const q = new URLSearchParams({
    state: 'opened',
    scope: 'all',
    order_by: 'updated_at',
    sort: 'desc',
    per_page: '20',
  });
  for (const f of filterArr) q.set(GITLAB_FILTER[f], username);
  const r = await ctx.fetchJSON(`${base}/api/v4/merge_requests?${q}`, {
    headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
    withHeaders: true,
    timeout: 10000,
  });
  replyStatus(ctx, r, 'GitLab');
  if (!Array.isArray(r.data)) ctx.fail('GitLab returned no merge requests');

  const items = r.data.map(mr => ({
    number: mr?.iid,
    title: mr?.title,
    repo: String(mr?.references?.full || '').replace(/!\d+$/, '') || '—',
    url: mr?.web_url,
  }));
  return {
    view: 'prs',
    totalCount: headerCount(r, 'x-total', items.length),
    filters: filterArr,
    allUrl: ctx.serviceLink(config.githubHref, base, '/dashboard/merge_requests'),
    items,
  };
}
