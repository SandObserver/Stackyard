// @ts-check

const { test, expect } = require('@playwright/test');
const { seedConfig, setInlineRow } = require('./helpers');

const NEW = 'quiet otter lantern 42';

test.beforeEach(async ({ request, page }) => {
  await seedConfig(request, { items: [] });
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator('.nl[data-sec="general"]').click();
  await page.locator('label.tog:has(#sec-en)').click();
});

test('a typed password never shows in its row, and a different confirmation is refused', async ({ page }) => {
  let sets = 0;
  await page.route('**/api/auth/set-password', route => {
    sets++;
    return route.fulfill({ json: { ok: true } });
  });
  await setInlineRow(page, 'ie-pw', 'sec-pw', NEW);
  await expect(page.locator('#ie-pw-v')).toHaveText('New value set');
  await expect(page.locator('#ie-pw')).not.toContainText(NEW);
  await expect(page.locator('#ie-pw2-wrap')).toHaveClass(/open/);

  await setInlineRow(page, 'ie-pw2', 'sec-pw2', `${NEW}x`);
  await expect(page.locator('#ie-pw2-v')).toHaveText('New value set');
  await expect(page.locator('.field-err', { hasText: 'Enter the same password twice.' })).toBeVisible();
  await page.locator('#srv-save').click();
  await expect(page.locator('#sec-pw2')).toHaveAttribute('aria-invalid', 'true');
  expect(sets).toBe(0);

  const confirm = page.locator('#sec-pw2');
  await expect(confirm).toBeFocused();
  await confirm.fill(NEW);
  await confirm.press('Enter');
  await expect(page.locator('.field-err')).toHaveCount(0);
  await expect(confirm).not.toHaveAttribute('aria-invalid', 'true');
});

test('the reveal button shows both fields and keeps the row open', async ({ page }) => {
  await page.locator('#ie-pw .rv').click();
  const field = page.locator('#sec-pw');
  await field.fill(NEW);
  const eye = page.locator('#ie-pw .pw-reveal');
  await expect(eye).toHaveAccessibleName('Show password');
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  await expect(field).toHaveAttribute('type', 'text');
  await expect(page.locator('#sec-pw2')).toHaveAttribute('type', 'text');
  await expect(page.locator('#ie-pw')).toHaveClass(/editing/);
  await expect(field).toBeFocused();
  await expect(eye.locator('use')).toHaveAttribute('href', /-eye-slash$/);
});

test('a first password asks for the setup code, and a wrong code keeps the dialog open', async ({ page }) => {
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
  await page.route('**/api/auth/toggle', route => route.fulfill({ json: { ok: true } }));
  await setInlineRow(page, 'ie-pw', 'sec-pw', NEW);
  await setInlineRow(page, 'ie-pw2', 'sec-pw2', NEW);
  await page.locator('#srv-save').click();

  const prompt = page.locator('dialog.dlg-box');
  const field = prompt.getByLabel('Setup code');
  await expect(field).toBeFocused();
  await expect(prompt).toContainText('Enter the setup code from the container log.');
  await field.fill('WRONG-CODE');
  await prompt.getByRole('button', { name: 'Save' }).click();
  await expect(prompt.locator('.dlg-err')).toHaveText(
    'The setup code is incorrect. Copy it again from the container log.',
  );
  await expect(field).toBeFocused();

  await field.fill('ABCD-EFGH');
  await prompt.getByRole('button', { name: 'Save' }).click();
  await expect(prompt).toHaveCount(0);
  expect(bodies.map(b => b.code)).toEqual(['WRONG-CODE', 'ABCD-EFGH']);
  expect(bodies[1].password).toBe(NEW);
});
