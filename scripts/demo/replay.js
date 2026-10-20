(() => {
  const INDEX = '__REPLAY_INDEX__';
  const realFetch = window.fetch.bind(window);
  const loaded = new Map();
  /* A failed load is dropped, so the next request retries it. Kept, it fails every
     later request until the page reloads. */
  const load = path => {
    if (!loaded.has(path)) {
      const p = realFetch(path).then(r => {
        if (!r.ok) throw new Error(`${path} answered ${r.status}`);
        return r.json();
      });
      p.catch(() => loaded.delete(path));
      loaded.set(path, p);
    }
    return loaded.get(path);
  };
  const ISO_DATE = /"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"/g;

  async function answer(d, method, url) {
    const path = url.pathname + url.search;
    const fixed = d.fixed[`${method} ${path}`];
    if (fixed) return fixed;
    const series = method === 'GET' && d.series[path];
    if (series) {
      const span = d.step * d.count;
      const i = Math.floor(((((Date.now() - d.start) % span) + span) % span) / d.step);
      const [status, body] = (await load(`/demo-replay/${series[Math.floor(i / d.chunk)]}`))[i % d.chunk];
      /* Keep this shift. Without it, widgets show every reading as stale. */
      const shift = Date.now() - (d.start + i * d.step);
      return [status, body.replace(ISO_DATE, (_, iso) => `"${new Date(Date.parse(iso) + shift).toISOString()}"`)];
    }
    for (const [pattern, recorded] of d.routes) {
      if (pattern.method === method && new RegExp(pattern.path).test(url.pathname)) return recorded;
    }
    console.warn('[demo-replay] not recorded:', method, path);
    return d.missing;
  }

  window.fetch = async (input, init) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method || req?.method || 'GET').toUpperCase();
    const [status, body] = await answer(await load(INDEX), method, url);
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  };
})();
