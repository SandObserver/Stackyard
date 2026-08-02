/* Rate limits for the routes that reach out to the user's own services.

   These are the polling endpoints: a dashboard calls them on a timer, and each
   call becomes a request to a Pi-hole, a NAS or whatever else is configured. So
   the ceiling is not about protecting Stackyard, which does little work here, but
   about bounding how fast one client can drive traffic at someone's homelab. None
   of them had a limit, so 40 requests in a burst produced 40 upstream requests.

   Derived from what the dashboard actually does, not chosen for roundness:

     /api/badges           polled every 20s   ->  3/min per tab
     /api/health           polled every 30s   ->  2/min per tab
     /api/widget-data/:id  every 30s, the default in widget-toolbox poll()
     /api/widget-options   on demand in Admin, never on a timer

   Headroom assumes ten devices behind one address, which is generous for a
   household where a phone, tablet and desktop all appear as the same LAN IP,
   and then doubles it to cover a refetch when a tab regains focus.

   The result is that ordinary use never approaches the ceiling: one open tab
   spends about 5% of the badges allowance. Being refused means something is
   genuinely wrong, such as a reload loop, rather than a busy household.

   Limits are per client and per route, so one client hitting a ceiling does not
   affect anyone else. Compare the limits that already existed: 30/min for ping
   and 60/min for badge-proxy. */

const MINUTE = 60_000;

module.exports = {
  MINUTE,
  /* 3/min per tab x 10 devices, doubled. */
  BADGES:  { max: 60,  windowMs: MINUTE },
  /* 2/min per tab x 10 devices, doubled. */
  HEALTH:  { max: 40,  windowMs: MINUTE },
  /* Counted per widget id, and a dashboard may hold a dozen widgets, so this is
     the busiest of the four. 2/min x 12 widgets x 10 devices, halved because a
     single id is only polled by the tabs showing that widget. */
  WIDGET_DATA: { max: 120, windowMs: MINUTE },
  /* Admin only, driven by opening a config form. Nothing polls it. */
  WIDGET_OPTIONS: { max: 30, windowMs: MINUTE },
};
