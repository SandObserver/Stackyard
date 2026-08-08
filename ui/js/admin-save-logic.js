// @ts-check
/* Assembly and validation for the admin save path, kept free of the DOM so it
   can be tested directly. The DOM reads stay in doSave. */

/* Turn a label into a safe id stem: letters/digits/underscores only, collapsed,
   trimmed, with a type-specific fallback when nothing usable remains. */
export function cleanId(label, fallback = 'item') {
  return (
    String(label || '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || fallback
  );
}

/* Not a security boundary: an id is not a token, and the collision loop in
   newItemId is what guarantees uniqueness. */
export function randomSuffix() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(2);
    c.getRandomValues(buf);
    return buf[0].toString(36) + buf[1].toString(36);
  }
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
}

/** A new item id. Nothing downstream copes with a duplicate: every lookup takes
   the first match, so the second item is unreachable by its own id. Given
   `taken`, this cannot return one that already exists.

   @param {string} label @param {string} fallback @param {Iterable<string>} [taken]
   @returns {string} */
export function newItemId(label, fallback = 'item', taken = []) {
  const stem = cleanId(label, fallback);
  const used = taken instanceof Set ? taken : new Set(taken);
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = `${stem}_${Date.now().toString(36)}${randomSuffix()}`;
    if (!used.has(id)) return id;
  }
  /* Unreachable in practice; a counter is still better than returning a
     duplicate, which is the thing this exists to prevent. */
  let n = 2;
  while (used.has(`${stem}_${n}`)) n++;
  return `${stem}_${n}`;
}

/* Returns { error } or { item }. */
/** Put `item` where the item with `id` currently is, or append it.

    Matched by id, never by position: a position goes stale as soon as items
    move, and writing past the end grows the array with holes that JSON turns
    into nulls. A missing id appends rather than throwing, so a real edit is not
    lost to a bookkeeping mismatch.

    @param {any[]} items @param {string|null} id @param {any} item
    @returns {{ items: any[], replaced: boolean }} */
export function upsertItem(items, id, item) {
  const list = Array.isArray(items) ? items : [];
  const at = id == null ? -1 : list.findIndex(i => i && i.id === id);
  if (at !== -1) list[at] = item;
  else list.push(item);
  return { items: list, replaced: at !== -1 };
}

/** Remove `childIds` from every folder except `folderId`. An app belongs to one
    folder, or the dashboard renders it twice. Mutates and returns `items`.

    @param {any[]} items @param {string|null|undefined} folderId
    @param {Iterable<string>} childIds @returns {any[]} */
export function claimFolderChildren(items, folderId, childIds) {
  const list = Array.isArray(items) ? items : [];
  const claimed = new Set(childIds || []);
  if (!claimed.size) return list;
  for (const it of list) {
    if (!it || it.type !== 'folder' || it.id === folderId) continue;
    if (!Array.isArray(it.children)) continue;
    it.children = it.children.filter(id => !claimed.has(id));
  }
  return list;
}

/** @param {any} v @param {any} [orig] @param {Iterable<string>} [takenIds] */
export function buildAppItem(v, orig, takenIds = []) {
  if (!v.label) return { error: 'Name required' };
  if (!v.href) return { error: 'URL required' };
  const DEFCOL = '#0289ff';
  const customObj =
    (v.actColor && v.actColor !== DEFCOL) || v.custUnit
      ? {
          color: v.actColor && v.actColor !== DEFCOL ? v.actColor : undefined,
          unit: v.custUnit || undefined,
        }
      : undefined;
  const staticBadgeObj =
    v.staticEn && v.staticLabel
      ? { enabled: true, label: v.staticLabel.slice(0, 10), color: v.staticColor || 'blue' }
      : undefined;
  const spaths = v.spaths || [];
  return {
    item: {
      id: orig?.id || newItemId(v.label, 'app', takenIds),
      type: 'app',
      label: v.label,
      href: v.href,
      iconUrl: v.iconUrl,
      color: v.scol || 'dark',
      dock: v.dock || false,
      skipTlsVerify: v.skipTlsVerify || undefined,
      monitoring: {
        healthcheck: { enabled: v.hcEn && (!!v.hcCon || !!v.hcPing), container: v.hcCon, pingUrl: v.hcPing },
        activity: {
          enabled: v.actEn && !!v.actUrl,
          url: v.actUrl,
          params: v.actParams?.length ? v.actParams : undefined,
          headers: v.actHeaders?.length ? v.actHeaders : undefined,
          extract: spaths.length === 1 ? spaths[0] : spaths.length > 1 ? spaths.map(p => ({ path: p })) : undefined,
          interval: Math.max(10, v.actInt),
          custom: customObj,
        },
        staticBadge: staticBadgeObj,
      },
    },
  };
}
