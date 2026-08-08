// @ts-check
/* End-to-end tests, run against the container the release publishes.

   The unit suites cover logic without a DOM. These cover the things only a
   browser shows: that a form saves what it displays, that a drag reorders and
   the order survives a reload, that focus stays where it should, and that the
   interface mirrors in Persian.

   Two browsers on purpose. WebKit is not decoration: the documented support
   floor is Safari 16.2, and the last two layout and keyboard problems found by
   hand were Safari-specific.

   BASE_URL points at a running Stackyard. The workflow starts the built image;
   nothing is started here, because the thing worth testing is the image that
   ships, nginx and its headers included. */

const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8730';

module.exports = defineConfig({
  testDir: './e2e',
  /* Each spec seeds its own state through the API, so they must not interleave
     against one shared container. */
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    /* Only on a retry: a trace for every passing test is a lot of artefact for
       nothing. */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
