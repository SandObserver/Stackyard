// @ts-check
/* Keyboard focus after Settings controls redraw or hide the focused element. */

const { test, expect } = require('@playwright/test');
const { seedConfig, app, openDashboardList, rowByName } = require('./helpers');

const focused = page =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a ? (a.getAttribute('aria-label') || a.textContent || a.id || a.tagName).trim() : '';
  });

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha'), app('bravo', 'Bravo'), app('charlie', 'Charlie')] });
});

test('a list move keeps focus on the moved row', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: 'Move down: Alpha' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#al .rnm').nth(1)).toHaveText('Alpha');
  expect(await focused(page)).toBe('Move down: Alpha');

  await page.keyboard.press('Enter');
  await expect(page.locator('#al .rnm').nth(2)).toHaveText('Alpha');
  expect(await focused(page)).toBe('Move down: Alpha');

  await page.keyboard.press('Enter');
  await expect(page.locator('#al .rnm').last()).toHaveText('Alpha');
  expect(await focused(page)).toBe('Move up: Alpha');
});

test('closing the editor returns focus to the row that opened it', async ({ page }) => {
  await openDashboardList(page);
  const edit = rowByName(page, 'Bravo').getByRole('button', { name: /^Edit/ });
  await edit.focus();
  await page.keyboard.press('Enter');
  await page.locator('#ev-back').click();
  await expect(edit).toBeFocused();

  await edit.press('Enter');
  await page.locator('#ev-save').click();
  await expect(page.locator('#dash-edit-view')).toBeHidden();
  await expect(rowByName(page, 'Bravo').getByRole('button', { name: /^Edit/ })).toBeFocused();
});

test('deleting from the editor moves focus to Add', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Charlie').getByRole('button', { name: /^Edit/ }).click();
  await page.locator('#ev-delete').click();
  await page.locator('dialog .bd-btn').click();
  await expect(page.locator('#dash-edit-view')).toBeHidden();
  await expect(page.locator('#btn-add')).toBeFocused();
});

test('Enter and Escape in an inline edit return focus to its pencil', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  const pen = page.locator('#ie-name .pe');
  await pen.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#f-lbl')).toBeFocused();
  await page.keyboard.type('Delta');
  await page.keyboard.press('Enter');
  await expect(pen).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(pen).toBeFocused();
});

test('a widget size tile and the type picker keep focus after the form redraws', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await page.locator('.tile-opt[data-ctype="widget"]').click();
  const small = page.locator('#ev-body .tile-opt[data-size="small"]');
  await small.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ev-body .tile-opt[data-size="small"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ev-body .tile-opt[data-size="small"]')).toBeFocused();

  await page.locator('#f-wtype-btn').click();
  await page.locator('#f-wtype-list li[role="option"]:not([aria-selected="true"])').first().click();
  await expect(page.locator('#f-wtype-btn')).toBeFocused();
});

test('header rows and activity labels keep focus when added, moved or removed', async ({ page, request }) => {
  await seedConfig(request, {
    items: [
      {
        ...app('svc', 'Service'),
        monitoring: { activity: { enabled: true, url: 'http://svc.invalid/api', interval: 30 } },
      },
    ],
  });
  await page.route('**/api/badge-proxy', route =>
    route.fulfill({
      json: {
        numbers: [
          { path: 'a', label: 'a', value: 1 },
          { path: 'b', label: 'b', value: 2 },
        ],
      },
    }),
  );
  await openDashboardList(page);
  await rowByName(page, 'Service').getByRole('button', { name: /^Edit/ }).click();
  await page.locator('#bfetch').click();
  await expect(page.locator('#act-labels .albl-hdr')).toHaveCount(1);

  await page.locator('#auth-en').evaluate(e => e.click());
  await page.locator('#bhdr-rows .kv-add').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bhdr-rows .kv-row .kv-k').last()).toBeFocused();
  await page.locator('#bhdr-rows .kv-del').last().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bhdr-rows .kv-row')).toHaveCount(0);
  await expect(page.locator('#bhdr-rows .kv-add')).toBeFocused();

  await page.locator('#act-add-label').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#act-labels .albl-hdr')).toHaveCount(2);
  await page.locator('#act-labels .albl-hdr[data-idx="0"] .albl-move').nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#act-labels .albl-hdr[data-idx="1"] .albl-move').nth(0)).toBeFocused();

  await page.locator('#act-labels .albl-hdr[data-idx="1"] .grp-hdr-rm').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#act-labels .albl-hdr')).toHaveCount(1);
  await expect(page.locator('#act-labels .albl-hdr[data-idx="0"] .grp-hdr-rm')).toBeFocused();
});
