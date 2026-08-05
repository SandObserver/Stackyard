/* Badge and activity "Add to Header" / "Add to URL" entries.
   Stored as an array of { key, value, secret } rows so each entry can be marked
   a credential independently. Rows marked secret follow the same scrub-on-read /
   preserve-on-save contract as widget secret fields: the value never leaves the
   server, and a save that omits it keeps the stored one.

   The two sub-objects this touches live at:
     item.badge.{headers,params}
     item.monitoring.activity.{headers,params} */

const SUBKEYS = ['headers', 'params'];

/** A single well-formed row. @param {any} r */
function isRow(r) {
  return !!r && typeof r === 'object' && !Array.isArray(r) && typeof r.key === 'string';
}

/** Already in the row shape, so the migration has nothing to do.
    @param {any} v */
function isRowArray(v) {
  return Array.isArray(v) && v.every(isRow);
}

/* Old shape ({ key: value }) -> rows. Unknown/empty -> [].

   An array is rows. It used to have to look like rows, with every element valid,
   and a single bad one sent the whole array to the legacy-object branch below:
   the indices became header names and each row stringified, so the request went
   out with a header called "0" whose value was "[object Object]" and without the
   real credential. The badge then reported whatever the service says to an
   unauthenticated caller, which reads as "authentication required" and points
   the user at a credential that was stored correctly all along.

   Asking whether an array looks enough like rows is what produced that. An array
   and a plain object are different shapes; the legacy branch was only ever meant
   for objects. Elements that are not rows are skipped, because this runs on
   stored config and refusing would break a badge over one damaged entry.
   validateRows rejects them on the way in instead, so this stays a fallback for
   config that was hand-edited or imported. */
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
    @param {any} v @returns {number} */
function droppedRowCount(v) {
  return Array.isArray(v) ? v.length - v.filter(isRow).length : 0;
}

/** The first badge or activity row on an item that is not well-formed, or null.
    Used to reject a save naming the field, so damaged rows cannot be stored.
    @param {any} item @returns {{ field:string, index:number }|null} */
function firstMalformedRow(item) {
  if (!item || typeof item !== 'object') return null;
  for (const [block, label] of [[item.badge, 'badge'], [item.monitoring?.activity, 'monitoring.activity']]) {
    if (!block || typeof block !== 'object') continue;
    for (const sub of SUBKEYS) {
      const v = block[sub];
      if (!Array.isArray(v)) continue;   /* the legacy object shape is still accepted */
      const at = v.findIndex(r => !isRow(r));
      if (at !== -1) return { field: `${label}.${sub}`, index: at };
    }
  }
  return null;
}

/* Rows -> plain { key: value } for the outbound request. Skips rows with a
   blank key or a null value (a scrubbed secret with no stored value).
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

/* Restore values the browser dropped. A secret row is sent without its value, so
   it is refilled from the stored row with the same key and a working credential
   is never silently blanked.

   A row arriving as non-secret is NOT refilled, even when a stored value exists
   for that key. Refilling it would move a stored secret into a row that
   scrubRows sends to the browser in full, so unticking the Secret box and saving
   would hand back the credential in plaintext, in GET /api/config and in the
   config export. Unticking therefore clears the stored value and the credential
   has to be retyped. That is the documented guarantee in docs/security.md: a
   value stored as secret never leaves the server.

   A row whose key has no stored match (new row, or a renamed one) also stays
   blank, which is the same safe default: it never leaks an unrelated stored
   value into a different key. Mutates and returns newRows. */
function preserveRows(newRows, oldRows) {
  const nrows = toRows(newRows);
  const orows = toRows(oldRows);
  for (const r of nrows) {
    const needsValue = r.value == null || r.value === '';
    if (needsValue) {
      /* Only a row still marked secret may be refilled. */
      const donor = r.secret
        ? orows.find(o => o.key === r.key && o.value != null && o.value !== '')
        : null;
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
  toRows, isRow, droppedRowCount, firstMalformedRow, rowsToObject, requestParts,
  scrubRows, preserveRows,
  scrubItemBadgeSecrets, preserveItemBadgeSecrets,
  migrateItemBadgeHeaders,
};
