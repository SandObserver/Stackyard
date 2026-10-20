#!/usr/bin/env node

const fs = require('node:fs');
const { chromium } = require('@playwright/test');

const VIEWS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'desktop-light', viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'narrow', viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true },
  { name: 'rtl', viewport: { width: 1440, height: 900 }, locale: 'fa-IR' },
];
const CHECKED_HEADERS = [
  'content-security-policy',
  'x-frame-options',
  'cache-control',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];

async function run(origin) {
  const browser = await chromium.launch();
  const exchanges = [];
  const problems = [];
  const errors = new Set();
  const outcomes = new Set();
  const widgetPages = new Set();
  let changed = false;

  const open = async view => {
    const ctx = await browser.newContext(view);
    ctx.on('response', async r => {
      const u = new URL(r.url());
      if (u.origin !== origin) return;
      if (u.pathname.startsWith('/api/')) {
        const body = await r.text().catch(() => '');
        exchanges.push({ method: r.request().method(), path: u.pathname + u.search, status: r.status(), body });
      } else if (r.status() >= 400) {
        problems.push(`${view.name}: ${r.status()} ${u.pathname}`);
      }
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(30_000);
    page.on('pageerror', e => errors.add(`page error: ${e.message}`));
    page.on('console', m => {
      if (m.text().startsWith('[demo-replay]')) problems.push(`${view.name}: ${m.text()}`);
      else if (m.type() === 'error') errors.add(`console: ${m.text()}`);
    });
    return { ctx, page };
  };

  for (const view of VIEWS) {
    const { ctx, page } = await open(view);
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    for (const frame of page.frames()) {
      const u = new URL(frame.url(), origin);
      if (u.pathname.startsWith('/widgets/')) widgetPages.add(u.pathname + u.search);
    }
    const before = await widgetText(page);
    await page.waitForTimeout(25_000);
    if ((await widgetText(page)) !== before) changed = true;
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) problems.push(`${view.name}: the dashboard scrolls sideways by ${overflow}px`);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1500);
    await page.keyboard.press('ArrowLeft');
    await page.mouse.click(5, 5);
    await page.keyboard.type('a');
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await ctx.close();
  }

  for (const view of [VIEWS[0], VIEWS[3]]) {
    const { ctx, page } = await open(view);
    await page.goto(`${origin}/admin`, { waitUntil: 'networkidle' });
    for (const sec of ['general', 'appearance', 'about', 'dashboard']) {
      await page
        .locator(`[data-sec="${sec}"]:visible`)
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(500);
    }
    const edits = page.locator('#sec-dashboard button:text-is("Edit")');
    const n = await edits.count();
    for (let i = 0; i < n; i++) {
      await edits
        .nth(i)
        .click()
        .catch(() => {});
      await page.waitForTimeout(700);
      await page
        .locator('button:has-text("Save"):visible')
        .first()
        .click()
        .catch(() => {});
      outcomes.add(`${view.name}: save: ${await toastText(page)}`);
      await page
        .locator('button:has-text("Back"):visible')
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(300);
    }
    await page
      .locator('#btn-add')
      .click()
      .catch(() => {});
    await page
      .locator('#ip-in')
      .fill('jellyfin')
      .catch(() => {});
    await page.waitForTimeout(1500);
    await page
      .locator('#hc-en')
      .evaluate(e => /** @type {HTMLElement} */ (e).click())
      .catch(() => {});
    await page
      .locator('#hc-type-ping')
      .evaluate(e => /** @type {HTMLElement} */ (e).click())
      .catch(() => {});
    await page.evaluate(() => {
      const input = /** @type {HTMLInputElement|null} */ (document.getElementById('hc-ping'));
      if (input) input.value = 'https://example.com';
    });
    await page
      .locator('#hc-ping-test')
      .evaluate(e => /** @type {HTMLElement} */ (e).click())
      .catch(() => {});
    await page.waitForTimeout(2500);
    outcomes.add(
      `${view.name}: test: ${await page
        .locator('#hc-ping-status')
        .innerText()
        .catch(() => '')}`,
    );
    await page.goto(`${origin}/admin`, { waitUntil: 'networkidle' });
    await page
      .locator('[data-sec="general"]:visible')
      .first()
      .click()
      .catch(() => {});
    const download = page.waitForEvent('download', { timeout: 5000 }).then(
      d => `download ${d.suggestedFilename()}`,
      () => 'no download',
    );
    await page
      .locator('#btn-exp')
      .click({ force: true })
      .catch(() => {});
    outcomes.add(`${view.name}: export: ${await download}`);
    await ctx.close();
  }

  await browser.close();
  return {
    exchanges,
    problems,
    errors: [...errors].sort(),
    outcomes: [...outcomes].sort(),
    widgetPages: [...widgetPages].sort(),
    changed,
  };
}

