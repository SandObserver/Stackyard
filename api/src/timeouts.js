module.exports = {
  PING_MS: 6000,
  FETCH_MS: 8000,
  /* The batched dashboard polls answer only when every item has settled, so one
     dead service delays every tile by this much. Shorter than PING_MS, which
     bounds a single connection test a user is waiting on. */
  BATCH_MS: 2500,
};
