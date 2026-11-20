// @ts-check
/* The addresses and the password the specs run against, defined once. The
   Playwright config, the helpers, the workflow and the local recipe read them
   from here. */

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8730';

/* A second container for sign-in limits. A lockout on BASE_URL fails every
   later spec. */
const AUTH_BASE_URL = process.env.AUTH_BASE_URL || 'http://127.0.0.1:8733';

/* Both containers start with this as INITIAL_PASSWORD. */
const PASSWORD = 'e2e copper harbour lamp 7';

module.exports = { BASE_URL, AUTH_BASE_URL, PASSWORD };
