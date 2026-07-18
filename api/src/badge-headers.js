/* Badge and activity "Add to Header" / "Add to URL" entries.
   Stored as an array of { key, value, secret } rows so each entry can be marked
   a credential independently. Rows marked secret follow the same scrub-on-read /
   preserve-on-save contract as widget secret fields: the value never leaves the
   server, and a save that omits it keeps the stored one.

   The two sub-objects this touches live at:
     item.badge.{headers,params}
     item.monitoring.activity.{headers,params} */

const SUBKEYS = ['headers', 'params'];

function isRowArray(v) {
  return Array.isArray(v) && v.every(r => r && typeof r === 'object' && typeof r.key === 'string');
}

/* Old shape ({ key: value }) -> rows. Unknown/empty -> []. */
function toRows(v) {
  if (isRowArray(v)) return v;
  if (v && typeof v === 'object') {
    return Object.entries(v).map(([key, value]) => ({ key, value: String(value), secret: false }));
  }
  return [];
}

/* Rows -> plain { key: value } for the outbound request. Skips rows with a
   blank key or a null value (a scrubbed secret with no stored value).
   @param {any} rows
   @returns {Record<string,string>} */
function rowsToObject(rows) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const r of toRows(rows)) {
    if (!r.key || r.value == null) continue;
    out[r.key] = r.value;
  }
  return out;
}

/* The activity block wins over the badge block when both exist, matching
   badges.js. Returns { headers, params } as plain objects for a fetch. */
function requestParts(item) {
  const src = item?.monitoring?.activity?.enabled ? item.monitoring.activity : item?.badge;
  return {
    headers: rowsToObject(src?.headers),
    params: rowsToObject(src?.params),
  };
}

function scrubRows(rows) {
  return toRows(rows).map(r => {
    if (!r.secret) return { key: r.key, value: r.value, secret: false };
    return { key: r.key, secret: true, valueSet: r.value != null && r.value !== '' };
  });
}

/* Restore values the browser dropped. A secret row is sent without its value; a
   row toggled from secret to non-secret is also sent without one. In both cases
   restore from the stored row with the same key, so a working credential is
   never silently blanked. A row whose key has no stored match (new row, or a
   renamed one) stays blank and must be retyped, which is the safe default: it
   never leaks an unrelated stored value into a different key. Mutates and
   returns newRows. */
function preserveRows(newRows, oldRows) {
  const nrows = toRows(newRows);
  const orows = toRows(oldRows);
  for (const r of nrows) {
    const needsValue = r.value == null || r.value === '';
    if (needsValue) {
      const donor = orows.find(o => o.key === r.key && o.value != null && o.value !== '');
      if (donor) r.value = donor.value;
    }
    delete r.valueSet;
  }
  return nrows;
}

function eachActivityLike(item, fn) {
  if (!item || typeof item !== 'object') return;
  if (item.badge) fn(item.badge);
  if (item.monitoring && item.monitoring.activity) fn(item.monitoring.activity);
}

function scrubItemBadgeSecrets(item) {
  eachActivityLike(item, block => {
    for (const k of SUBKEYS) if (block[k] != null) block[k] = scrubRows(block[k]);
  });
}

function preserveItemBadgeSecrets(newItem, oldItem) {
  const oldBlocks = { badge: oldItem?.badge, activity: oldItem?.monitoring?.activity };
  const apply = (block, old) => {
    for (const k of SUBKEYS) if (block[k] != null) block[k] = preserveRows(block[k], old?.[k]);
  };
  if (newItem?.badge) apply(newItem.badge, oldBlocks.badge);
  if (newItem?.monitoring?.activity) apply(newItem.monitoring.activity, oldBlocks.activity);
}

/* Migrate an item's badge/activity header+param objects to the row shape.
   Existing entries default to secret:false: their sensitivity is unknown, and
   defaulting to non-secret keeps current behaviour exactly. Returns true if it
   changed anything. */
function migrateItemBadgeHeaders(item) {
  let changed = false;
  eachActivityLike(item, block => {
    for (const k of SUBKEYS) {
      if (block[k] != null && !isRowArray(block[k])) { block[k] = toRows(block[k]); changed = true; }
    }
  });
  return changed;
}

module.exports = {
  toRows, rowsToObject, requestParts,
  scrubRows, preserveRows,
  scrubItemBadgeSecrets, preserveItemBadgeSecrets,
  migrateItemBadgeHeaders,
};
