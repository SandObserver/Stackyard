// @ts-check
/* Pure assembly/validation logic lifted out of admin doSave so it can be
   unit-tested without a DOM. Each function takes plain data (widget state that
   the form has already collected) and returns plain data; the DOM reads stay in
   doSave. No DOM, no module state. */

/* Turn a label into a safe id stem: letters/digits/underscores only, collapsed,
   trimmed, with a type-specific fallback when nothing usable remains. */
export function cleanId(label, fallback = 'item') {
  return String(label || '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || fallback;
}

/** A new item id.

   It used to be `cleanId(label) + '_' + Date.now()`, so two items created in the
   same millisecond took the same id. That matters more than the odds suggest,
   because nothing downstream copes: every lookup is find(i => i.id === x), which
   returns the first match, leaving the second item unreachable by its own id.

   The random suffix removes the timing dependency, and `taken` removes the luck:
   given the ids already in the config, this cannot return one of them.
   crypto.randomUUID is not used because the id appears in exported config and in
   the admin URL, where something readable is worth keeping.

   @param {string} label @param {string} fallback @param {Iterable<string>} [taken]
   @returns {string} */
export function newItemId(label, fallback = 'item', taken = []) {
  const stem = cleanId(label, fallback);
  const used = taken instanceof Set ? taken : new Set(taken);
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = `${stem}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!used.has(id)) return id;
  }
  /* Unreachable in practice; a counter is still better than returning a
     duplicate, which is the thing this exists to prevent. */
  let n = 2;
  while (used.has(`${stem}_${n}`)) n++;
  return `${stem}_${n}`;
}

/* Assemble an app item from already-read form values (v). Validates name/url,
   builds the monitoring block (healthcheck + activity badge), the custom badge
   display, and the static badge. Returns { error } or { item }. */
/** Put `item` where the item with `id` currently is, or append it.

    The edit target used to be an array index. That went stale the moment items
    moved: writing past the end grew the array with holes, JSON turned those into
    nulls, and the server rejected the whole save with a message about missing
    ids, losing the user's edit.

    A missing id appends rather than throws. The edit is real work, and losing it
    to a bookkeeping mismatch is worse than leaving an entry the user can see and
    remove.

    Mutates and returns `items`, and reports whether it replaced or appended so
    the caller can say "Updated" or "Added" truthfully.

    @param {any[]} items @param {string|null} id @param {any} item
    @returns {{ items: any[], replaced: boolean }} */
export function upsertItem(items, id, item) {
  const list = Array.isArray(items) ? items : [];
  const at = id == null ? -1 : list.findIndex(i => i && i.id === id);
  if (at !== -1) list[at] = item;
  else list.push(item);
  return { items: list, replaced: at !== -1 };
}

/** Remove `childIds` from every folder except `folderId`.

    An app belongs to one folder. This ran only when creating a folder, so
    editing an existing one and ticking an app already filed elsewhere left it in
    both, and the dashboard rendered it twice.

    Mutates and returns `items`.

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
  if (!v.href)  return { error: 'URL required' };
  const DEFCOL = '#0289ff';
  const customObj = (v.actColor && v.actColor !== DEFCOL) || v.custUnit ? {
    color: v.actColor && v.actColor !== DEFCOL ? v.actColor : undefined,
    unit:  v.custUnit || undefined,
  } : undefined;
  const staticBadgeObj = v.staticEn && v.staticLabel
    ? { enabled: true, label: v.staticLabel.slice(0, 10), color: v.staticColor || 'blue' }
    : undefined;
  const spaths = v.spaths || [];
  return { item: {
    id: orig?.id || newItemId(v.label, 'app', takenIds),
    type: 'app', label: v.label, href: v.href,
    iconUrl: v.iconUrl, color: v.scol || 'dark',
    dock: v.dock || false,
    skipTlsVerify: v.skipTlsVerify || undefined,
    monitoring: {
      healthcheck: { enabled: v.hcEn && (!!v.hcCon || !!v.hcPing), container: v.hcCon, pingUrl: v.hcPing },
      activity: {
        enabled: v.actEn && !!v.actUrl, url: v.actUrl,
        params:  v.actParams?.length ? v.actParams : undefined,
        headers: v.actHeaders?.length ? v.actHeaders : undefined,
        extract: spaths.length === 1 ? spaths[0] : spaths.length > 1 ? spaths.map(p => ({ path: p })) : undefined,
        interval: Math.max(10, v.actInt),
        custom: customObj,
      },
      staticBadge: staticBadgeObj,
    },
  } };
}
