// @ts-check
/* Pure logic from the admin UI, kept free of the DOM so it can be tested
   directly. Keep it that way. */

/* So editing a widget without touching the picker does not drop them. */
export function seedCarried(config, carryKeys) {
  const out = Object.create(null);
  for (const k of carryKeys || []) if (config && config[k] !== undefined) out[k] = config[k];
  return out;
}

/* An option with no `set`, or one naming undeclared keys, changes nothing. */
export function applyOptionSet(carried, option, carryKeys) {
  const out = Object.assign(Object.create(null), carried);
  if (!option || !option.set) return out;
  for (const k of carryKeys || []) if (option.set[k] !== undefined) out[k] = option.set[k];
  return out;
}

/* A view with no `sizes`, or none that are available, leaves the list alone. */
export function sizesForView(allSizes, reg, config) {
  if (!reg || !reg.views || !reg.viewField) return allSizes;
  const view = (config && config[reg.viewField]) || reg.defaultView;
  const sizes = reg.views[view] && reg.views[view].sizes;
  if (!Array.isArray(sizes) || !sizes.length) return allSizes;
  const narrowed = allSizes.filter(s => sizes.includes(s));
  return narrowed.length ? narrowed : allSizes;
}

/* A boolean control is compared as a boolean, so `false` is a real match rather
   than an empty value. */
export function showIfMatches(cond, current) {
  if (Array.isArray(cond.in)) return cond.in.map(String).includes(String(current));
  if (typeof current === 'boolean') return current === !!cond.equals;
  return String(current) === String(cond.equals);
}

/* Follows showIf chains, so a field is hidden when its controller is hidden and
   not only when the condition fails: a hidden controller still holds a value
   underneath, and its dependants would show themselves against it. */
export function visibleFieldKeys(fields, readValue) {
  const byKey = new Map(fields.map(f => [f.key, f]));
  const memo = new Map();
  const isShown = key => {
    if (memo.has(key)) return memo.get(key);
    memo.set(key, false); /* guard against a cycle in malformed manifests */
    const f = byKey.get(key);
    let ok = true;
    if (f && f.showIf) {
      const dep = f.showIf.field;
      ok = byKey.has(dep)
        ? isShown(dep) && showIfMatches(f.showIf, readValue(dep))
        : showIfMatches(f.showIf, readValue(dep));
    }
    memo.set(key, ok);
    return ok;
  };
  const out = new Set();
  for (const f of fields) if (f.key != null && isShown(f.key)) out.add(f.key);
  return out;
}

/* A blank secret means "keep the stored one" rather than empty. */
const _ALWAYS_FILLED = new Set(['toggle', 'color', 'group', 'object', 'secret']);
export function requiredFieldMissing(field, kv) {
  if (field.optional || field.transient) return false;
  if (_ALWAYS_FILLED.has(field.type)) return false;
  return !kv || kv[1] === '' || kv[1] == null;
}

/* `reads` is one entry per field: { field, visible, kv }, kv being [key, value]
   plus optional extra keys the field carries. Transient fields are kept only for
   the draft that feeds an options fetch. */
