// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt } = require('./helpers');

const app = n => ({ id: `a${n}`, type: 'app', label: `App ${n}`, href: 'https://example.lan/', iconUrl: 'sonarr' });
const manyApps = Array.from({ length: 120 }, (_, n) => app(n));

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: manyApps, settings: {} });
  await dismissSetupPrompt(request);
});

test('icons on the page in view load at once and later pages stay lazy', async ({ page }) => {
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  const lazy = page.locator('#pages > *').nth(0).locator('img[loading="lazy"]');
  await expect(page.locator('#pages > *').nth(0).locator('img').first()).toBeAttached();
  await expect(lazy).toHaveCount(0);
  await expect(page.locator('#pages > *').nth(1).locator('img[loading="lazy"]').first()).toBeAttached();
});

test('Settings asks for its start-up data together', async ({ page }) => {
  const configAsked = new Promise(resolve => {
    page.on('request', r => {
      if (new URL(r.url()).pathname === '/api/config') resolve(undefined);
    });
  });
  await page.route('**/api/icons/local', async route => {
    await configAsked;
    await route.continue();
  });
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
});

async function restore(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
}

test('a page restored with no changes lifts its veil without reloading', async ({ page }) => {
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  await restore(page);
  await page.locator('body.ready').waitFor({ state: 'attached' });
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

test('a page restored after a settings change reloads', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  await seedConfig(request, { items: manyApps.slice(0, 3), settings: {} });
  await restore(page);
  await page.waitForFunction(() => !window.__sameDocument);
  await page.locator('body.ready').waitFor({ state: 'attached' });
});

test('Settings shows no form until its real values are in', async ({ page }) => {
  let release = () => {};
  const held = new Promise(resolve => {
    release = () => resolve(undefined);
  });
  await page.route('**/api/config', async route => {
    await held;
    await route.continue();
  });
  await page.goto('/admin/');
  await expect(page.locator('.sb-nav')).toBeVisible();
  await expect(page.locator('.cp')).toBeHidden();
  release();
  await expect(page.locator('.cp')).toBeVisible();
});

test('Settings still shows its failure message when the config cannot load', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ status: 500, json: { error: 'no' } }));
  await page.goto('/admin/');
  await expect(page.locator('.cp')).toBeVisible();
  await page.locator('.nl[data-sec="dashboard"]').click();
  await expect(page.locator('.dash-load-fail')).toBeVisible();
});

test('the last wallpaper is requested and its colour painted before the page has built', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sy-boot', JSON.stringify({ url: '/favicon.ico?hint', color: 'rgb(9,8,7)' }));
  });
  const hinted = page.waitForRequest(r => r.url().endsWith('/favicon.ico?hint'));
  await page.goto('/');
  await hinted;
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--boot-bg')))
    .toBe('rgb(9,8,7)');
});
