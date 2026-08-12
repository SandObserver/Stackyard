// @ts-check
/* The address the specs run against, defined once.

   Both the Playwright config and the seeding helper need it: the config to
   resolve relative paths, the helper to state an origin on a write. Defining it
   in each would let one point somewhere the other does not, and the failure
   that produces is a rejected write rather than an obvious misconfiguration. */

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8730';

module.exports = { BASE_URL };
