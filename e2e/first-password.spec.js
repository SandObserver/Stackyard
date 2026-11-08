// @ts-check

const { test, expect } = require('@playwright/test');
const { seedConfig } = require('./helpers');

const NEW = 'quiet otter lantern 42';

test.beforeEach(async ({ request, page }) => {
  await seedConfig(request, { items: [] });
  /* Once dismissed, the server never offers the prompt again. */
  await page.route('**/api/auth/check', async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), setupPrompted: false, passwordSet: false } });
  });
});

test('the first-run card needs the setup code before it sets a password', async ({ page }) => {
  /** @type {any[]} */
  const bodies = [];
  const replies = [
    { status: 403, json: { error: 'The setup code is incorrect.', kind: 'invalid', code: 'invalid.setup-code' } },
    { json: { ok: true } },
  ];
  await page.route('**/api/auth/set-password', route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill(/** @type {any} */ (replies.shift()));
  });
  await page.goto('/');
  const card = page.locator('dialog.setup-prompt');
  await card.getByLabel('New password').fill(NEW);
  await card.getByLabel('Confirm password').fill(NEW);
  const set = card.getByRole('button', { name: 'Set' });
  await expect(set).toBeDisabled();

  const code = card.getByLabel('Setup code');
  await expect(code).toHaveAccessibleDescription(/container log/);
  await code.fill('WRONG-CODE');
  await expect(set).toBeEnabled();
  await set.click();
  await expect(card.locator('#setup-err')).toHaveText(
    'The setup code is incorrect. Copy it again from the container log.',
  );
  await expect(code).toBeFocused();

  await code.fill('ABCD-EFGH');
  await page.route('**/api/auth/check', route => route.fulfill({ json: { enabled: true, authenticated: true } }));
  await set.click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies.map(b => b.code)).toEqual(['WRONG-CODE', 'ABCD-EFGH']);
});
