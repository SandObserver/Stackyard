const fs   = require('fs');
const path = require('path');
const { on, json } = require('./router');
const log = require('./log');

/* Where folder-style widgets live. In the container the UI is copied to the
   Nginx web root, so the API (running from /app) is pointed at that path. The
   files are world-readable, so the unprivileged API user can read them. */
const WIDGETS_PATH = process.env.WIDGETS_PATH || '/usr/share/nginx/html/widgets';

const VALID_SIZES      = new Set(['small', 'medium', 'large', 'xlarge']);
const VALID_CARDS      = new Set(['dark', 'light', 'translucent']);
const VALID_FIELDTYPES = new Set(['text', 'secret', 'number', 'toggle', 'color', 'select', 'multiselect', 'picklist', 'group', 'object']);

let _registry = null;

/* Two sibling fields may share a key so that one label and placeholder can be
   swapped for another, for example a URL that is named differently per service
   type. Only one may be visible at a time, or the last one read silently wins,
   so every declaration of a repeated key has to carry a "showIf". */
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

/* Validate a field's "showIf". Shape only; whether it names a real sibling is
   checked by _validateShowIfTargets, which needs the whole sibling list.

   Nothing checked this before, and the ways it fails are all silent. A showIf
   whose "field" names nothing resolves to undefined in visibleFieldKeys, so the
   condition is never met and the field is hidden for good, which looks like a
   missing feature rather than a typo. A showIf that is not an object at all
   (showIf: true) also satisfies the repeated-key rule below while carrying no
   condition, so both declarations of that key end up permanently hidden. */
function _validateShowIf(f, where) {
  if (f.showIf === undefined) return [];
  const s = f.showIf;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [`${where}: field "${f.key}" has a "showIf" that is not an object`];
  const errs = [];
  if (typeof s.field !== 'string' || !s.field) errs.push(`${where}: field "${f.key}" needs a non-empty "showIf.field"`);
  if (s.equals === undefined && s.in === undefined) errs.push(`${where}: field "${f.key}" "showIf" needs "equals" or "in"`);
  if (s.in !== undefined && (!Array.isArray(s.in) || !s.in.length)) errs.push(`${where}: field "${f.key}" "showIf.in" must be a non-empty array`);
  return errs;
}

/* Every showIf must name one of its own siblings. Conditions are resolved
   within a sibling set, so a group sub-field cannot depend on a top-level one
   and naming it would hide the sub-field for good. */
function _validateShowIfTargets(fields, where) {
  const keys = new Set(fields.filter(f => f && typeof f.key === 'string' && f.key).map(f => f.key));
  const errs = [];
  for (const f of fields) {
    const dep = f && f.showIf && typeof f.showIf === 'object' ? f.showIf.field : undefined;
    if (typeof dep !== 'string' || !dep) continue;
    if (!keys.has(dep)) errs.push(`${where}: field "${f.key}" has a "showIf" on "${dep}", which is not one of its sibling fields`);
    else if (dep === f.key) errs.push(`${where}: field "${f.key}" has a "showIf" on itself`);
  }
  return errs;
}

/* Validate one field declaration. Recurses into group sub-fields. Returns an
   array of human-readable problems (empty = valid). Kept permissive: unknown
   extra keys are allowed so the format can grow without breaking older widgets. */
