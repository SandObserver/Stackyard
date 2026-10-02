module.exports = async function (ctx) {
  const { url, apiKey } = ctx.config;
  if (!url) ctx.fail('Not configured', { kind: ctx.KIND.INVALID });

  const base = ctx.normalizeBase(url);
  const r = await ctx.fetchJSON(`${base}/api/items`, {
    headers: apiKey ? { 'X-Api-Key': apiKey } : {},
    timeout: 8000,
  });
  if (r.status === 401 || r.status === 403) ctx.fail('Auth failed (check API key)', { kind: ctx.KIND.AUTH });
  if (r.status >= 400) ctx.fail('HTTP ' + r.status);
  if (!r.data || !Array.isArray(r.data.items)) ctx.fail('Reply has no items');

  return {
    items: r.data.items.slice(0, 10).map(i => ({ name: i.name })),
    total: r.data.total ?? r.data.items.length,
  };
};