export function collectFieldValues(reads, { includeTransient = false } = {}) {
  const out = Object.create(null);
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

/* Clamps rather than wraps, matching the WAI-ARIA listbox pattern. */
export function nextActiveIndex(key, active, len) {
  if (len <= 0) return null;
  const clamp = i => Math.max(0, Math.min(i, len - 1));
  switch (key) {
    case 'ArrowDown':
      return clamp(active + 1);
    case 'ArrowUp':
      return clamp(active - 1);
    case 'Home':
      return 0;
    case 'End':
      return len - 1;
    default:
      return null;
  }
}

/* dashboard.js slices the dock to DOCK_MAX, so the toggle has to refuse beyond
   it. An app already in the dock holds one of those slots itself. */
/* The server will not refill a row that arrives as non-secret, since that would
   move a stored credential into a row it sends to the browser in full. Unticking
   therefore always loses the value, and the form has to show that before the
   save rather than after. */
export function clearsStoredSecret(row, checked) {
  return !checked && !!row && row.valueSet === true && row.value === '';
}

/* The server refuses this state, because auth with no stored password locks the
   install. Checked here so the user is told before the save runs. */
export function authEnableBlocked({ enabled, passwordSet, newPassword }) {
  return !!enabled && !passwordSet && !(newPassword || '').length;
}

/* A password typed in the same save that switches protection off is not stored.
   Writing it would rotate the session secret and sign every other device out,
   and the toggle in the same save would delete it again a moment later, so the
   round trip costs the user their other sessions and leaves nothing behind. */
export function shouldWritePassword({ enabled, newPassword }) {
  return !!enabled && !!(newPassword || '').length;
}

/* Why a settings save cannot go ahead. Codes rather than catalog keys: the
   message text is chosen at the call site, where the key can be written as a
   literal and traced back from the catalog. */
export const BLOCK = Object.freeze({ NEEDS_PASSWORD: 'needsPassword', WEAK_PASSWORD: 'weakPassword' });

/** What refuses this settings save, or null when nothing does.

    Every rule that can refuse is asked here, before the first write, so a
    refusal leaves the server exactly as it was. Both were previously checked
    after the config had already been sent, which saved half the screen and then
    reported only the password problem.

    `strength` is the caller's pwStrength result. Passed in rather than computed
    here, because this module is imported by tests that do not map the served
    `/js/` paths, and one import would break every one of them.

    @param {{ enabled: boolean, passwordSet: boolean, newPassword: string,
              strength?: { ok: boolean, labelKey?: string } }} v
    @returns {{ reason: string, labelKey?: string } | null} */
export function settingsSaveBlocker({ enabled, passwordSet, newPassword, strength }) {
  if (authEnableBlocked({ enabled, passwordSet, newPassword })) return { reason: BLOCK.NEEDS_PASSWORD };
  if (shouldWritePassword({ enabled, newPassword }) && strength && !strength.ok)
    return { reason: BLOCK.WEAK_PASSWORD, labelKey: strength.labelKey };
  return null;
}

/* Switching protection off deletes the stored password, so the save has to ask
   first. Nothing to ask when there is no password to lose. */
export function clearsStoredPassword({ enabled, passwordSet }) {
  return !enabled && !!passwordSet;
}

/* 'registry' renders the manifest's fields, 'custom' the URL editor, and
   'unavailable' a registry widget whose manifest is not loaded. The last must not
   fall through to the custom editor: the server withholds that widget's config,
   so empty fields would read as settings that had been lost. */
export function widgetConfigMode(type, reg) {
  if (reg && reg[type]) return 'registry';
  return type === 'custom' ? 'custom' : 'unavailable';
}

/** Which admin section to show, given a requested id and the sections present.

    Exactly one section must always show, and the requested id comes from
    localStorage so it can name a section an older version had. Falls back to the
    first available section rather than a hard-coded name.

    @param {string|null|undefined} requested
    @param {string[]} available in document order
    @returns {string|null} null only when there are no sections at all */
export function resolveAdminSection(requested, available) {
  const list = Array.isArray(available) ? available.filter(s => typeof s === 'string' && s) : [];
  if (!list.length) return null;
  return list.includes(String(requested ?? '')) ? String(requested) : list[0];
}

export const DOCK_MAX = 4;

export function isDockBlocked(items, editing) {
  if (editing?.dock) return false;
  const docked = (Array.isArray(items) ? items : []).filter(
    i => i?.type === 'app' && i.dock && i.id !== editing?.id,
  ).length;
  return docked >= DOCK_MAX;
}

/* countBySize pins both bounds together and wins over min/max/maxBySize for the
   size it names. */
export function groupBounds(field, size) {
  const fixed = field.countBySize && size && field.countBySize[size] != null ? field.countBySize[size] : null;
  if (fixed != null) return { min: fixed, max: fixed };
  const min = field.min != null ? field.min : 0;
  const max =
    field.maxBySize && size && field.maxBySize[size] != null
      ? field.maxBySize[size]
      : field.max != null
        ? field.max
        : 99;
  return { min, max };
}

/* Mutates `items` in place. Moves a child within its folder when folderId and
   childIdx are given, otherwise swaps top-level rows. */
export function reorderItems(items, item, dir, { folderId = null, childIdx = null } = {}) {
  if (folderId != null) {
    const f = items.find(i => i.id === folderId);
    if (!f) return false;
    const ch = f.children || [];
    const j = childIdx + dir;
    if (j < 0 || j >= ch.length) return false;
    [ch[childIdx], ch[j]] = [ch[j], ch[childIdx]];
    return true;
  }
  const inF = new Set(items.filter(i => i.type === 'folder').flatMap(ff => ff.children || []));
  const top = items.filter(it => it.type === 'folder' || !inF.has(it.id));
  const p = top.indexOf(item);
  const nb = top[p + dir];
  if (!nb) return false;
  const a = items.indexOf(item),
    b = items.indexOf(nb);
  [items[a], items[b]] = [items[b], items[a]];
  return true;
}

/* The reasons a widget was refused, one line per reason, so the two places that
   show refusals cannot word them differently. The shape arrives as JSON, so an
   entry that is not a named widget with at least one string reason is dropped
   rather than rendered as "undefined". `withName` separates the two callers:
   the editor shows one widget, the picker lists several. */
export function rejectionLines(rejections, { withName = true } = {}) {
  if (!Array.isArray(rejections)) return [];
  const out = [];
  for (const r of rejections) {
    if (!r || typeof r.name !== 'string' || !r.name || !Array.isArray(r.errors)) continue;
    for (const e of r.errors) {
      if (typeof e !== 'string' || !e.trim()) continue;
      out.push(withName ? `${r.name}: ${e}` : e);
    }
  }
  return out;
}

/* Which message the picker shows above those lines. Two keys rather than one
   with a count, because a language pluralises the sentence, not the number. */
export function refusedNoticeKey(count) {
  return count === 1 ? 'widgetCfg.refused' : 'widgetCfg.refusedPlural';
}
