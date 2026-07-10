// @ts-check
/* Pure logic extracted from the admin UI so it can be unit-tested without a DOM:
   backup-slot normalization (with default-instance inference) and dashboard-item
   reordering. Both operate on plain data and touch no DOM or module state. */

/* Normalize a widget's saved backup slots to the fixed count for its size,
   filling defaults and inferring per-slot useDefault: a slot uses the default
   instance when it is the first slot for its provider, or shares (or blanks) the
   default's URL; a different URL marks it independent. */
export function normBackupSlots(saved, size) {
  const count = size === 'small' ? 1 : 3;
  const arr = Array.isArray(saved) ? saved : [];
  const firstIdx = {};
  arr.forEach((s, k) => { if (s?.provider && firstIdx[s.provider] === undefined) firstIdx[s.provider] = k; });
  const inferUseDefault = (i) => {
    const s = arr[i]; if (!s?.provider) return true;
    if (s.useDefault !== undefined) return s.useDefault !== false;
    const fi = firstIdx[s.provider];
    if (i === fi) return true;
    const key = s.provider === 'duplicati' ? 'dupUrl' : 'kopiaUrl';
    const myUrl = (s[key] || '').trim(), fUrl = (arr[fi]?.[key] || '').trim();
    return !myUrl || myUrl === fUrl;
  };
  return Array.from({ length: count }, (_, i) => ({
    provider:     arr[i]?.provider    || null,
    jobId:        arr[i]?.jobId       || null,
    customName:   arr[i]?.customName  || '',
    useDefault:   inferUseDefault(i),
    dupUrl:       arr[i]?.dupUrl      || '',
    dupPassSet:   arr[i]?.dupPassSet  || false,
    dupHref:      arr[i]?.dupHref     || '',
    dupPollSec:   arr[i]?.dupPollSec  || 60,
    dupJobList:   [],
    kopiaUrl:     arr[i]?.kopiaUrl    || '',
    kopiaUser:    arr[i]?.kopiaUser   || '',
    kopiaPassSet: arr[i]?.kopiaPassSet || false,
    kopiaHref:    arr[i]?.kopiaHref   || '',
    kopiaSrcList: [],
  }));
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
