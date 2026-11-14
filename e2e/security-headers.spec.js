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
    expect(headers['referrer-policy']).toBe('same-origin');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    expect(headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), payment=(), display-capture=()',
    );
    if (url.startsWith('/api/')) expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  });
}

test('a widget page refuses plugins and form submissions', async ({ request }) => {
  const res = await request.get('/widgets/clock/analog.html');
  const csp = (res.headers()['content-security-policy'] || '').split(';').map(d => d.trim());
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("form-action 'none'");
  expect(csp).toContain("base-uri 'self'");
});
