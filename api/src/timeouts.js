module.exports = {
  PING_MS: 6000,
  FETCH_MS: 8000,
  /* The batched dashboard polls answer only when every item has settled, so one
     dead service delays every tile by this much. Shorter than PING_MS, which
     bounds a single connection test a user is waiting on. */
  BATCH_MS: 2500,
  /* Every upstream call of one widget-data request shares this. Keep it under
     proxy_read_timeout for /api/ in nginx/dashboard.conf. Past that, nginx
     drops the whole reply. */
  WIDGET_BUDGET_MS: 12000,
  /* Keep it short. A stalled widget holds a browser connection this long, and 6
     of them block every other request from the dashboard. */
  WIDGET_HOLD_MS: 1000,
  /* Keep it above the longest widget poll interval. Below that, a slow service
     shows an error instead of its last result. */
  WIDGET_KEEP_MS: 15 * 60 * 1000,
};
