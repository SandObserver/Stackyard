// @ts-check
/* The address the specs run against, defined once. The Playwright config and
   the seeding helper both read it. */

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8730';

module.exports = { BASE_URL };
