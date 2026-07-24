/* Upstream request timeouts, in milliseconds. Centralized so the values are not
   scattered as literals across the proxy and route modules. */
module.exports = {
  PING_MS:   6000,  /* reachability pings, health checks, version check, fast badge polls */
  FETCH_MS:  8000,  /* default upstream data fetches */
};
