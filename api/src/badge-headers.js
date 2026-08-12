/* Badge and activity header and query rows: { key, value, secret }. A secret
   row's value never leaves the server. A save that omits it keeps the stored
   value. */

const SUBKEYS = ['headers', 'params'];

/** @param {unknown} r @returns {boolean} */
function isRow(r) {
  return (
    !!r && typeof r === 'object' && !Array.isArray(r) && typeof (/** @type {{key?:unknown}} */ (r).key) === 'string'
  );
}

/** @param {unknown} v @returns {boolean} */
function isRowArray(v) {
  return Array.isArray(v) && v.every(isRow);
}

/* Old shape ({ key: value }) to rows. Treat an array as rows however damaged.
   The legacy-object branch turns array indices into header names and drops the
   real credential. */
function toRows(v) {
  if (Array.isArray(v)) {
    return v.every(isRow) ? v : v.filter(isRow);
  }
  if (v && typeof v === 'object') {
    return Object.entries(v).map(([key, value]) => ({ key, value: String(value), secret: false }));
  }
  return [];
}

/** @param {unknown} v @returns {number} */
function droppedRowCount(v) {
  return Array.isArray(v) ? v.length - v.filter(isRow).length : 0;
}

/** @param {unknown} item @returns {{ field:string, index:number }|null} */
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
      if (!Array.isArray(v)) continue;
      const at = v.findIndex(r => !isRow(r));
      if (at !== -1) return { field: `${label}.${sub}`, index: at };
    }
  }
  return null;
}

/** @param {any} rows @returns {Record<string,string>} */
function rowsToObject(rows) {
  /** @type {Record<string,string>} */
  const out = Object.create(null);
  for (const r of toRows(rows)) {
    if (!r.key || r.value == null || r.value === '') continue;
    out[r.key] = r.value;
  }
  return out;
}

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

/* Never refill a row that arrives non-secret. It would move the credential into
   a row scrubRows sends to the browser in full. */
function preserveRows(newRows, oldRows) {
  const nrows = toRows(newRows);
  const orows = toRows(oldRows);
  for (const r of nrows) {
    const needsValue = r.value == null || r.value === '';
    if (needsValue) {
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
