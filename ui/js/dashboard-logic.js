// @ts-check
/* Pure decisions lifted out of dashboard.js so they can be tested without a DOM
   or a network. No DOM, no fetch, no module state. */

/** Whether the open dashboard should reload to pick up a config change.

    Compares the server's `_rev`, which is an exact answer. The field fingerprint
    is only a fallback for a page held open across an upgrade, whose loaded copy
    predates `_rev`; it misses any field nobody thought to list.

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

/** Where to send the browser once first-run setup is finished.

    A fresh install has no items, so the dashboard has nothing to act on and
    Admin is where the first one is added. Only the automatic step after setup:
    opening `/` afterwards is not blocked, and an empty dashboard stays empty.

    @param {unknown} items the dashboard items the page was built from
    @returns {string|null} a path to navigate to, or null to stay put */
export function landingAfterSetup(items) {
  return Array.isArray(items) && items.length === 0 ? '/admin' : null;
}
