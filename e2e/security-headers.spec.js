// @ts-check
const { test, expect } = require('@playwright/test');

const PATHS = [
  '/',
  '/admin/',
  '/manifest.json',
  '/favicon.ico',
  '/js/admin-auth.js',
  '/css/admin.css',
  '/i18n/en.json',
  '/widgets/clock/analog.html',
  '/icons/no-such-icon.svg',
  '/api/config',
  '/api/auth/check',
  '/health',
  '/no-such-page',
];

test.skip(({ browserName }) => browserName !== 'chromium', 'the headers do not depend on the browser');

for (const url of PATHS) {
  test(`${url} carries the security headers`, async ({ request }) => {
    const res = await request.get(url, { maxRedirects: 0 });
    const headers = res.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
  });
}
