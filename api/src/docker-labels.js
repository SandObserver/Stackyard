/* Labels can carry widget API keys. Only these fields leave the server. */
const FIELDS = Object.freeze(['name', 'group', 'href', 'icon', 'description', 'siteMonitor', 'ping', 'weight']);

/** One entry per container that carries a `homepage.` label, in list order.
    @param {unknown} list the body of GET /containers/json
    @returns {Array<{ container: string, labels: Record<string, string>, widget: boolean }>} */
function homepageLabels(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const all = c && typeof c.Labels === 'object' && c.Labels ? c.Labels : {};
    const keys = Object.keys(all).filter(k => k.startsWith('homepage.'));
    if (!keys.length) continue;
    const name = Array.isArray(c.Names) && typeof c.Names[0] === 'string' ? c.Names[0].replace(/^\//, '') : '';
    /** @type {Record<string, string>} */
    const labels = {};
    for (const f of FIELDS) {
      const v = all[`homepage.${f}`];
      if (typeof v === 'string') labels[f] = v;
    }
    const widget = keys.some(k => /^homepage\.widgets?[.[]/.test(k));
    out.push({ container: name, labels, widget });
  }
  return out;
}

module.exports = { homepageLabels };
