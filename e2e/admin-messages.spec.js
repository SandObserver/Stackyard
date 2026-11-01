// @ts-check

const { test, expect } = require('@playwright/test');
const { seedConfig, app, openDashboardList, rowByName, setInlineRow } = require('./helpers');

const PROTECTED = { enabled: true, authenticated: true, passwordSet: true };
const WRONG_PASSWORD = {
  status: 403,
  json: { error: 'Current password is incorrect.', kind: 'invalid', code: 'invalid.current-password' },
};
const SIGNED_OUT = { status: 401, json: { error: 'Unauthorised', kind: 'auth' } };

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha')] });
});

/** Open General as a protected install, switch protection off and press Save.
    @param {import('@playwright/test').Page} page */
async function askToTurnOffProtection(page) {
  await page.route('**/api/auth/check', route => route.fulfill({ json: PROTECTED }));
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator('.nl[data-sec="general"]').click();
  await expect(page.locator('#sec-en')).toBeChecked();
  await page.locator('label.tog:has(#sec-en)').click();
  await page.locator('#srv-save').click();
  const prompt = page.locator('dialog.dlg-box');
  await expect(prompt.getByLabel('Current password')).toBeFocused();
  return prompt;
}

test('a wrong current password keeps the dialog open with the error at the field', async ({ page }) => {
  const replies = [WRONG_PASSWORD, { json: { ok: true } }];
  await page.route('**/api/auth/toggle', route => route.fulfill(/** @type {any} */ (replies.shift())));
  const prompt = await askToTurnOffProtection(page);
  const field = prompt.getByLabel('Current password');

  await field.fill('wrong');
  await prompt.getByRole('button', { name: 'Delete' }).click();
  await expect(prompt.locator('.dlg-err')).toHaveText('The current password is incorrect.');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();

  await field.fill('right');
  await prompt.getByRole('button', { name: 'Delete' }).click();
  await expect(prompt).toBeHidden();
  await expect(page.locator('#toast-msg')).toHaveText('Saved');
});

test('a session that ran out mid-save asks to sign in above the dialog, then finishes the save', async ({ page }) => {
  const replies = [SIGNED_OUT, { json: { ok: true } }];
  await page.route('**/api/auth/toggle', route => route.fulfill(/** @type {any} */ (replies.shift())));
  await page.route('**/api/auth/login', route => route.fulfill({ json: { ok: true } }));
  const prompt = await askToTurnOffProtection(page);

  await prompt.getByLabel('Current password').fill('right');
  await prompt.getByRole('button', { name: 'Delete' }).click();
  const signIn = page.locator('#login-pw');
  await expect(signIn).toBeFocused();
  await signIn.fill('anything');
  await page.locator('#login-btn').click();

  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(prompt).toBeHidden();
  await expect(page.locator('#toast-msg')).toHaveText('Saved');
  expect(replies).toHaveLength(0);
});

test('a dialog the browser closes mid-save still reports the save', async ({ page }) => {
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise(r => {
    release = () => r(undefined);
  });
  await page.route('**/api/auth/toggle', async route => {
    await held;
    await route.fulfill({ json: { ok: true } });
  });
  const prompt = await askToTurnOffProtection(page);

  await prompt.getByLabel('Current password').fill('right');
  await prompt.getByRole('button', { name: 'Delete' }).click();
  await expect(prompt).toHaveAttribute('aria-busy', 'true');
  for (let i = 0; i < 5 && (await prompt.isVisible()); i++) await page.keyboard.press('Escape');
  release();
  await expect(page.locator('#toast-msg')).toHaveText('Saved');
});

test('the sign-in screen cannot be dismissed with Escape', async ({ page }) => {
  await page.route('**/api/auth/check', route => route.fulfill({ json: { enabled: true, authenticated: false } }));
  await page.goto('/admin/');
  await expect(page.locator('#login-pw')).toBeFocused();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Escape');
  await expect(page.locator('#login-screen')).toBeVisible();
  await expect(page.locator('#login-pw')).toBeFocused();
});

test('the notice Close button returns focus and leaves the tab order with the notice', async ({ page }) => {
  await page.route('**/api/config', route =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { error: 'Disk full' } })
      : route.fallback(),
  );
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator('.nl[data-sec="appearance"]').click();
  const awake = page.locator('#set-awake');
  await awake.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#toast')).toHaveClass(/\bshow\b/);

  const close = page.locator('#toast .toast-x');
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).not.toHaveClass(/\bshow\b/);
  await expect(awake).toBeFocused();

  await expect.poll(() => close.evaluate(b => getComputedStyle(b).visibility)).toBe('hidden');
  await close.evaluate(b => /** @type {HTMLElement} */ (b).focus());
  await expect(close).not.toBeFocused();
});

test('a missing name shows under its row, marks the field and clears once it is filled', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await setInlineRow(page, 'ie-url', 'f-href', 'http://nameless.invalid');
  await page.locator('#ev-save').click();

  const note = page.locator('#ie-name + .field-err');
  await expect(note).toBeVisible();
  const field = page.locator('#f-lbl');
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', new RegExp(`\\b${await note.getAttribute('id')}\\b`));

  await field.pressSequentially('N');
  await expect(note).toHaveCount(0);
  await expect(field).not.toHaveAttribute('aria-invalid');
});

test('a required picker is marked invalid and clears once Fetch fills it', async ({ page }) => {
  await page.route('**/api/widget-options/**', route =>
    route.fulfill({ json: { options: [{ value: 'Paris', label: 'Paris', lat: 48.85, lon: 2.35 }] } }),
  );
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await page.locator('.tile-opt[data-ctype="widget"]').click();
  await page.locator('#f-wtype-btn').click();
  await page.locator('#f-wtype-list li[data-val="weather"]').click();
  await page.locator('#ev-save').click();

  const row = page.locator('.row-invalid');
  const picker = row.locator('.row-dd-btn');
  const note = page.locator('.row-invalid + .field-err');
  await expect(note).toContainText('is required');
  await expect(picker).toHaveAttribute('aria-invalid', 'true');
  await expect(picker).toHaveAttribute('aria-describedby', new RegExp(`\\b${await note.getAttribute('id')}\\b`));

  await page.getByRole('button', { name: 'Fetch' }).click();
  await expect(page.locator('.field-err')).toHaveCount(0);
  await expect(page.locator('.row-dd-btn[aria-invalid]')).toHaveCount(0);
});

test('a colour code that is not a colour is announced and clears when a swatch is picked', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: /^Edit/ }).click();
  await page.locator('#icon-col-style-btn').click();
  await page.locator('#icon-col-style-list [data-val="color"]').click();
  await setInlineRow(page, 'icon-col-code-row', 'icon-col-hex', 'notacolour');

  const note = page.locator('#icon-col-code-row + .field-err');
  await expect(note).toHaveText('That is not a color. Use #rrggbb or a CSS color name.');
  await expect(page.locator('#sr-announce')).toHaveText('That is not a color. Use #rrggbb or a CSS color name.');
  await expect(page.locator('#icon-col-code-row .pe')).toHaveAttribute(
    'aria-describedby',
    new RegExp(`\\b${await note.getAttribute('id')}\\b`),
  );

  await page.locator('#icon-color-slot .cc-swatch[data-v="red"]').click();
  await expect(note).toHaveCount(0);
  await expect(page.locator('#icon-col-code-row .pe')).not.toHaveAttribute('aria-describedby');
});
