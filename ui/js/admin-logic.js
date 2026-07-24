// @ts-check
/* Pure logic extracted from the admin UI so it can be unit-tested without a DOM:
   dashboard-item reordering, the dock-capacity check, and the widget config
   form's value collection. All operate on plain data and touch no DOM or module
   state. */

/* Seed the extra keys a picker owns from an already-saved config, so editing a
   widget without touching the picker does not drop them. */
export function seedCarried(config, carryKeys) {
  const out = {};
  for (const k of carryKeys || []) if (config && config[k] !== undefined) out[k] = config[k];
  return out;
}

/* Fold a chosen option's `set` block into the carried values. An option with no
   `set`, or one naming keys the field did not declare, leaves them unchanged. */
export function applyOptionSet(carried, option, carryKeys) {
  const out = Object.assign({}, carried);
  if (!option || !option.set) return out;
  for (const k of carryKeys || []) if (option.set[k] !== undefined) out[k] = option.set[k];
  return out;
}

/* Narrow a widget's size list to the sizes its current view declares. A view
   with no `sizes`, or one whose sizes are all unavailable, leaves the list
   alone. */
export function sizesForView(allSizes, reg, config) {
  if (!reg || !reg.views || !reg.viewField) return allSizes;
  const view = (config && config[reg.viewField]) || reg.defaultView;
  const sizes = reg.views[view] && reg.views[view].sizes;
  if (!Array.isArray(sizes) || !sizes.length) return allSizes;
  const narrowed = allSizes.filter(s => sizes.includes(s));
  return narrowed.length ? narrowed : allSizes;
}

/* Whether a field's `showIf` condition is met by the current value of the field
   it names. `in` matches any of several values, `equals` matches one; a boolean
   control is compared as a boolean so `false` is a real match rather than an
   empty value. */
export function showIfMatches(cond, current) {
  if (Array.isArray(cond.in)) return cond.in.map(String).includes(String(current));
  if (typeof current === 'boolean') return current === !!cond.equals;
  return String(current) === String(cond.equals);
}

/* Whether a required field was left empty. Types that always read back a value
   never count, and a blank secret means "keep the stored one" rather than empty. */
const _ALWAYS_FILLED = new Set(['toggle', 'color', 'group', 'object', 'secret']);
export function requiredFieldMissing(field, kv) {
  if (field.optional || field.transient) return false;
  if (_ALWAYS_FILLED.has(field.type)) return false;
  return !kv || kv[1] === '' || kv[1] == null;
}

/* Assemble the config object from what each field read back. `reads` is one
   entry per field: { field, visible, kv }, where kv is [key, value] plus an
   optional third element of extra keys the field carries. Hidden fields are
   skipped, and transient fields are skipped unless the caller wants the draft
   that feeds an options fetch. */
export function collectFieldValues(reads, { includeTransient = false } = {}) {
  const out = {};
  for (const r of reads) {
    const f = r.field;
    if (f.showIf && r.visible === false) continue;
    if (f.transient && !includeTransient) continue;
    const kv = r.kv;
    if (kv && kv[1] !== undefined) out[kv[0]] = kv[1];
    if (kv && kv[2]) Object.assign(out, kv[2]);
  }
  return out;
}

/* Where a listbox keypress moves the active option. Returns the new index, or
   null for keys that do not move it. Clamps rather than wraps, matching the
   WAI-ARIA listbox pattern. */
export function nextActiveIndex(key, active, len) {
  if (len <= 0) return null;
  const clamp = i => Math.max(0, Math.min(i, len - 1));
  switch (key) {
    case 'ArrowDown': return clamp(active + 1);
    case 'ArrowUp':   return clamp(active - 1);
    case 'Home':      return 0;
    case 'End':       return len - 1;
    default:          return null;
  }
}

/* The dock renders at most four apps (dashboard.js slices to DOCK_MAX), so the
   Show in Dock toggle is unavailable once four others are in. An app already in
   the dock is never blocked, since it holds one of the four slots itself. */
export const DOCK_MAX = 4;

export function isDockBlocked(items, editing) {
  if (editing?.dock) return false;
  const docked = (Array.isArray(items) ? items : [])
    .filter(i => i?.type === 'app' && i.dock && i.id !== editing?.id).length;
  return docked >= DOCK_MAX;
}

/* Row-count bounds for a group field at the selected widget size. countBySize
   pins both bounds together, so a per-size fixed count cannot be declared
   inconsistently; it wins over min/max/maxBySize when it names that size. */
export function groupBounds(field, size) {
  const fixed = (field.countBySize && size && field.countBySize[size] != null) ? field.countBySize[size] : null;
  if (fixed != null) return { min: fixed, max: fixed };
  const min = field.min != null ? field.min : 0;
  const max = (field.maxBySize && size && field.maxBySize[size] != null)
    ? field.maxBySize[size]
    : (field.max != null ? field.max : 99);
  return { min, max };
}

/* Move an item one step within the dashboard order, mutating `items` in place.
   Reorders a child within its folder when folderId/childIdx are given, otherwise
   swaps top-level rows (folders plus items not nested in any folder). Returns
   true when a swap happened, false when the move was out of bounds. */
export function reorderItems(items, item, dir, { folderId = null, childIdx = null } = {}) {
  if (folderId != null) {
    const f = items.find(i => i.id === folderId); if (!f) return false;
    const ch = f.children || []; const j = childIdx + dir;
    if (j < 0 || j >= ch.length) return false;
    [ch[childIdx], ch[j]] = [ch[j], ch[childIdx]];
    return true;
  }
  const inF = new Set(items.filter(i => i.type === 'folder').flatMap(ff => ff.children || []));
  const top = items.filter(it => it.type === 'folder' || !inF.has(it.id));
  const p = top.indexOf(item); const nb = top[p + dir];
  if (!nb) return false;
  const a = items.indexOf(item), b = items.indexOf(nb);
  [items[a], items[b]] = [items[b], items[a]];
  return true;
}
