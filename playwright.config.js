// @ts-check
/* End-to-end tests, run against the container the release publishes.

   The unit suites cover logic without a DOM. These cover what only a browser
   shows: that the admin form saves what it displays, that an edit changes only
   what was edited, that a saved change survives a reload, and that the
   dashboard renders tiles, badges, search and an embedded widget. Drag
   reordering, the mobile layout and the Persian mirroring are
   not covered here yet.

   Two browsers on purpose. WebKit is not decoration: the support floor is
   Safari 26.2 (header of ui/css/tokens.css), and the last two layout and
   keyboard problems found by hand were WebKit-specific.

   BASE_URL points at a running Stackyard. The workflow starts the built image;
   nothing is started here, because the thing worth testing is the image that
   ships, nginx and its headers included. */

const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');
const { BASE_URL: baseURL, AUTH_BASE_URL } = require('./e2e/base-url');

/** @param {'chromium' | 'webkit'} name @param {string} device */
const browser = (name, device) => {
  const storageState = path.join(__dirname, 'test-results', '.auth', `${name}.json`);
  return [
    { name: `sign-in ${name}`, testMatch: /sign-in\.setup\.js$/, metadata: { storageState }, use: devices[device] },
    {
      name,
      dependencies: [`sign-in ${name}`],
      testIgnore: /auth\.spec\.js$/,
      use: {
        ...devices[device],
        storageState,
        ...(name === 'webkit' && { trace: 'retain-on-failure-and-retries' }),
      },
    },
  ];
};

module.exports = defineConfig({
  testDir: './e2e',
  /* Each spec seeds its own state through the API, so they must not interleave
     against one shared container. CI shards split single tests across
     machines, so no test may depend on another test in its file. */
  workers: 1,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  globalTimeout: 20 * 60_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['list'], ['blob']] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    ...browser('chromium', 'Desktop Chrome'),
    ...browser('webkit', 'Desktop Safari'),
    {
      name: 'auth',
      testMatch: /auth\.spec\.js$/,
      use: { ...devices['Desktop Chrome'], baseURL: AUTH_BASE_URL },
    },
  ],
});
