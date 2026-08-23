module.exports = async function (ctx) {
  const { config, fetchJSON } = ctx;
  const token = config.githubToken;
  if (!token) ctx.fail('GitHub token not configured', { kind: ctx.KIND.INVALID });

  const username = config.githubUser;
  if (!username) ctx.fail('GitHub username not configured', { kind: ctx.KIND.INVALID });

  if (config.githubView === 'contributions') return contributions(ctx, token, username, fetchJSON);
  return pullRequests(ctx, token, username, config, fetchJSON);
};

/* Needs a classic PAT with read:user, or a fine-grained PAT with "User
   contributions" read access. */
async function contributions(ctx, token, username, fetchJSON) {
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
  const r = await fetchJSON('https://api.github.com/graphql', {
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

  const cal = r.data?.data?.user?.contributionsCollection?.contributionCalendar || {};
  return { view: 'contributions', weeks: cal.weeks || [], totalContributions: cal.totalContributions || 0 };
}

async function pullRequests(ctx, token, username, config, fetchJSON) {
  const raw =
    Array.isArray(config.githubPrFilters) && config.githubPrFilters.length
      ? config.githubPrFilters
      : [config.githubPrFilter || 'created'];
  const filterArr = Array.isArray(raw) ? raw : [raw];

  const qualifiers = filterArr.map(f => {
    if (f === 'assigned') return `assignee:${username}`;
    if (f === 'mentioned') return `mentions:${username}`;
    if (f === 'review-requested') return `review-requested:${username}`;
    return `author:${username}`;
  });
  const qualifier = qualifiers.join(' ');
  const q = encodeURIComponent(`is:open is:pr ${qualifier}`);
  const url = `https://api.github.com/search/issues?q=${q}&advanced_search=true&sort=updated&order=desc&per_page=20`;

  const r = await fetchJSON(url, {
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

  const items = (r.data?.items || []).map(pr => {
    const m = (pr.repository_url || '').match(/repos\/(.+)$/);
    return { number: pr.number, title: pr.title, repo: m ? m[1] : '—', url: pr.html_url };
  });

  const allUrl = `https://github.com/pulls?q=${encodeURIComponent(`is:open is:pr ${qualifier}`)}`;

  /* The filters travel as keys. Naming them here would send English to a page
     that already holds the translation. */
  return { view: 'prs', totalCount: r.data?.total_count ?? items.length, filters: filterArr, allUrl, items };
}
