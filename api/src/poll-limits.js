/* Rate limits for the polling routes. Each call becomes a request to the user's
   own Pi-hole or NAS, so the ceiling bounds how fast one client can drive
   traffic at someone's homelab, not how much work Stackyard does.

   Derived from the dashboard's own intervals, with headroom for ten devices
   behind one address and a refetch when a tab regains focus. One open tab spends
   about 5% of the badges allowance. */

const MINUTE = 60_000;

module.exports = {
  MINUTE,
  /* 3/min per tab x 10 devices, doubled. */
  BADGES:  { max: 60,  windowMs: MINUTE },
  /* 2/min per tab x 10 devices, doubled. */
  HEALTH:  { max: 40,  windowMs: MINUTE },
  /* Per widget id: 2/min x 12 widgets x 10 devices, halved because one id is
     only polled by the tabs showing that widget. */
  WIDGET_DATA: { max: 120, windowMs: MINUTE },
  /* Admin only, driven by opening a config form. Nothing polls it. */
  WIDGET_OPTIONS: { max: 30, windowMs: MINUTE },
};
