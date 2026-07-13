const fs   = require('fs');
const path = require('path');
const { on, json } = require('./router');
const log = require('./log');

/* Where folder-style widgets live. In the container the UI is copied to the
   Nginx web root, so the API (running from /app) is pointed at that path. The
   files are world-readable, so the unprivileged API user can read them. */
const WIDGETS_PATH = process.env.WIDGETS_PATH || '/usr/share/nginx/html/widgets';

const VALID_SIZES      = new Set(['small', 'medium', 'large', 'xlarge']);
const VALID_FIELDTYPES = new Set(['text', 'secret', 'number', 'toggle', 'select', 'multiselect', 'group', 'object']);
const VALID_AUTHTYPES  = new Set(['none', 'basic', 'bearer', 'header', 'query']);

let _registry = null;

/* Validate one field declaration. Recurses into group sub-fields. Returns an
   array of human-readable problems (empty = valid). Kept permissive: unknown
   extra keys are allowed so the format can grow without breaking older widgets. */
function _validateField(f, where, depth = 0) {
  const errs = [];
  if (!f || typeof f !== 'object') { errs.push(`${where}: field must be an object`); return errs; }
  if (typeof f.key !== 'string' || !f.key) errs.push(`${where}: field needs a non-empty "key"`);
  if (!VALID_FIELDTYPES.has(f.type))        errs.push(`${where}: field "${f.key}" has unknown type "${f.type}"`);
  if (typeof f.label !== 'string' || !f.label) errs.push(`${where}: field "${f.key}" needs a "label"`);
  if ((f.type === 'select' || f.type === 'multiselect') && !Array.isArray(f.options) && typeof f.optionsFrom !== 'string')
    errs.push(`${where}: ${f.type} "${f.key}" needs "options" or "optionsFrom"`);
  if (f.type === 'group' || f.type === 'object') {
    if (depth > 0) { errs.push(`${where}: ${f.type} "${f.key}" cannot be nested inside another group or object`); }
    else if (!Array.isArray(f.fields) || !f.fields.length) errs.push(`${where}: ${f.type} "${f.key}" needs a non-empty "fields" array`);
    else f.fields.forEach((sf, i) => errs.push(..._validateField(sf, `${where}.${f.key}[${i}]`, depth + 1)));
  }
  return errs;
}

/* Validate a parsed widget.json. Returns { errors:[...] }. */
function _validateManifest(name, m) {
  const errs = [];
  if (!m || typeof m !== 'object') return { errors:['manifest is not an object'] };
  if (typeof m.name !== 'string' || !m.name) errs.push('missing "name"');
  if (m.name && m.name !== name) errs.push(`"name" ("${m.name}") must match the folder name ("${name}")`);
  if (typeof m.label !== 'string' || !m.label) errs.push('missing "label"');
  if (!Array.isArray(m.sizes) || !m.sizes.length) errs.push('"sizes" must be a non-empty array');
  else m.sizes.forEach(s => { if (!VALID_SIZES.has(s)) errs.push(`unknown size "${s}"`); });

  if (m.fields !== undefined) {
    if (!Array.isArray(m.fields)) errs.push('"fields" must be an array');
    else m.fields.forEach((f, i) => errs.push(..._validateField(f, `fields[${i}]`)));
  }

  if (m.data !== undefined) {
    if (typeof m.data !== 'object') errs.push('"data" must be an object');
    else {
      const a = m.data.auth;
      if (a !== undefined) {
        if (typeof a !== 'object' || !VALID_AUTHTYPES.has(a.type)) errs.push(`"data.auth.type" must be one of: ${[...VALID_AUTHTYPES].join(', ')}`);
      }
      if (m.data.endpoints !== undefined && typeof m.data.endpoints !== 'object')
        errs.push('"data.endpoints" must be an object of name → path');
    }
  }

  if (m.views !== undefined) {
    if (typeof m.views !== 'object' || !Object.keys(m.views).length) errs.push('"views" must be a non-empty object');
    else for (const [vk, v] of Object.entries(m.views)) {
      if (!v || typeof v !== 'object') { errs.push(`view "${vk}" must be an object`); continue; }
      if (typeof v.label !== 'string' || !v.label) errs.push(`view "${vk}" needs a "label"`);
      if (typeof v.src !== 'string' || !v.src)     errs.push(`view "${vk}" needs an entry file "src"`);
    }
  }
  return { errors: errs };
}

/* Scan the widgets directory and build the registry. Each entry records the
   parsed manifest plus whether the folder ships a data function or a custom
   editor (their presence, not their contents — those are loaded elsewhere).
   A missing directory, a non-folder entry, or a folder without widget.json is
   simply skipped: the legacy flat-file widgets coexist untouched, and an empty
   registry is a valid result. A malformed widget.json is skipped with a logged
   reason rather than crashing the server. */
function loadRegistry() {
  const reg = {};
  let entries;
  try {
    entries = fs.readdirSync(WIDGETS_PATH, { withFileTypes: true });
  } catch (e) {
    log.warn('widget registry: directory not readable', { path: WIDGETS_PATH, error: e.message });
    _registry = reg;
    return reg;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name     = ent.name;
    const dir      = path.join(WIDGETS_PATH, name);
    const manPath  = path.join(dir, 'widget.json');
    if (!fs.existsSync(manPath)) continue; /* not a folder-style widget — skip */

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    } catch (e) {
      log.warn('widget registry: invalid JSON, skipped', { widget: name, error: e.message });
      continue;
    }

    const { errors } = _validateManifest(name, manifest);
    if (errors.length) {
      log.warn('widget registry: invalid manifest, skipped', { widget: name, errors });
      continue;
    }

    reg[name] = {
      manifest,
      hasDataFn:    fs.existsSync(path.join(dir, 'data.js')),
      customEditor: fs.existsSync(path.join(dir, 'config.js')) || manifest.customEditor === true,
    };
  }

  log.info('widget registry loaded', { count: Object.keys(reg).length, widgets: Object.keys(reg) });
  _registry = reg;
  return reg;
}

/* Lazily built on first use, then cached. Widgets are baked into the image and
   do not change at runtime, so a single load is sufficient. */
function getRegistry() {
  if (!_registry) loadRegistry();
  return _registry;
}

/* The browser-facing shape: everything the dashboard and admin UI need to draw
   the type picker, the config editor, and the widget iframe — and nothing the
   backend keeps to itself (the "data" routing block stays server-side). */
function _publicEntry(_name, e) {
  const m = e.manifest;
  return {
    name:         m.name,
    label:        m.label,
    sizes:        m.sizes,
    fields:       m.fields || [],
    views:        m.views || null,
    customEditor: e.customEditor,
  };
}

on('GET', '/api/widgets', (_, res) => {
  const reg  = getRegistry();
  const list = Object.entries(reg).map(([name, e]) => _publicEntry(name, e));
  json(res, 200, { widgets: list });
});

module.exports = { getRegistry, loadRegistry, WIDGETS_PATH };
