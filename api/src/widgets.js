const fs = require('fs');
const path = require('path');
const { on, json } = require('./router');
const log = require('./log');
const { translateEntry } = require('./widget-i18n');
const { loadConfig } = require('./config');

/* In the container the UI is copied to the nginx web root, so the API is pointed
   at that path. */
const WIDGETS_PATH = process.env.WIDGETS_PATH || '/usr/share/nginx/html/widgets';

const VALID_SIZES = new Set(['small', 'medium', 'large', 'xlarge']);
const VALID_CARDS = new Set(['dark', 'light', 'translucent']);
const VALID_FIELDTYPES = new Set([
  'text',
  'secret',
  'number',
  'toggle',
  'color',
  'select',
  'multiselect',
  'picklist',
  'group',
  'object',
]);

let _registry = null;
/* Kept beside the registry, never in it: a lookup by widgetType must not resolve
   to a rejected widget. */
let _rejected = [];

/* Siblings may share a key to swap a label per service type, but only one may be
   visible at a time or the last one read silently wins. */
function _validateSiblingKeys(fields, where) {
  const errs = [];
  const counts = Object.create(null);
  for (const f of fields) {
    if (!f || typeof f.key !== 'string' || !f.key) continue;
    counts[f.key] = (counts[f.key] || 0) + 1;
  }
  const reported = new Set();
  for (const f of fields) {
    if (!f || typeof f.key !== 'string' || !f.key) continue;
    if (counts[f.key] < 2 || reported.has(f.key)) continue;
    if (fields.some(o => o && o.key === f.key && !o.showIf)) {
      errs.push(`${where}: key "${f.key}" is declared more than once, so every declaration needs a "showIf"`);
      reported.add(f.key);
    }
  }
  return errs;
}

/* Shape only; _validateShowIfTargets checks the target, which needs the whole
   sibling list. Both failures are silent: a condition that can never be met
   hides the field for good, and looks like a missing feature. */
function _validateShowIf(f, where) {
  if (f.showIf === undefined) return [];
  const s = f.showIf;
  if (!s || typeof s !== 'object' || Array.isArray(s))
    return [`${where}: field "${f.key}" has a "showIf" that is not an object`];
  const errs = [];
  if (typeof s.field !== 'string' || !s.field) errs.push(`${where}: field "${f.key}" needs a non-empty "showIf.field"`);
  if (s.equals === undefined && s.in === undefined)
    errs.push(`${where}: field "${f.key}" "showIf" needs "equals" or "in"`);
  if (s.in !== undefined && (!Array.isArray(s.in) || !s.in.length))
    errs.push(`${where}: field "${f.key}" "showIf.in" must be a non-empty array`);
  return errs;
}

/* Conditions resolve within a sibling set, so naming a field outside it hides
   the dependant for good. */
function _validateShowIfTargets(fields, where) {
  const keys = new Set(fields.filter(f => f && typeof f.key === 'string' && f.key).map(f => f.key));
  const errs = [];
  for (const f of fields) {
    const dep = f && f.showIf && typeof f.showIf === 'object' ? f.showIf.field : undefined;
    if (typeof dep !== 'string' || !dep) continue;
    if (!keys.has(dep))
      errs.push(`${where}: field "${f.key}" has a "showIf" on "${dep}", which is not one of its sibling fields`);
    else if (dep === f.key) errs.push(`${where}: field "${f.key}" has a "showIf" on itself`);
  }
  return errs;
}

/* Deliberately permissive about unknown keys, so the manifest format can grow
   without breaking older widgets. */
