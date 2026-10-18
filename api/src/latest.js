/* One refresh per key runs at a time. A caller waits for it only until it is
   holdMs old. After that it gets the last settled outcome, or null when there
   is none younger than keepMs. */

/** @typedef {{ ok: true, value: any } | { ok: false, error: unknown }} Outcome */

/** @type {Map<string, { started: number, at: number, outcome: Outcome | null, pending: Promise<Outcome> | null }>} */
const _entries = new Map();

function prune(now, keepMs) {
  for (const [key, e] of _entries) if (!e.pending && now - e.at >= keepMs) _entries.delete(key);
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
    @param {{ holdMs: number, keepMs: number }} opts @returns {Promise<Outcome | null>} */
async function latest(key, refresh, { holdMs, keepMs }) {
  const now = Date.now();
  prune(now, keepMs);
  let e = _entries.get(key);
  if (!e) {
    e = { started: 0, at: 0, outcome: null, pending: null };
    _entries.set(key, e);
  }
  const entry = e;
  if (!entry.pending) {
    entry.started = now;
    entry.pending = (async () => refresh())()
      .then(
        value => /** @type {Outcome} */ ({ ok: true, value }),
        error => /** @type {Outcome} */ ({ ok: false, error }),
      )
      .then(outcome => {
        entry.outcome = outcome;
        entry.at = Date.now();
        entry.pending = null;
        return outcome;
      });
  }
  const fresh = await within(entry.started + holdMs - now, entry.pending);
  if (fresh) return fresh;
  return entry.outcome && Date.now() - entry.at < keepMs ? entry.outcome : null;
}

function reset() {
  _entries.clear();
}

module.exports = { latest, reset };
