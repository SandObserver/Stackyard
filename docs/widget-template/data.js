module.exports = async function (ctx) {
  const { url, apiKey, href } = ctx.config;
  const base = ctx.normalizeBase(url);
  if (!base) ctx.fail('Server URL not configured', { kind: ctx.KIND.INVALID });

  const r = await ctx.fetchJSON(`${base}/api/status`, {
    headers: apiKey ? { 'X-Api-Key': apiKey } : {},
    timeout: 8000,
  });
  if (r.status === 401 || r.status === 403) ctx.fail('Auth failed (check API key)', { kind: ctx.KIND.AUTH });
  if (r.status >= 400) ctx.fail('HTTP ' + r.status);
  if (typeof r.data?.count !== 'number') ctx.fail('Reply has no count');

  return { count: r.data.count, link: ctx.serviceLink(href, url) };
};
