// @ts-check
const { test: setup, expect } = require('@playwright/test');
const { PASSWORD } = require('./base-url');

setup('sign in through the sign-in screen', async ({ page }) => {
  const before = await (await page.request.get('/api/auth/check')).json();
  expect(before.enabled, 'start the container with INITIAL_PASSWORD set to PASSWORD in e2e/base-url.js').toBe(true);
  await page.goto('/admin/');
  await expect(page.locator('#login-pw')).toBeFocused();
  await page.locator('#login-pw').fill(PASSWORD);
  await page.locator('#login-btn').click();
  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('body.authed')).toBeAttached();
  const res = await page.request.get('/api/auth/check');
  expect(await res.json()).toMatchObject({ enabled: true, authenticated: true });
  await page.context().storageState({ path: String(setup.info().project.metadata.storageState) });
});
