/* GitHub widget data function.
   The token is shared across the dashboard (settings.githubToken), so it comes
   from ctx.settings rather than the widget's own config. Returns { error } on
   any failure so the widget can show a friendly message (never throws). */

module.exports = async function ({ config, fetchJSON }) {
  const token = config.githubToken;
  if (!token) return { error: 'GitHub token not configured' };

  const username = config.githubUser;
  if (!username) return { error: 'GitHub username not configured' };

  if (config.githubView === 'contributions') return contributions(token, username, fetchJSON);
  return pullRequests(token, username, config, fetchJSON);
};

/* Contribution calendar via GraphQL — needs a classic PAT with read:user, or a
   fine-grained PAT with "User contributions" read access. Private-repo
   contributions only appear with the correct token scope. */
async function contributions(token, username, fetchJSON) {
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
  let r;
  try {
    r = await fetchJSON('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'stackyard-dashboard/1.0',
      },
      body: JSON.stringify({ query, variables: { login: username } }),
      timeout: 10000,
    });
  } catch (e) { return { error: e.message }; }

  if (r.status === 401) return { error: 'Invalid GitHub token' };
  if (r.data && r.data.errors) return { error: r.data.errors[0]?.message || 'GraphQL error' };

  const cal = r.data?.data?.user?.contributionsCollection?.contributionCalendar || {};
  return { view: 'contributions', weeks: cal.weeks || [], totalContributions: cal.totalContributions || 0 };
}

/* Open pull requests via the search API. Multiple filters are OR-ed together. */
async function pullRequests(token, username, config, fetchJSON) {
  const raw = (Array.isArray(config.githubPrFilters) && config.githubPrFilters.length)
    ? config.githubPrFilters
    : [config.githubPrFilter || 'created'];
  const filterArr = Array.isArray(raw) ? raw : [raw];

  const qualifiers = filterArr.map(f => {
    if (f === 'assigned')         return `assignee:${username}`;
    if (f === 'mentioned')        return `mentions:${username}`;
    if (f === 'review-requested') return `review-requested:${username}`;
    return `author:${username}`;
  });
  const qualifier = qualifiers.join(' ');
  const q   = encodeURIComponent(`is:open is:pr ${qualifier}`);
  const url = `https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=20`;

  let r;
  try {
    r = await fetchJSON(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'stackyard-dashboard/1.0',
      },
      timeout: 10000,
    });
  } catch (e) { return { error: e.message }; }

  if (r.status === 401) return { error: 'Invalid GitHub token' };
  if (r.status === 422) return { error: 'Invalid search query — check username' };

  const items = (r.data?.items || []).map(pr => {
    const m = (pr.repository_url || '').match(/repos\/(.+)$/);
    return { number: pr.number, title: pr.title, repo: m ? m[1] : '—', url: pr.html_url };
  });

  const labelMap = {
    'created': 'created', 'assigned': 'assigned',
    'mentioned': 'mentioned', 'review-requested': 'review requested',
  };
  const label  = filterArr.map(f => labelMap[f] || f).join(', ');
  const allUrl = `https://github.com/pulls?q=${encodeURIComponent(`is:open is:pr ${qualifier}`)}`;

  return { view: 'prs', totalCount: r.data?.total_count ?? items.length, label, allUrl, items };
}