function _validateField(f, where, depth = 0) {
  const errs = [];
  if (!f || typeof f !== 'object') {
    errs.push(`${where}: field must be an object`);
    return errs;
  }
  if (typeof f.key !== 'string' || !f.key) errs.push(`${where}: field needs a non-empty "key"`);
  errs.push(..._validateShowIf(f, where));
  if (!VALID_FIELDTYPES.has(f.type)) errs.push(`${where}: field "${f.key}" has unknown type "${f.type}"`);
  if (typeof f.label !== 'string' || !f.label) errs.push(`${where}: field "${f.key}" needs a "label"`);
  if (
    (f.type === 'select' || f.type === 'multiselect' || f.type === 'picklist') &&
    !Array.isArray(f.options) &&
    typeof f.optionsFrom !== 'string'
  )
    errs.push(`${where}: ${f.type} "${f.key}" needs "options" or "optionsFrom"`);
  if (f.type === 'picklist' && f.count === undefined && f.countBySize === undefined)
    errs.push(`${where}: picklist "${f.key}" needs "count" or "countBySize"`);
  if (f.type === 'group' || f.type === 'object') {
    if (depth > 0) {
      errs.push(`${where}: ${f.type} "${f.key}" cannot be nested inside another group or object`);
    } else if (!Array.isArray(f.fields) || !f.fields.length)
      errs.push(`${where}: ${f.type} "${f.key}" needs a non-empty "fields" array`);
    else {
      f.fields.forEach((sf, i) => errs.push(..._validateField(sf, `${where}.${f.key}[${i}]`, depth + 1)));
      errs.push(..._validateSiblingKeys(f.fields, `${where}.${f.key}`));
      errs.push(..._validateShowIfTargets(f.fields, `${where}.${f.key}`));
    }
  }
  return errs;
}

/* An option's stored value, for the two shapes a select accepts: a bare string,
   or { value, label }. */
const _optionValue = o => (o && typeof o === 'object' ? o.value : o);

/* A typo in "viewField" fails silently: the widget pins to defaultView and the
   selector does nothing. Only a field declaring "options" can be checked, since
   "optionsFrom" fetches its choices at runtime. */
function _validateViewField(m) {
  const errs = [];
  const fields = Array.isArray(m.fields) ? m.fields : [];
  const field = fields.find(f => f && f.key === m.viewField);
  if (!field) return [`"viewField" ("${m.viewField}") is not a declared field`];
  if (!Array.isArray(field.options)) return errs;

  const values = new Set(field.options.map(_optionValue).filter(v => typeof v === 'string'));
  for (const vk of Object.keys(m.views)) {
    if (!values.has(vk))
      errs.push(`view "${vk}" cannot be selected: "${m.viewField}" offers no option with that value`);
  }
  for (const v of values) {
    if (!Object.hasOwn(m.views, v)) errs.push(`"${m.viewField}" offers "${v}", which is not a declared view`);
  }
  return errs;
}

/* Validate a parsed widget.json. Returns { errors:[...] }. */
function validateManifest(name, m) {
  const errs = [];
  if (!m || typeof m !== 'object') return { errors: ['manifest is not an object'] };
  if (typeof m.name !== 'string' || !m.name) errs.push('missing "name"');
  if (m.name && m.name !== name) errs.push(`"name" ("${m.name}") must match the folder name ("${name}")`);
  if (typeof m.label !== 'string' || !m.label) errs.push('missing "label"');
  if (!Array.isArray(m.sizes) || !m.sizes.length) errs.push('"sizes" must be a non-empty array');
  else
    m.sizes.forEach(s => {
      if (!VALID_SIZES.has(s)) errs.push(`unknown size "${s}"`);
    });

  if (m.card !== undefined && !VALID_CARDS.has(m.card)) errs.push(`unknown card "${m.card}"`);

  if (m.fields !== undefined) {
    if (!Array.isArray(m.fields)) errs.push('"fields" must be an array');
    else {
      m.fields.forEach((f, i) => errs.push(..._validateField(f, `fields[${i}]`)));
      errs.push(..._validateSiblingKeys(m.fields, 'fields'));
      errs.push(..._validateShowIfTargets(m.fields, 'fields'));
    }
  }

  if (m.views !== undefined) {
    if (typeof m.views !== 'object' || Array.isArray(m.views) || !Object.keys(m.views).length)
      errs.push('"views" must be a non-empty object');
    else
      for (const [vk, v] of Object.entries(m.views)) {
        if (!v || typeof v !== 'object') {
          errs.push(`view "${vk}" must be an object`);
          continue;
        }
        if (typeof v.src !== 'string' || !v.src) errs.push(`view "${vk}" needs an entry file "src"`);
        if (v.label !== undefined && (typeof v.label !== 'string' || !v.label))
          errs.push(`view "${vk}" "label" must be a non-empty string`);
        if (v.card !== undefined && !VALID_CARDS.has(v.card)) errs.push(`view "${vk}" has unknown card "${v.card}"`);
        if (v.sizes !== undefined) {
          if (!Array.isArray(v.sizes) || !v.sizes.length) errs.push(`view "${vk}" "sizes" must be a non-empty array`);
          else if (Array.isArray(m.sizes)) {
            v.sizes.forEach(sz => {
              if (!m.sizes.includes(sz)) errs.push(`view "${vk}" size "${sz}" is not one of the widget's own sizes`);
            });
          }
        }
      }
  }

  if (m.viewField !== undefined || m.defaultView !== undefined) {
    const hasViews = m.views && typeof m.views === 'object' && !Array.isArray(m.views);
    if (!hasViews) errs.push('"viewField"/"defaultView" require a "views" block');
    else {
      if (m.viewField !== undefined && (typeof m.viewField !== 'string' || !m.viewField))
        errs.push('"viewField" must be a non-empty string');
      else if (typeof m.viewField === 'string') errs.push(..._validateViewField(m));
      if (m.defaultView !== undefined) {
        if (typeof m.defaultView !== 'string' || !m.defaultView) errs.push('"defaultView" must be a non-empty string');
        else if (!Object.hasOwn(m.views, m.defaultView))
          errs.push(`"defaultView" ("${m.defaultView}") is not a declared view`);
      }
    }
  }
  return { errors: errs };
}

