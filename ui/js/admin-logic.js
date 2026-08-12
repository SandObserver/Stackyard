// @ts-check
/* Keep this module free of the DOM and of imports. Tests load it directly. */

export function seedCarried(config, carryKeys) {
  const out = Object.create(null);
  for (const k of carryKeys || []) if (config && config[k] !== undefined) out[k] = config[k];
  return out;
}

export function applyOptionSet(carried, option, carryKeys) {
  const out = Object.assign(Object.create(null), carried);
  if (!option || !option.set) return out;
  for (const k of carryKeys || []) if (option.set[k] !== undefined) out[k] = option.set[k];
  return out;
}

export function sizesForView(allSizes, reg, config) {
  if (!reg || !reg.views || !reg.viewField) return allSizes;
  const view = (config && config[reg.viewField]) || reg.defaultView;
  const sizes = reg.views[view] && reg.views[view].sizes;
  if (!Array.isArray(sizes) || !sizes.length) return allSizes;
  const narrowed = allSizes.filter(s => sizes.includes(s));
  return narrowed.length ? narrowed : allSizes;
}

export function showIfMatches(cond, current) {
  if (Array.isArray(cond.in)) return cond.in.map(String).includes(String(current));
  if (typeof current === 'boolean') return current === !!cond.equals;
  return String(current) === String(cond.equals);
}

/* Follow showIf chains. A hidden controller still holds a value underneath, and
   its dependants would show themselves against it. */
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

/* A blank secret means "keep the stored one", not empty. */
const _ALWAYS_FILLED = new Set(['toggle', 'color', 'group', 'object', 'secret']);
export function requiredFieldMissing(field, kv) {
  if (field.optional || field.transient) return false;
  if (_ALWAYS_FILLED.has(field.type)) return false;
  return !kv || kv[1] === '' || kv[1] == null;
}

/* `reads` is one entry per field: { field, visible, kv }. Transient fields are
   kept only for the draft that feeds an options fetch. */
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

/* dashboard.js slices the dock to DOCK_MAX, so the toggle must refuse beyond
   it. */
/* The server never refills a row that arrives non-secret, so unticking always
   loses the stored value. Say so before the save. */
export function clearsStoredSecret(row, checked) {
  return !checked && !!row && row.valueSet === true && row.value === '';
}

/* The server refuses this state: auth with no stored password locks the
   install. */
export function authEnableBlocked({ enabled, passwordSet, newPassword }) {
  return !!enabled && !passwordSet && !(newPassword || '').length;
}

/* Never store a password typed in the same save that switches protection off.
   Writing it rotates the session secret, signs every other device out, and the
   toggle deletes it again a moment later. */
export function shouldWritePassword({ enabled, newPassword }) {
  return !!enabled && !!(newPassword || '').length;
}

/* Signing in is itself two requests that answer with 401. Recovering from those
   puts a sign-in box on top of a sign-in box. */
const NO_REAUTH = new Set(['/api/auth/check', '/api/auth/login']);

/** @param {string} path @param {number} status @returns {boolean} */
export function recoversSession(path, status) {
  return status === 401 && !NO_REAUTH.has(String(path || '').split('?')[0]);
}

export const BLOCK = Object.freeze({ NEEDS_PASSWORD: 'needsPassword', WEAK_PASSWORD: 'weakPassword' });

/** What refuses this settings save, or null when nothing does. Ask every rule
    here, before the first write, so a refusal leaves the server as it was.
    `strength` is passed in, not computed: this module must not import.

    @param {{ enabled: boolean, passwordSet: boolean, newPassword: string,
              strength?: { ok: boolean, labelKey?: string } }} v
    @returns {{ reason: string, labelKey?: string } | null} */
export function settingsSaveBlocker({ enabled, passwordSet, newPassword, strength }) {
  if (authEnableBlocked({ enabled, passwordSet, newPassword })) return { reason: BLOCK.NEEDS_PASSWORD };
  if (shouldWritePassword({ enabled, newPassword }) && strength && !strength.ok)
    return { reason: BLOCK.WEAK_PASSWORD, labelKey: strength.labelKey };
  return null;
}

/* Switching protection off deletes the stored password, so the save asks
   first. */
export function clearsStoredPassword({ enabled, passwordSet }) {
  return !enabled && !!passwordSet;
}

/* 'unavailable' must not fall through to the custom editor. The server
   withholds that widget's config, so empty fields read as lost settings. */
export function widgetConfigMode(type, reg) {
  if (reg && reg[type]) return 'registry';
  return type === 'custom' ? 'custom' : 'unavailable';
}

/** Which admin section to show. Exactly one must always show, and the requested
    id comes from localStorage, so it can name a section an older version had.

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

/* Mutates `items` in place. */
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

/* The shape arrives as JSON, so an entry that is not a named widget with at
   least one string reason is dropped. */
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

export function refusedNoticeKey(count) {
  return count === 1 ? 'widgetCfg.refused' : 'widgetCfg.refusedPlural';
}