function _validateField(f, where, depth = 0) {
  const errs = [];
  if (!f || typeof f !== 'object') { errs.push(`${where}: field must be an object`); return errs; }
  if (typeof f.key !== 'string' || !f.key) errs.push(`${where}: field needs a non-empty "key"`);
  errs.push(..._validateShowIf(f, where));
  if (!VALID_FIELDTYPES.has(f.type))        errs.push(`${where}: field "${f.key}" has unknown type "${f.type}"`);
  if (typeof f.label !== 'string' || !f.label) errs.push(`${where}: field "${f.key}" needs a "label"`);
  if ((f.type === 'select' || f.type === 'multiselect' || f.type === 'picklist') && !Array.isArray(f.options) && typeof f.optionsFrom !== 'string')
    errs.push(`${where}: ${f.type} "${f.key}" needs "options" or "optionsFrom"`);
  if (f.type === 'picklist' && f.count === undefined && f.countBySize === undefined)
    errs.push(`${where}: picklist "${f.key}" needs "count" or "countBySize"`);
  if (f.type === 'group' || f.type === 'object') {
    if (depth > 0) { errs.push(`${where}: ${f.type} "${f.key}" cannot be nested inside another group or object`); }
    else if (!Array.isArray(f.fields) || !f.fields.length) errs.push(`${where}: ${f.type} "${f.key}" needs a non-empty "fields" array`);
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

/* "viewField" names the config key holding the chosen view, so it has to be a
   field the form actually renders, and the values that field offers have to be
   the view keys. Neither was checked, and both fail silently: widget-types.js
   reads widgetConfig[viewField], so a typo makes that permanently undefined and
   the widget pins to defaultView with the selector doing nothing, while an
   option with no matching view selects a view that does not exist.

   Only a field declaring "options" is checked against the view keys. One using
   "optionsFrom" fetches its choices at runtime, so there is nothing to compare
   here. */
function _validateViewField(m) {
  const errs = [];
  const fields = Array.isArray(m.fields) ? m.fields : [];
  const field = fields.find(f => f && f.key === m.viewField);
  if (!field) return [`"viewField" ("${m.viewField}") is not a declared field`];
  if (!Array.isArray(field.options)) return errs;

  const values = new Set(field.options.map(_optionValue).filter(v => typeof v === 'string'));
  for (const vk of Object.keys(m.views)) {
    if (!values.has(vk)) errs.push(`view "${vk}" cannot be selected: "${m.viewField}" offers no option with that value`);
  }
  for (const v of values) {
    if (!Object.hasOwn(m.views, v)) errs.push(`"${m.viewField}" offers "${v}", which is not a declared view`);
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

  if (m.card !== undefined && !VALID_CARDS.has(m.card))
    errs.push(`unknown card "${m.card}"`);

  if (m.fields !== undefined) {
    if (!Array.isArray(m.fields)) errs.push('"fields" must be an array');
    else {
      m.fields.forEach((f, i) => errs.push(..._validateField(f, `fields[${i}]`)));
      errs.push(..._validateSiblingKeys(m.fields, 'fields'));
      errs.push(..._validateShowIfTargets(m.fields, 'fields'));
    }
  }

  if (m.views !== undefined) {
    if (typeof m.views !== 'object' || Array.isArray(m.views) || !Object.keys(m.views).length) errs.push('"views" must be a non-empty object');
    else for (const [vk, v] of Object.entries(m.views)) {
      if (!v || typeof v !== 'object') { errs.push(`view "${vk}" must be an object`); continue; }
      if (typeof v.src !== 'string' || !v.src) errs.push(`view "${vk}" needs an entry file "src"`);
      if (v.label !== undefined && (typeof v.label !== 'string' || !v.label)) errs.push(`view "${vk}" "label" must be a non-empty string`);
      if (v.card !== undefined && !VALID_CARDS.has(v.card)) errs.push(`view "${vk}" has unknown card "${v.card}"`);
      if (v.sizes !== undefined) {
        if (!Array.isArray(v.sizes) || !v.sizes.length) errs.push(`view "${vk}" "sizes" must be a non-empty array`);
        else if (Array.isArray(m.sizes)) {
          v.sizes.forEach(sz => { if (!m.sizes.includes(sz)) errs.push(`view "${vk}" size "${sz}" is not one of the widget's own sizes`); });
        }
      }
    }
  }

  if (m.viewField !== undefined || m.defaultView !== undefined) {
    const hasViews = m.views && typeof m.views === 'object' && !Array.isArray(m.views);
    if (!hasViews) errs.push('"viewField"/"defaultView" require a "views" block');
    else {
      if (m.viewField !== undefined && (typeof m.viewField !== 'string' || !m.viewField)) errs.push('"viewField" must be a non-empty string');
      else if (typeof m.viewField === 'string') errs.push(..._validateViewField(m));
      if (m.defaultView !== undefined) {
        if (typeof m.defaultView !== 'string' || !m.defaultView) errs.push('"defaultView" must be a non-empty string');
        else if (!Object.hasOwn(m.views, m.defaultView)) errs.push(`"defaultView" ("${m.defaultView}") is not a declared view`);
      }
    }
  }
  return { errors: errs };
}

/* Scan the widgets directory and build the registry. Each entry records the
   parsed manifest, whether the folder ships a data function, and whether the
   manifest opts out of the auto-form.
   A missing directory, a non-folder entry, or a folder without widget.json is
   simply skipped: the legacy flat-file widgets coexist untouched, and an empty
   registry is a valid result. A malformed widget.json is skipped with a logged
   reason rather than crashing the server.

   Null prototype: every caller looks a widget up by the `widgetType` stored in
   config, so on an ordinary object `widgetType: "constructor"` returned a
   truthy value that is not a registry entry, and the "unknown widget type"
   branch never ran. Fixing it here fixes every lookup site at once. */
function loadRegistry() {
  const reg = Object.create(null);
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
    if (!fs.existsSync(manPath)) continue; /* not a folder-style widget, skip */

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
      hasDataFn: fs.existsSync(path.join(dir, 'data.js')),
      hasDemoFn: fs.existsSync(path.join(dir, 'demo.js')),
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
   the type picker, the config editor, and the widget iframe, and nothing the
   backend keeps to itself. */
function _publicEntry(_name, e) {
  const m = e.manifest;
  return {
    name:         m.name,
    label:        m.label,
    sizes:        m.sizes,
    card:         m.card || null,
    fields:       m.fields || [],
    views:        m.views || null,
    viewField:    m.viewField || null,
    defaultView:  m.defaultView || null,
    entryVersions: m.entryVersions || null,
  };
}

on('GET', '/api/widgets', (_, res) => {
  const reg  = getRegistry();
  const list = Object.entries(reg).map(([name, e]) => _publicEntry(name, e));
  json(res, 200, { widgets: list });
});

module.exports = { getRegistry, loadRegistry, validateManifest: _validateManifest, WIDGETS_PATH };