/* A folder without widget.json is skipped, not refused: the legacy flat-file
   widgets coexist, and an empty registry is a valid result.

   Null prototype, because every caller looks a widget up by a widgetType from
   config: on an ordinary object, "constructor" answers a miss with something
   truthy. */
function loadRegistry() {
  const reg = Object.create(null);
  const rejected = [];
  let entries;
  try {
    entries = fs.readdirSync(WIDGETS_PATH, { withFileTypes: true });
  } catch (e) {
    log.warn('widget registry: directory not readable', { path: WIDGETS_PATH, error: e.message });
    _registry = reg;
    _rejected = rejected;
    return reg;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    const dir = path.join(WIDGETS_PATH, name);
    const manPath = path.join(dir, 'widget.json');
    if (!fs.existsSync(manPath)) continue; /* not a folder-style widget, skip */

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    } catch (e) {
      log.warn('widget registry: invalid JSON, skipped', { widget: name, error: e.message });
      /* The parser's message names the syntax problem and a character offset,
         never file content, so it is safe to show an operator. */
      rejected.push({ name, errors: [`widget.json is not valid JSON: ${e.message}`] });
      continue;
    }

    const { errors } = validateManifest(name, manifest);
    if (errors.length) {
      log.warn('widget registry: invalid manifest, skipped', { widget: name, errors });
      rejected.push({ name, errors });
      continue;
    }

    reg[name] = {
      manifest,
      dir,
      hasDataFn: fs.existsSync(path.join(dir, 'data.js')),
      hasDemoFn: fs.existsSync(path.join(dir, 'demo.js')),
    };
  }

  log.info('widget registry loaded', { count: Object.keys(reg).length, widgets: Object.keys(reg) });
  _registry = reg;
  _rejected = rejected;
  return reg;
}

/* Why each refused widget was refused. Loading the registry fills this, so a
   caller that has not loaded yet gets the answer rather than an empty list. */
function getRejected() {
  if (!_registry) loadRegistry();
  return _rejected;
}

/* Lazily built on first use, then cached. Widgets are baked into the image and
   do not change at runtime, so a single load is sufficient. */
function getRegistry() {
  if (!_registry) loadRegistry();
  return _registry;
}

/* The browser-facing shape, carrying nothing the backend keeps to itself.

   Translated here rather than in the browser: this is the one place a manifest
   becomes browser-facing, and the settings form then receives ordinary strings
   and needs to know nothing about catalogs. */
function _publicEntry(name, e, lang) {
  const m = e.manifest;
  return translateEntry(
    {
      name: m.name,
      label: m.label,
      sizes: m.sizes,
      card: m.card || null,
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
  /* Safe to send: the errors describe files inside the image, and this route is
     behind the auth gate. */
  json(res, 200, { widgets: list, rejected: getRejected() });
});

module.exports = { getRegistry, getRejected, loadRegistry, validateManifest, WIDGETS_PATH };
