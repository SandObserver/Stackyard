// @ts-check
/* Keep this module free of the DOM. The DOM reads stay in doSave. */

const BADGE_DEFAULT = '#1e6ef4';

/* Keep in step with MAX_LABELS in badge-logic.js. */
const MAX_LABELS = 5;

export function cleanId(label, fallback = 'item') {
  return (
    String(label || '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || fallback
  );
}

export function randomSuffix() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(2);
    c.getRandomValues(buf);
    return buf[0].toString(36) + buf[1].toString(36);
  }
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
}

/** A new item id. Every lookup takes the first match, so a duplicate makes the
   second item unreachable by its own id.

   @param {string} label @param {string} fallback @param {Iterable<string>} [taken]
   @returns {string} */
export function newItemId(label, fallback = 'item', taken = []) {
  const stem = cleanId(label, fallback);
  const used = taken instanceof Set ? taken : new Set(taken);
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = `${stem}_${Date.now().toString(36)}${randomSuffix()}`;
    if (!used.has(id)) return id;
  }
  let n = 2;
  while (used.has(`${stem}_${n}`)) n++;
  return `${stem}_${n}`;
}

/** @param {any[]} items @returns {any[]} */
export function snapshotItems(items) {
  return Array.isArray(items) ? JSON.parse(JSON.stringify(items)) : [];
}

/** Run `write` and undo the local change when it did not reach the server.
    Without this the list shows a dashboard the server does not have. `write`
    reports failure by resolving false; a throw is re-raised after the restore.

    @template T
    @param {{ write: () => Promise<boolean|void>, snapshot: T,
              restore: (snapshot: T) => void }} opts
    @returns {Promise<boolean>} */
export async function saveWithRevert({ write, snapshot, restore }) {
  let ok = false;
  try {
    ok = (await write()) !== false;
  } finally {
    if (!ok) restore(snapshot);
  }
  return ok;
}

/** Put `item` where the item with `id` currently is, or append it. Match by id,
    never by position: a position goes stale as soon as items move, and writing
    past the end grows the array with holes that JSON turns into nulls.

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
    folder, or the dashboard renders it twice.

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

/** One stored Live Activity label. Array order is priority order.

    @param {string} path @param {any} [style]
    @returns {{ path: string, name?: string, unit?: string, color?: string, min?: number }} */
export function buildActivityLabel(path, style) {
  const min = Math.floor(Number(style?.min));
  return {
    path,
    name: style?.name?.trim() || undefined,
    unit: style?.unit?.trim() || undefined,
    color: style?.color && style.color !== BADGE_DEFAULT ? style.color : undefined,
    min: Number.isFinite(min) && min > 1 ? min : undefined,
  };
}

/** @param {any} v @param {any} [orig] @param {Iterable<string>} [takenIds] */
export function buildAppItem(v, orig, takenIds = []) {
  if (!v.label) return { error: 'Name required' };
  if (!v.href) return { error: 'URL required' };
  const DEFCOL = '#0289ff';
  /* One badges any count above zero, which is the default, so it is not stored. */
  const custMin = Number.isFinite(v.custMin) && v.custMin > 1 ? Math.floor(v.custMin) : undefined;
  const customObj =
    (v.actColor && v.actColor !== DEFCOL) || v.custUnit || custMin
      ? {
          color: v.actColor && v.actColor !== DEFCOL ? v.actColor : undefined,
          unit: v.custUnit || undefined,
          min: custMin,
        }
      : undefined;
  const staticBadgeObj =
    v.staticEn && v.staticLabel
      ? { enabled: true, label: v.staticLabel.slice(0, 10), color: v.staticColor || 'blue' }
      : undefined;
  const spaths = v.spaths || [];
  const combine = spaths.length >= 2 && !!v.actCombine;
  const labels = spaths.length
    ? spaths.slice(0, MAX_LABELS).map(p => buildActivityLabel(p, v.slabels?.[p]))
    : undefined;
  const first = combine ? buildActivityLabel('', v.slabels?.[spaths[0]]) : null;
  const combinedCustom =
    first && (first.color || first.unit || first.min)
      ? { color: first.color, unit: first.unit, min: first.min }
      : undefined;
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
          labels: combine ? undefined : labels,
          combine: combine || undefined,
          interval: Math.max(10, v.actInt),
          custom: combinedCustom || customObj,
        },
        staticBadge: staticBadgeObj,
      },
    },
  };
}
