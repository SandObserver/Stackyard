// @ts-check
/* Icons from the catalogues load through the server. The browser never asks
   the CDN, even when the server cannot supply a file. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app, openDashboardList } = require('./helpers');

const ITEMS = [
  { ...app('unknown', 'Unknown'), iconUrl: 'no-such-icon-in-any-catalogue' },
  { ...app('linked', 'Linked'), iconUrl: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyfin-light.svg' },
];

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: ITEMS });
  await dismissSetupPrompt(request);
});

for (const [path, open] of [
  ['/', page => page.goto('/')],
  ['/admin/', openDashboardList],
]) {
  test(`${path} never requests an icon from the CDN`, async ({ page }) => {
    const outside = [];
    page.on('request', r => {
      if (new URL(r.url()).host === 'cdn.jsdelivr.net') outside.push(r.url());
    });
    const proxied = [];
    page.on('response', r => {
      if (r.url().includes('/api/icons/cdn?')) proxied.push(new URL(r.url()).searchParams.get('name'));
    });
    await open(page);
    await expect.poll(() => [...new Set(proxied)].sort()).toEqual(['jellyfin-light', 'no-such-icon-in-any-catalogue']);
    await page.waitForLoadState('networkidle');
    expect(outside).toEqual([]);
  });
}
