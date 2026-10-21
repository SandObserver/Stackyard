// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, readConfig, saveEditor, app, openDashboardList, rowByName } = require('./helpers');

const docked = (id, label) => ({ ...app(id, label), dock: true });

/** Names in one list group, in order. @param {'dock'|'home'} group */
function groupNames(page, group) {
  return page.locator(`#al .grp[data-group="${group}"] > .drow .rnm`).allTextContents();
}

function waitForSave(page) {
  return page.waitForResponse(r => r.url().includes('/api/config') && r.request().method() === 'POST');
}

async function dragRow(from, to, where = 'above') {
  const box = await to.boundingBox();
  if (!box) throw new Error('drop target has no box');
  await from.dragTo(to, { targetPosition: { x: box.width / 2, y: where === 'above' ? 4 : box.height - 4 } });
}

/** Ids of the docked items the server holds, in order. */
/** Flip a switch the way a person does. The checkbox itself is drawn hidden. */
function flip(page, id) {
  return page.locator(`label.tog:has(#${id})`).click();
}

async function savedDock(request) {
  return (await readConfig(request)).items.filter(i => i.dock).map(i => i.id);
}

test('docked apps are listed in the Dock group, everything else under Home screen', async ({ page, request }) => {
  await seedConfig(request, {
    items: [app('alpha', 'Alpha'), docked('dee', 'Dee'), app('bravo', 'Bravo'), docked('eff', 'Eff')],
  });
  await openDashboardList(page);
  expect(await groupNames(page, 'dock')).toEqual(['Dee', 'Eff']);
  expect(await groupNames(page, 'home')).toEqual(['Alpha', 'Bravo', 'Settings']);
  await expect(page.locator('#al .al-count')).toHaveText('2/4');
  await expect(page.locator('#al .p-dk')).toHaveCount(0);
});

test('dragging an app onto a dock row docks it at that place', async ({ page, request }) => {
  await seedConfig(request, { items: [docked('dee', 'Dee'), docked('eff', 'Eff'), app('alpha', 'Alpha')] });
  await openDashboardList(page);
  const saved = waitForSave(page);
  await dragRow(rowByName(page, 'Alpha'), rowByName(page, 'Eff'), 'above');
  expect((await saved).status()).toBe(200);
  expect(await groupNames(page, 'dock')).toEqual(['Dee', 'Alpha', 'Eff']);
  expect(await savedDock(request)).toEqual(['dee', 'alpha', 'eff']);
});

test('dragging a docked app onto a home row undocks it', async ({ page, request }) => {
  await seedConfig(request, { items: [docked('dee', 'Dee'), app('alpha', 'Alpha'), app('bravo', 'Bravo')] });
  await openDashboardList(page);
  const saved = waitForSave(page);
  await dragRow(rowByName(page, 'Dee'), rowByName(page, 'Bravo'), 'above');
  expect((await saved).status()).toBe(200);
  expect(await groupNames(page, 'home')).toEqual(['Alpha', 'Dee', 'Bravo', 'Settings']);
  expect(await savedDock(request)).toEqual([]);
  await expect(page.locator('#al .al-dock-empty')).toBeVisible();
});

test('dragging inside the dock reorders it', async ({ page, request }) => {
  await seedConfig(request, { items: [docked('dee', 'Dee'), docked('eff', 'Eff'), docked('gee', 'Gee')] });
  await openDashboardList(page);
  const saved = waitForSave(page);
  await dragRow(rowByName(page, 'Gee'), rowByName(page, 'Dee'), 'above');
  await saved;
  expect(await savedDock(request)).toEqual(['gee', 'dee', 'eff']);
});

test('a full dock refuses a fifth app and says why', async ({ page, request }) => {
  const four = ['d1', 'd2', 'd3', 'd4'].map(id => docked(id, id.toUpperCase()));
  await seedConfig(request, { items: [...four, app('alpha', 'Alpha')] });
  await openDashboardList(page);
  const before = await readConfig(request);
  let posted = false;
  page.on('request', r => {
    if (r.url().includes('/api/config') && r.method() === 'POST') posted = true;
  });
  await dragRow(rowByName(page, 'Alpha'), rowByName(page, 'D2'), 'above');
  await expect(page.locator('#toast')).toHaveText('Dock full (4/4). Remove an app first.');
  expect(posted).toBe(false);
  expect((await readConfig(request)).items).toEqual(before.items);
});

