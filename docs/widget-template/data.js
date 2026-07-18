module.exports = async function (ctx) {
  const { url, apiKey } = ctx.config;
  if (!url) return { error: 'Not configured' };

  const base = ctx.normalizeBase(url);
  const r = await ctx.fetchJSON(`${base}/api/items`, {
    headers: apiKey ? { 'X-Api-Key': apiKey } : {},
    timeout: 8000,
  });

  return {
    items: (r.data.items || []).slice(0, 10).map(i => ({ name: i.name })),
    total: r.data.total ?? 0,
  };
};
