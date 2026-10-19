/* One refresh per key runs at a time. A caller waits for it only until it is
   holdMs old. After that it gets the last settled outcome, or null when there
   is none younger than keepMs. */

/** @typedef {{ ok: true, value: any, at: number } | { ok: false, error: unknown, at: number }} Outcome */

/** @type {Map<string, { started: number, at: number, keepMs: number, outcome: Outcome | null, pending: Promise<Outcome> | null, group: string | null }>} */
const _entries = new Map();

function prune(now) {
  for (const [key, e] of _entries) if (!e.pending && now - e.at >= e.keepMs) _entries.delete(key);
}

/* Drops the oldest settled entries of a group until at most max remain. A
   refresh in flight is never dropped. */
function cap(group, max) {
  /** @type {{ key: string, at: number }[]} */
  const settled = [];
  let count = 0;
  for (const [key, e] of _entries) {
    if (e.group !== group) continue;
    count++;
    if (!e.pending) settled.push({ key, at: e.at });
  }
  settled.sort((a, b) => a.at - b.at);
  for (let i = 0; count > max && i < settled.length; i++, count--) _entries.delete(settled[i].key);
}

/** @param {number} ms @param {Promise<Outcome>} pending @returns {Promise<Outcome | undefined>} */
function within(ms, pending) {
  let timer;
  const expired = new Promise(resolve => {
    timer = setTimeout(resolve, Math.max(0, ms));
  });
  return Promise.race([pending, expired]).finally(() => clearTimeout(timer));
}

/** @param {string} key @param {() => any} refresh
    @param {{ holdMs: number, keepMs: number, group?: string, maxPerGroup?: number }} opts
    @returns {Promise<Outcome | null>} */
async function latest(key, refresh, { holdMs, keepMs, group, maxPerGroup }) {
  const now = Date.now();
  prune(now);
  let e = _entries.get(key);
  const created = !e;
  if (!e) {
    e = { started: 0, at: 0, keepMs, outcome: null, pending: null, group: group ?? null };
    _entries.set(key, e);
  }
  e.keepMs = keepMs;
  const entry = e;
  if (!entry.pending) {
    entry.started = now;
    entry.pending = (async () => refresh())()
      .then(
        value => /** @type {Outcome} */ ({ ok: true, value, at: Date.now() }),
        error => /** @type {Outcome} */ ({ ok: false, error, at: Date.now() }),
      )
      .then(outcome => {
        entry.outcome = outcome;
        entry.at = outcome.at;
        entry.pending = null;
        return outcome;
      });
  }
  if (created && group != null && maxPerGroup) cap(group, maxPerGroup);
  const fresh = await within(entry.started + holdMs - now, entry.pending);
  if (fresh) return fresh;
  return entry.outcome && Date.now() - entry.at < keepMs ? entry.outcome : null;
}

function reset() {
  _entries.clear();
}

module.exports = { latest, reset, _size: () => _entries.size };