/** @param {import('@playwright/test').Page} page */
async function toastText(page) {
  await page
    .waitForFunction(() => document.getElementById('toast')?.textContent?.trim(), null, { timeout: 3000 })
    .catch(() => {});
  const text = await page.evaluate(() => document.getElementById('toast')?.textContent?.trim() || '');
  await page.evaluate(() => {
    const toast = document.getElementById('toast');
    if (toast) toast.textContent = '';
  });
  return text;
}

/** @param {import('@playwright/test').Page} page */
async function widgetText(page) {
  const texts = [];
  for (const frame of page.frames().filter(x => x !== page.mainFrame())) {
    texts.push(await frame.evaluate(() => document.body?.innerText || '').catch(() => ''));
  }
  return texts.join('\n');
}

async function checkHeaders(origin, recording) {
  const problems = [];
  const targets = { ...recording.headers.files, ...recording.headers.routes };
  for (const [target, want] of Object.entries(targets)) {
    const r = await fetch(origin + target, { method: 'HEAD', redirect: 'manual' });
    if (r.status !== 200) {
      problems.push(`${target}: ${r.status}`);
      continue;
    }
    for (const n of CHECKED_HEADERS) {
      const got = r.headers.get(n) ?? undefined;
      if (got !== want[n]) problems.push(`${target}: ${n} is ${got}, the image sends ${want[n]}`);
    }
  }
  return problems;
}

async function main() {
  const [mode, origin, tourFile, recordingFile] = process.argv.slice(2);
  if (mode === 'discover' && tourFile) {
    const result = await run(origin);
    if (!result.changed) throw new Error('no widget changed in 25 seconds on the container');
    if (result.outcomes.some(o => o.endsWith(': ') || o.endsWith('no download'))) {
      throw new Error(`the container showed no result for an action:\n${result.outcomes.join('\n')}`);
    }
    fs.writeFileSync(
      tourFile,
      JSON.stringify({
        exchanges: result.exchanges,
        errors: result.errors,
        outcomes: result.outcomes,
        widgetPages: result.widgetPages,
      }),
    );
    console.log(`${result.exchanges.length} API exchanges, ${result.errors.length} console errors on the container`);
    console.log(result.outcomes.join('\n'));
    return;
  }
  if (mode === 'verify' && recordingFile) {
    const container = JSON.parse(fs.readFileSync(tourFile, 'utf8'));
    const baseline = new Set(container.errors);
    const result = await run(origin);
    const problems = [...result.problems];
    for (const e of result.errors) if (!baseline.has(e)) problems.push(e);
    const seen = new Set(result.outcomes);
    for (const o of container.outcomes)
      if (!seen.has(o)) problems.push(`the container showed "${o}", the static demo did not`);
    for (const o of result.outcomes)
      if (!container.outcomes.includes(o)) problems.push(`the static demo showed "${o}"`);
    if (!result.widgetPages.length) problems.push('the static demo loaded no widget page');
    for (const p of result.widgetPages) {
      if (container.widgetPages.includes(p)) {
        problems.push(`${p} is the image's address, so a browser that saw the image keeps its cached page`);
      }
    }
    if (!result.changed) problems.push('no widget changed in 25 seconds');
    problems.push(...(await checkHeaders(origin, JSON.parse(fs.readFileSync(recordingFile, 'utf8')))));
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    console.log('The static demo matches the container.');
    return;
  }
  console.error('usage: tour.js discover <origin> <tour.json> | verify <origin> <tour.json> <recording.json>');
  process.exit(2);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
