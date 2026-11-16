const { on, json } = require('../router');
const { loadConfig } = require('../config');
const { translateEntry } = require('../widget-i18n');
const { getRegistry, getRejected } = require('../widget-registry');

/* The browser-facing shape, carrying nothing the backend keeps to itself. */
function _publicEntry(name, e, lang) {
  const m = e.manifest;
  return translateEntry(
    {
      name: m.name,
      label: m.label,
      description: m.description || null,
      glyph: m.glyph || null,
      sizes: m.sizes,
      card: m.card || null,
      appearance: m.appearance || null,
      fields: m.fields || [],
      views: m.views || null,
      viewField: m.viewField || null,
      defaultView: m.defaultView || null,
      entryVersions: m.entryVersions || null,
    },
    e.dir,
    name,
    lang,
  );
}

on('GET', '/api/widgets', (_, res) => {
  const reg = getRegistry();
  const lang = loadConfig().settings?.language || 'en';
  const list = Object.entries(reg).map(([name, e]) => _publicEntry(name, e, lang));
  json(res, 200, { widgets: list, rejected: getRejected() });
});
