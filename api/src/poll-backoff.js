/* Batched polls fan out to every configured target on every cycle. A target
   that has been unreachable for months costs a full timeout each time, and the
   batch answers only when everything has settled, so it delays the tiles that
   did answer.

   After a few consecutive failures a target is left alone until its next
   attempt time, and the caller reuses the failure it already reported. Only a
   thrown request counts: a service that answers with an error status is
   reachable and is polled normally. */

const FAILURES_BEFORE_BACKOFF = 3;
const FIRST_DELAY_MS = 30_000;
const MAX_DELAY_MS = 120_000;

/** @type {Map<string, { fails: number, nextAttempt: number, last: any }>} */
const _state = new Map();

/** @param {string} key @param {number} [now] */
function skip(key, now = Date.now()) {
  const s = _state.get(key);
  return !!s && s.fails >= FAILURES_BEFORE_BACKOFF && now < s.nextAttempt;
}

/** The result last reported for a target being skipped.
    @param {string} key */
function remembered(key) {
  return _state.get(key)?.last;
}

/** @param {string} key */
function success(key) {
  _state.delete(key);
}

/** @param {string} key @param {any} last what the caller reported this cycle
    @param {number} [now] */
function failure(key, last, now = Date.now()) {
  const s = _state.get(key) || { fails: 0, nextAttempt: 0, last: undefined };
  s.fails++;
  s.last = last;
  if (s.fails >= FAILURES_BEFORE_BACKOFF) {
    const step = FIRST_DELAY_MS * 2 ** (s.fails - FAILURES_BEFORE_BACKOFF);
    s.nextAttempt = now + Math.min(step, MAX_DELAY_MS);
  }
  _state.set(key, s);
}

/* Editing a target's address must retry it at once rather than wait out a
   backoff earned by the previous address. */
function reset() {
  _state.clear();
}

module.exports = {
  skip,
  remembered,
  success,
  failure,
  reset,
  FAILURES_BEFORE_BACKOFF,
  FIRST_DELAY_MS,
  MAX_DELAY_MS,
};
