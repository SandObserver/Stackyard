/* Badge and activity header and query rows: { key, value, secret }. A secret row
   follows the same contract as a widget secret field, so its value never leaves
   the server and a save that omits it keeps the stored one. */

const SUBKEYS = ['headers', 'params'];

/** A single well-formed row. @param {unknown} r @returns {boolean} */
function isRow(r) {
  return (
    !!r && typeof r === 'object' && !Array.isArray(r) && typeof (/** @type {{key?:unknown}} */ (r).key) === 'string'
  );
}

/** Already in the row shape, so the migration has nothing to do.
    @param {unknown} v @returns {boolean} */
function isRowArray(v) {
  return Array.isArray(v) && v.every(isRow);
}

/* Old shape ({ key: value }) to rows. An array is always rows, however damaged:
   sending one down the legacy-object branch turns its indices into header names
   and drops the real credential. Bad elements are skipped rather than refused,
   since this runs on stored config; validateRows rejects them on the way in. */
function toRows(v) {
  if (Array.isArray(v)) {
    /* Returned as-is when nothing needs dropping, so the common path neither
       allocates nor breaks callers that rely on getting the same array back. */
    return v.every(isRow) ? v : v.filter(isRow);
  }
  if (v && typeof v === 'object') {
    return Object.entries(v).map(([key, value]) => ({ key, value: String(value), secret: false }));
  }
  return [];
}

/** How many entries toRows would discard. Lets a caller report the damage
    rather than silently working with less than it was given.
    @param {unknown} v @returns {number} */
function droppedRowCount(v) {
  return Array.isArray(v) ? v.length - v.filter(isRow).length : 0;
}

/** The first badge or activity row on an item that is not well-formed, or null.
    Used to reject a save naming the field, so damaged rows cannot be stored.
    @param {unknown} item @returns {{ field:string, index:number }|null} */
function firstMalformedRow(item) {
  if (!item || typeof item !== 'object') return null;
  const it = /** @type {{ badge?: any, monitoring?: { activity?: any } }} */ (item);
  for (const [block, label] of [
    [it.badge, 'badge'],
    [it.monitoring?.activity, 'monitoring.activity'],
  ]) {
    if (!block || typeof block !== 'object') continue;
    for (const sub of SUBKEYS) {
      const v = block[sub];
      if (!Array.isArray(v)) continue; /* the legacy object shape is still accepted */
      const at = v.findIndex(r => !isRow(r));
      if (at !== -1) return { field: `${label}.${sub}`, index: at };
    }
  }
  return null;
}

/* Skips a blank key or a null value, which is a scrubbed secret with nothing
   stored.
   @param {any} rows
   @returns {Record<string,string>} */
function rowsToObject(rows) {
  /** @type {Record<string,string>} */
  const out = Object.create(null);
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

/* Refills a secret row the browser sent without its value, matching by key.

   A row arriving as non-secret is never refilled, even when a value is stored
   for that key: it would move the credential into a row that scrubRows sends to
   the browser in full. Unticking Secret therefore clears the stored value. See
   docs/security.md. */
function preserveRows(newRows, oldRows) {
  const nrows = toRows(newRows);
  const orows = toRows(oldRows);
  for (const r of nrows) {
    const needsValue = r.value == null || r.value === '';
    if (needsValue) {
      /* Only a row still marked secret may be refilled. */
      const donor = r.secret ? orows.find(o => o.key === r.key && o.value != null && o.value !== '') : null;
      if (donor) r.value = donor.value;
      else if (!r.secret) r.value = '';
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

/* Existing entries default to secret:false, which keeps current behaviour: their
   sensitivity is unknown. */
function migrateItemBadgeHeaders(item) {
  let changed = false;
  eachActivityLike(item, block => {
    for (const k of SUBKEYS) {
      if (block[k] != null && !isRowArray(block[k])) {
        block[k] = toRows(block[k]);
        changed = true;
      }
    }
  });
  return changed;
}

module.exports = {
  toRows,
  droppedRowCount,
  firstMalformedRow,
  rowsToObject,
  requestParts,
  scrubRows,
  scrubItemBadgeSecrets,
  preserveItemBadgeSecrets,
  migrateItemBadgeHeaders,
};
