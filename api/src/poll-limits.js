/* Each call becomes a request to the user's own services. These ceilings bound
   how fast one client can drive traffic at someone's homelab. */

const MINUTE = 60_000;

module.exports = {
  MINUTE,
  BADGES: { max: 60, windowMs: MINUTE },
  HEALTH: { max: 40, windowMs: MINUTE },
  WIDGET_DATA: { max: 120, windowMs: MINUTE },
  WIDGET_OPTIONS: { max: 30, windowMs: MINUTE },
};
