// @ts-check
/* Sign-in through the shipped nginx, on its own container. The container trusts
   this runner as its front proxy, so a request can name its client address in
   X-Forwarded-For. */

const { test, expect } = require('@playwright/test');
const { AUTH_BASE_URL, PASSWORD } = require('./base-url');
const { someClient } = require('./helpers');
const { LOGIN_MAX, SESSION_MAX_AGE_MS } = require('../api/src/auth');
const { AUTH_BODY_LIMIT } = require('../api/src/router');

/** @param {import('@playwright/test').APIRequestContext} request @param {unknown} password
    @param {Record<string, string>} [headers] */
const login = (request, password, headers = {}) =>
  request.post('/api/auth/login', { data: { password }, headers: { Origin: AUTH_BASE_URL, ...headers } });

/** @param {import('@playwright/test').Page} page */
async function signIn(page) {
  await page.goto('/admin/');
  await expect(page.locator('#login-pw')).toBeFocused();
  await page.locator('#login-pw').fill(PASSWORD);
  await page.locator('#login-btn').click();
  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('body.authed')).toBeAttached();
}

test('the sign-in screen signs in with a cookie scripts cannot read', async ({ page }) => {
  await signIn(page);
  const cookie = (await page.context().cookies()).find(c => c.name === 'ds');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', secure: false, path: '/' });
  const left = (cookie?.expires ?? 0) - Date.now() / 1000;
  expect(Math.abs(left - SESSION_MAX_AGE_MS / 1000)).toBeLessThan(120);
  expect(await page.evaluate(() => document.cookie)).not.toContain('ds=');
});

test('a wrong password shows its message, and the right one still signs in', async ({ page }) => {
  await page.goto('/admin/');
  await page.locator('#login-pw').fill(`${PASSWORD}x`);
  await page.locator('#login-btn').click();
  await expect(page.locator('#login-err')).toHaveText('Incorrect password.');
  await expect(page.locator('#login-pw')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#login-pw').fill(PASSWORD);
  await page.locator('#login-btn').click();
  await expect(page.locator('body.authed')).toBeAttached();
});

test('the cookie is Secure only when the trusted proxy forwarded https', async ({ request }) => {
  const viaProxy = await login(request, PASSWORD, { 'X-Forwarded-For': someClient(), 'X-Forwarded-Proto': 'https' });
  expect(viaProxy.status()).toBe(200);
  expect(viaProxy.headers()['set-cookie']).toMatch(/;\s*Secure;/);

  const direct = await login(request, PASSWORD, { 'X-Forwarded-Proto': 'https' });
  expect(direct.status()).toBe(200);
  expect(direct.headers()['set-cookie']).toMatch(/^ds=[^;]+; HttpOnly; SameSite=Strict;/);
});

test('wrong passwords lock out the client address nginx resolved, and only that one', async ({ request }) => {
  const client = someClient();
  for (let i = 0; i < LOGIN_MAX; i++) {
    const res = await login(request, 'wrong', { 'X-Forwarded-For': client });
    expect(res.status(), `attempt ${i + 1}`).toBe(401);
  }
  const locked = await login(request, PASSWORD, { 'X-Forwarded-For': client });
  expect(locked.status()).toBe(429);
  expect((await locked.json()).code).toBe('blocked.rate-limit');

  const spoofed = await login(request, PASSWORD, { 'X-Forwarded-For': client, 'X-Real-IP': someClient() });
  expect(spoofed.status(), 'nginx must replace X-Real-IP').toBe(429);

  const other = await login(request, PASSWORD, { 'X-Forwarded-For': someClient() });
  expect(other.status()).toBe(200);
});

test('nginx refuses a sign-in body over the limit the API reads', async ({ request }) => {
  const body = size => {
    const shell = JSON.stringify({ password: '' });
    return JSON.stringify({ password: 'x'.repeat(size - shell.length) });
  };
  const send = size =>
    request.post('/api/auth/login', {
      data: body(size),
      headers: { Origin: AUTH_BASE_URL, 'Content-Type': 'application/json', 'X-Forwarded-For': someClient() },
    });

  const over = await send(AUTH_BODY_LIMIT + 1);
  expect(over.status()).toBe(413);
  expect(await over.json()).toMatchObject({ code: 'invalid.too-large' });

  const at = await send(AUTH_BODY_LIMIT);
  expect(at.status()).toBe(401);
});

test('Sign out ends the session on the server, not only in the browser', async ({ page, request }) => {
  await signIn(page);
  const token = (await page.context().cookies()).find(c => c.name === 'ds')?.value;
  const withOld = () => request.get('/api/config', { headers: { Cookie: `ds=${token}` } });
  expect((await withOld()).status()).toBe(200);

  await page.locator('.nl[data-sec="general"]').click();
  await page.locator('#sec-logout').click();
  await expect(page.locator('#login-pw')).toBeFocused();
  expect((await page.context().cookies()).find(c => c.name === 'ds')).toBeUndefined();
  expect((await withOld()).status()).toBe(401);
});
