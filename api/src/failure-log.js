const log = require('./log');

const REPEAT_MS = 10 * 60 * 1000;
const FORGET_MS = 60 * 60 * 1000;

/** @type {Map<string, { reason: string, since: number, loggedAt: number, seenAt: number, failures: number }>} */
const _failing = new Map();

/* Keys can come from a request. An entry nothing has touched for an hour is
   dropped without a recovery line. */
function prune(now) {
  for (const [key, s] of _failing) if (now - s.seenAt >= FORGET_MS) _failing.delete(key);
}

/** Logs the first failure, a changed reason, and a reminder at most every
    REPEAT_MS while the same failure lasts.
    @param {string} key @param {string} msg @param {Record<string, unknown>} fields
    @param {string} reason @param {number} [now] */
function failed(key, msg, fields, reason, now = Date.now()) {
  prune(now);
  const s = _failing.get(key);
  if (!s || s.reason !== reason) {
    _failing.set(key, { reason, since: now, loggedAt: now, seenAt: now, failures: 1 });
    log.error(msg, { ...fields, error: reason });
    return;
  }
  s.seenAt = now;
  s.failures++;
  if (now - s.loggedAt < REPEAT_MS) return;
  s.loggedAt = now;
  log.error(msg, { ...fields, error: reason, failures: s.failures, since: new Date(s.since).toISOString() });
}

/** @param {string} key @param {string} msg @param {Record<string, unknown>} fields */
function recovered(key, msg, fields) {
  const s = _failing.get(key);
  if (!s) return;
  _failing.delete(key);
  log.info(msg, { ...fields, failures: s.failures });
}

function reset() {
  _failing.clear();
}

module.exports = { failed, recovered, reset, REPEAT_MS, FORGET_MS };