test('the empty dock is a drop target', async ({ page, request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha'), app('bravo', 'Bravo')] });
  await openDashboardList(page);
  const zone = page.locator('#al .al-dock-empty');
  await expect(zone).toHaveText('Drag an app here, or open it and turn on Show in Dock.');
  const saved = waitForSave(page);
  await rowByName(page, 'Bravo').dragTo(zone);
  await saved;
  expect(await groupNames(page, 'dock')).toEqual(['Bravo']);
  expect(await savedDock(request)).toEqual(['bravo']);
  await expect(zone).toHaveCount(0);
});

test('a widget or folder never joins the dock', async ({ page, request }) => {
  await seedConfig(request, {
    items: [
      docked('dee', 'Dee'),
      { id: 'clk', type: 'widget', label: 'Clock', widgetType: 'clock', widgetSize: 'small' },
      { id: 'box', type: 'folder', label: 'Box', children: [] },
    ],
  });
  await openDashboardList(page);
  const before = await readConfig(request);
  for (const name of ['Clock', 'Box']) {
    await dragRow(rowByName(page, name), rowByName(page, 'Dee'), 'above');
  }
  await expect(page.locator('#toast')).not.toHaveText(/Dock full/);
  expect(await groupNames(page, 'dock')).toEqual(['Dee']);
  expect((await readConfig(request)).items).toEqual(before.items);
});

test('an app dragged out of a folder into the dock leaves the folder', async ({ page, request }) => {
  await seedConfig(request, {
    items: [
      docked('dee', 'Dee'),
      { id: 'box', type: 'folder', label: 'Box', children: ['alpha'] },
      app('alpha', 'Alpha'),
    ],
  });
  await openDashboardList(page);
  await rowByName(page, 'Box').locator('.rnm').click();
  await expect(rowByName(page, 'Alpha')).toHaveAttribute('data-indent', '1');
  const saved = waitForSave(page);
  await dragRow(rowByName(page, 'Alpha'), rowByName(page, 'Dee'), 'below');
  await saved;
  const cfg = await readConfig(request);
  expect(cfg.items.find(i => i.id === 'box').children).toEqual([]);
  expect(await savedDock(request)).toEqual(['dee', 'alpha']);
});

test('the move buttons stay inside a group', async ({ page, request }) => {
  await seedConfig(request, { items: [docked('dee', 'Dee'), app('alpha', 'Alpha'), docked('eff', 'Eff')] });
  await openDashboardList(page);
  await expect(rowByName(page, 'Eff').getByRole('button', { name: 'Move down: Eff' })).toBeDisabled();
  await expect(rowByName(page, 'Alpha').getByRole('button', { name: 'Move up: Alpha' })).toBeDisabled();
  const saved = waitForSave(page);
  await rowByName(page, 'Eff').getByRole('button', { name: 'Move up: Eff' }).click();
  await saved;
  expect(await savedDock(request)).toEqual(['eff', 'dee']);
  expect(await groupNames(page, 'home')).toEqual(['Alpha', 'Settings']);
});

test('Settings goes into the dock from its editor', async ({ page, request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha')] });
  await openDashboardList(page);
  await rowByName(page, 'Settings').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#ev-delete')).toBeHidden();
  const dock = page.locator('#f-dock');
  const shown = page.locator('#f-shown');
  await expect(shown).toBeChecked();
  await expect(dock).not.toBeChecked();
  await flip(page, 'f-dock');
  await expect(dock).toBeChecked();
  await saveEditor(page);
  expect(await groupNames(page, 'dock')).toEqual(['Settings']);
  const s = (await readConfig(request)).items.find(i => i.system === 'settings');
  expect(s.dock).toBe(true);
  expect(s.hidden).toBeUndefined();
});

test('Settings can be hidden and shown again from its editor', async ({ page, request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha')] });
  await openDashboardList(page);
  await rowByName(page, 'Settings').getByRole('button', { name: 'Edit' }).click();
  await flip(page, 'f-shown');
  await saveEditor(page);
  await expect(rowByName(page, 'Settings').locator('.p-hd')).toBeVisible();
  expect((await readConfig(request)).items.find(i => i.system === 'settings').hidden).toBe(true);

  await rowByName(page, 'Settings').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#f-shown')).not.toBeChecked();
  await flip(page, 'f-shown');
  await saveEditor(page);
  expect((await readConfig(request)).items.find(i => i.system === 'settings').hidden).toBeUndefined();
});

test('Settings cannot join a full dock from its editor', async ({ page, request }) => {
  const four = ['d1', 'd2', 'd3', 'd4'].map(id => docked(id, id.toUpperCase()));
  await seedConfig(request, { items: four });
  await openDashboardList(page);
  await rowByName(page, 'Settings').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#dock-full-tip')).toBeVisible();
  await expect(page.locator('#f-dock')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('label.tog:has(#f-dock)').click({ force: true });
  await expect(page.locator('#f-dock')).not.toBeChecked();
});

test('docking an app from its editor takes it out of its folder', async ({ page, request }) => {
  await seedConfig(request, {
    items: [{ id: 'box', type: 'folder', label: 'Box', children: ['alpha'] }, app('alpha', 'Alpha')],
  });
  await openDashboardList(page);
  await rowByName(page, 'Box').locator('.rnm').click();
  await rowByName(page, 'Alpha').getByRole('button', { name: 'Edit' }).click();
  await flip(page, 'f-dock');
  await saveEditor(page);
  const cfg = await readConfig(request);
  expect(cfg.items.find(i => i.id === 'box').children).toEqual([]);
  expect(await savedDock(request)).toEqual(['alpha']);
  expect(await groupNames(page, 'dock')).toEqual(['Alpha']);
});
