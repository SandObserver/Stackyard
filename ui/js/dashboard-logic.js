// @ts-check
/* Pure decisions lifted out of dashboard.js so they can be tested without a DOM
   or a network. No DOM, no fetch, no module state. */

/** Whether the open dashboard should reload to pick up a config change.

    The poll used to compare a hand-picked fingerprint: each item's id, label and
    href, plus the settings blob. Everything else was invisible, so changing an
    icon, a colour, a dock pin, a hidden flag or any badge setting left every
    other open dashboard showing stale content until someone reloaded by hand.
    A list of fields like that goes stale silently the next time a field is
    added.

    The server stamps `_rev` on every write, which is already an exact answer to
    "has anything changed", so that is what is compared. The fingerprint stays as
    a fallback for a page held open across an upgrade, where the loaded copy
    predates the server sending one.

    @param {any} loaded the config this page was built from
    @param {any} fetched what the poll just received
    @returns {boolean} */
export function configChanged(loaded, fetched) {
  if (!fetched || typeof fetched !== 'object') return false;
  if (fetched._rev != null && loaded?._rev != null) return fetched._rev !== loaded._rev;
  return fingerprint(fetched) !== fingerprint(loaded);
}

/** @param {any} c */
function fingerprint(c) {
  return JSON.stringify(c?.items?.map(i => `${i?.id}|${i?.label}|${i?.href}`)) + JSON.stringify(c?.settings);
}
