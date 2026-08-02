const { on, json, readBody, getIp, checkOrigin } = require('../router');
const { loadConfig } = require('../config');
const { fetchChecked, fetchUnchecked, pingChecked, statusDesc } = require('../proxy');
const { rateLimit } = require('../auth');
const LIMITS = require('../poll-limits');
const { PING_MS, FETCH_MS } = require('../timeouts');
const { IS_DEMO } = require('../demo');
const demoData = require('../demo-data');
const { collectNumbers, computeBadgeValue } = require('../badge-extract');
const { requestParts, toRows, preserveItemBadgeSecrets, rowsToObject, droppedRowCount } = require('../badge-headers');
const log = require('../log');
const { fail, KIND, errorBody } = require('../api-error');
const { badgeRequestMatchesSaved, RETYPE_MESSAGE } = require('../secret-scope');

on('POST', '/api/ping', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'ping', 30, 60_000);
    if (limited) return json(res, 429, { ok:false, error:limited, kind: KIND.BLOCKED });
    const { url, skipTls=false } = JSON.parse(await readBody(req));
    if (!url) return json(res, 400, { ok:false, error:'url required', kind: KIND.INVALID });
    json(res, 200, await pingChecked(url, PING_MS, skipTls === true));
  } catch(e) {
    if (e.status === 403) return fail(res, e, { extra:{ ok:false } });
    json(res, 200, Object.assign({ ok:false, status:0 }, errorBody(e)));
  }
});

on('GET', '/api/badges', async(req, res) => {
  /* Every call here fans out to the user's own services, so the ceiling bounds
     outbound traffic rather than work done here. See poll-limits.js. */
  const limited = rateLimit(getIp(req), 'badges', LIMITS.BADGES.max, LIMITS.BADGES.windowMs);
  if (limited) return json(res, 429, { error:limited, kind: KIND.BLOCKED });
  const cfg = loadConfig(), out = {};
  if (IS_DEMO) return json(res, 200, demoData.demoBadges(cfg.items));
  await Promise.allSettled(cfg.items
    .filter(i => i.type==='app' && (
      (i.badge?.enabled && i.badge?.url) ||
      (i.monitoring?.activity?.enabled && i.monitoring?.activity?.url)
    ))
    .map(async item => {
      try {
        const src = item.monitoring?.activity?.enabled ? item.monitoring.activity : item.badge;
        /* A stored row that is not a { key, value, secret } entry is skipped
           rather than failing the badge, so say which item is damaged. Silence
           here is what made this misleading: the request went out without its
           credential and the service answered as it would to any stranger. */
        const dropped = droppedRowCount(item?.monitoring?.activity?.enabled ? item.monitoring.activity?.headers : item?.badge?.headers)
                      + droppedRowCount(item?.monitoring?.activity?.enabled ? item.monitoring.activity?.params : item?.badge?.params);
        if (dropped) log.warn('badge config has entries that are not valid rows, skipping them', { item: item.id, dropped });
        const { headers, params } = requestParts(item);
        const baseUrl = src.url;
        const url = Object.keys(params).length
          ? baseUrl + (baseUrl.includes('?') ? '&' : '?') + new URLSearchParams(params)
          : baseUrl;
        const r   = await fetchUnchecked(url, { headers, timeout:PING_MS, skipTls: item.skipTlsVerify === true });
        const badge = item.monitoring?.activity?.enabled ? {
          extract: item.monitoring.activity.extract,
          params:  item.monitoring.activity.params,
        } : item.badge;
        out[item.id] = { value: computeBadgeValue(r.data, badge), raw:r.data };
      } catch(e) { out[item.id] = Object.assign({ value:0 }, errorBody(e)); }
    }));
  json(res, 200, out);
});

on('POST', '/api/badge-proxy', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'badge-proxy', 60, 60_000);
    if (limited) return json(res, 429, { error:limited, kind: KIND.BLOCKED });
    const body = JSON.parse(await readBody(req));
    const { url, itemId, skipTls=false } = body;
    if (!url) return json(res, 400, { error:'url required', kind: KIND.INVALID });
    /* Rows the user did not retype arrive as secret rows without a value. Fill
       them from the stored item so a test after reload uses the real credential,
       without ever sending it to the browser.

       Only when the request targets exactly the saved destination with exactly
       the saved non-secret rows. Otherwise the request picks the URL while the
       server picks the credential, and a stored secret would be delivered
       wherever the caller asked. See secret-scope.js. */
    let headerRows = toRows(body.headers);
    let paramRows = toRows(body.params);
    let declined = false;
    if (itemId) {
      const stored = loadConfig().items?.find(i => i && i.id === itemId);
      if (stored) {
        const oldSrc = stored.monitoring?.activity?.enabled ? stored.monitoring.activity : stored.badge;
        if (badgeRequestMatchesSaved({ url, headers: headerRows, params: paramRows }, oldSrc)) {
          const shim = { badge: { headers: headerRows, params: paramRows } };
          preserveItemBadgeSecrets(shim, { badge: { headers: oldSrc?.headers, params: oldSrc?.params } });
          headerRows = shim.badge.headers; paramRows = shim.badge.params;
        } else {
          declined = true;
        }
      }
    }
    const headers = rowsToObject(headerRows);
    const params = rowsToObject(paramRows);
    const fullUrl = Object.keys(params).length ? url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params) : url;
    const r = await fetchChecked(fullUrl, { headers, timeout:FETCH_MS, skipTls: skipTls === true });
    /* fetchJSON resolves on a 4xx/5xx rather than rejecting, so an upstream that
       answered "401 Unauthorised" used to come back here as a plain 200 with an
       error body attached. The admin UI could not tell that apart from success:
       it reported "Connected, no numeric values found" and never offered to
       enable authentication, which is the case its auth branch exists for.
       Report it as a failure, with the upstream's status as data. */
    if (r.status >= 400) {
      /* A 401/403 straight after declining to restore is almost certainly the
         missing credential, not a wrong key. Say which it is. */
      if (declined && (r.status === 401 || r.status === 403)) {
        return json(res, 502, { error: RETYPE_MESSAGE, kind: KIND.INVALID });
      }
      return json(res, 502, {
        error: `The service answered ${statusDesc(r.status)} (HTTP ${r.status}).`,
        kind:  KIND.UPSTREAM,
        detail: { status: r.status },
      });
    }
    json(res, 200, { status:r.status, data:r.data, numbers:collectNumbers(r.data) });
  } catch(e) { fail(res, e, { status:502 }); }
});

