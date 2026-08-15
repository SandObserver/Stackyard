const { on, json, readBody, getIp, checkOrigin } = require('../router');
const { loadConfig } = require('../config');
const { fetchChecked, fetchUnchecked, pingChecked, statusDesc } = require('../proxy');
const { rateLimit } = require('../auth');
const LIMITS = require('../poll-limits');
const { PING_MS, FETCH_MS, BATCH_MS } = require('../timeouts');
const { IS_DEMO } = require('../demo');
const demoData = require('../demo-data');
const { collectNumbers, computeBadgeValue } = require('../badge-extract');
const { requestParts, toRows, preserveItemBadgeSecrets, rowsToObject, droppedRowCount } = require('../badge-headers');
const log = require('../log');
const { fail, KIND, errorBody } = require('../api-error');
const { badgeRequestMatchesSaved, RETYPE_MESSAGE } = require('../secret-scope');
const backoff = require('../poll-backoff');

on('POST', '/api/ping', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'ping', 30, 60_000);
    if (limited) return json(res, 429, { ok: false, error: limited, kind: KIND.BLOCKED });
    const { url, skipTls = false } = JSON.parse(await readBody(req));
    if (!url) return json(res, 400, { ok: false, error: 'url required', kind: KIND.INVALID });
    json(res, 200, await pingChecked(url, PING_MS, skipTls === true));
  } catch (e) {
    if (e.status === 403) return fail(res, e, { extra: { ok: false } });
    json(res, 200, Object.assign({ ok: false, status: 0 }, errorBody(e)));
  }
});

on('GET', '/api/badges', async (req, res) => {
  const limited = rateLimit(getIp(req), 'badges', LIMITS.BADGES.max, LIMITS.BADGES.windowMs);
  if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED });
  const cfg = loadConfig(),
    out = Object.create(null);
  if (IS_DEMO) return json(res, 200, demoData.demoBadges(cfg.items));
  await Promise.allSettled(
    cfg.items
      .filter(
        i =>
          i.type === 'app' &&
          ((i.badge?.enabled && i.badge?.url) || (i.monitoring?.activity?.enabled && i.monitoring?.activity?.url)),
      )
      .map(async item => {
        const key = `badge:${item.id}`;
        if (backoff.skip(key)) {
          out[item.id] = backoff.remembered(key) || { value: 0 };
          return;
        }
        try {
          const src = item.monitoring?.activity?.enabled ? item.monitoring.activity : item.badge;
          /* A skipped row means the request goes out without its credential.
             Report which item is damaged. */
          const dropped =
            droppedRowCount(
              item?.monitoring?.activity?.enabled ? item.monitoring.activity?.headers : item?.badge?.headers,
            ) +
            droppedRowCount(
              item?.monitoring?.activity?.enabled ? item.monitoring.activity?.params : item?.badge?.params,
            );
          if (dropped)
            log.warn('badge config has entries that are not valid rows, skipping them', { item: item.id, dropped });
          const { headers, params } = requestParts(item);
          const baseUrl = src.url;
          const url = Object.keys(params).length
            ? baseUrl + (baseUrl.includes('?') ? '&' : '?') + new URLSearchParams(params)
            : baseUrl;
          const r = await fetchUnchecked(url, { headers, timeout: BATCH_MS, skipTls: item.skipTlsVerify === true });
          const badge = item.monitoring?.activity?.enabled
            ? {
                extract: item.monitoring.activity.extract,
                params: item.monitoring.activity.params,
              }
            : item.badge;
          /* The extracted number only. This poll runs per item per tab and must
             not carry the upstream body. */
          out[item.id] = { value: computeBadgeValue(r.data, badge) };
          backoff.success(key);
        } catch (e) {
          const body = Object.assign({ value: 0 }, errorBody(e));
          backoff.failure(key, body);
          out[item.id] = body;
        }
      }),
  );
  json(res, 200, out);
});

on('POST', '/api/badge-proxy', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'badge-proxy', 60, 60_000);
    if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED });
    const body = JSON.parse(await readBody(req));
    const { url, itemId, skipTls = false } = body;
    if (!url) return json(res, 400, { error: 'url required', kind: KIND.INVALID });
    /* Refill a blanked row only when the request targets exactly the saved
       destination with exactly the saved non-secret rows. Otherwise the caller
       picks the URL while the server picks the credential. */
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
          headerRows = shim.badge.headers;
          paramRows = shim.badge.params;
        } else {
          declined = true;
        }
      }
    }
    const headers = rowsToObject(headerRows);
    const params = rowsToObject(paramRows);
    const fullUrl = Object.keys(params).length
      ? url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params)
      : url;
    const r = await fetchChecked(fullUrl, { headers, timeout: FETCH_MS, skipTls: skipTls === true });
    /* fetchJSON resolves on a 4xx/5xx rather than rejecting. Report it as a
       failure here, or the admin UI reads an error body as success. */
    if (r.status >= 400) {
      if (declined && (r.status === 401 || r.status === 403)) {
        return json(res, 502, { error: RETYPE_MESSAGE, kind: KIND.INVALID });
      }
      return json(res, 502, {
        error: `The service answered ${statusDesc(r.status)} (HTTP ${r.status}).`,
        kind: KIND.UPSTREAM,
        detail: { status: r.status },
      });
    }
    json(res, 200, { status: r.status, data: r.data, numbers: collectNumbers(r.data) });
  } catch (e) {
    fail(res, e, { status: 502 });
  }
});
