// @ts-check

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, widgetFramesLoaded } = require('./helpers');
const { helpers: demo } = require('../api/src/demo-data');

const WIDGETS = path.join(__dirname, '..', 'ui', 'widgets');

/* A reply in the shape each data.js returns, for the widgets without a demo.js
   or with one that covers a single view. */
const REPLIES = {
  'clock/*': null,
  'dashboard-switch/*': null,
  'connections/map': {
    services: [{ id: 'site', name: 'Site', color: '#BF5AF2', kind: 'regions', regions: { FR: 3, US: 5, JP: 1 } }],
  },
  'connections/vpn': { connected: true, service: 'gluetun', city: 'Oslo', country: 'Norway', countryCode: 'NO' },
  'disk-health/*': {
    provider: 'scrutiny',
    bays: [{ device_id: 'sda', device_name: 'sda', device_status: 0, hasSmart: true, model_name: 'Disk A', temp: 34 }],
  },
  'github/prs': {
    view: 'prs',
    totalCount: 1,
    filters: ['author'],
    allUrl: 'https://github.com/pulls',
    items: [{ number: 7, title: 'Fix the build', repo: 'owner/repo', url: 'https://github.com/owner/repo/pull/7' }],
  },
  'system-summary/*': {
    cpu: 50,
    procs: 300,
    disks: [{ mount: '/', usedPct: 50, totalGb: 467 }],
    history: { cpu: [10, 20, 30], procs: [290, 300, 310] },
  },
};

const CONFIG = {
  backup: { slots: [{ provider: 'duplicati', customName: 'Documents' }] },
  'system-summary': {
    statProvider: 'system',
    slots: [{ type: 'cpu' }, { type: 'procs' }, { type: 'disk', primary: '/' }],
  },
  weather: { city: 'Oslo, Norway', lat: 59.91, lon: 10.75 },
};

function cases() {
  const out = [];
  for (const name of fs.readdirSync(WIDGETS).sort()) {
    const file = path.join(WIDGETS, name, 'widget.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const views = m.views ? Object.entries(m.views) : [['*', { src: 'index.html' }]];
    for (const [view, v] of views) {
      const size = (v.sizes || m.sizes)[0];
      const config = { ...(CONFIG[name] || {}), ...(m.viewField ? { [m.viewField]: view } : {}) };
      out.push({ name, view, page: v.src, size, config });
    }
  }
  return out;
}

/** @param {{ name: string, view: string, config: object }} c */
async function replyFor(c) {
  for (const key of [`${c.name}/${c.view}`, `${c.name}/*`]) if (key in REPLIES) return REPLIES[key];
  const demoFile = path.join(WIDGETS, c.name, 'demo.js');
  if (!fs.existsSync(demoFile)) throw new Error(`${c.name}/${c.view} has no reply for this spec; add one to REPLIES`);
  return require(demoFile)({ config: c.config, demo, endpoint: '' });
}

function recordViolations() {
  /** @type {any} */ (window).__violations = [];
  document.addEventListener('securitypolicyviolation', e => {
    /** @type {any} */ (window).__violations.push(
      `${location.pathname} ${e.disposition} ${e.effectiveDirective} ${e.blockedURI} ${e.sample}`,
    );
  });
}

const VIOLATION_MESSAGE = /Refused to|TrustedHTML|TrustedScript|Trusted Type|Content Security Policy/i;

test.use({ reducedMotion: 'reduce' });

const all = cases();

test('the spec covers every widget page', () => {
  const pages = new Set(all.map(c => `${c.name}/${c.page}`));
  for (const name of fs.readdirSync(WIDGETS)) {
    if (!fs.existsSync(path.join(WIDGETS, name, 'widget.json'))) continue;
    for (const f of fs.readdirSync(path.join(WIDGETS, name)).filter(n => n.endsWith('.html'))) {
      expect(pages.has(`${name}/${f}`), `${name}/${f} is not a view of its widget`).toBe(true);
    }
  }
});

for (const c of all) {
  test(`${c.name} ${c.view === '*' ? c.page : `${c.view} view`} runs clean under the next policy`, async ({
    page,
    request,
  }) => {
    const id = `csp-${c.name}-${c.view === '*' ? 'main' : c.view}`;
    await seedConfig(request, {
      items: [
        {
          id,
          type: 'widget',
          label: c.name,
          widgetType: c.name,
          widgetSize: c.size,
          widgetConfig: c.config,
        },
      ],
    });
    await dismissSetupPrompt(request);

    const reply = await replyFor(c);
    let answered = 0;
    await page.route('**/api/badges', r => r.fulfill({ json: {} }));
    await page.route('**/api/health', r => r.fulfill({ json: {} }));
    await page.route(`**/api/widget-data/${id}*`, r => {
      answered++;
      return r.fulfill({ json: reply });
    });

    const messages = [];
    page.on('console', msg => {
      if (VIOLATION_MESSAGE.test(msg.text())) messages.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', e => messages.push(`pageerror: ${e.message}`));
    await page.addInitScript(recordViolations);

    await page.goto('/');
    await widgetFramesLoaded(page);
    const frame = page.frames().find(f => f.url().includes(`/widgets/${c.name}/${c.page}`));
    expect(frame, `no frame loaded /widgets/${c.name}/${c.page}`).toBeTruthy();
    if (!frame) return;
    if (reply !== null)
      await expect.poll(() => answered, { message: 'the widget never asked for its data' }).toBeGreaterThan(0);
    await page.waitForTimeout(1000);

    const failed = await frame.evaluate(() =>
      [...document.querySelectorAll('.wt-cap')].some(
        el => !(/** @type {HTMLElement} */ (el).hidden) && el.querySelector('svg'),
      ),
    );
    expect(failed, 'the widget shows its failure state').toBe(false);
    const drawn = await frame.evaluate(() =>
      [...document.body.querySelectorAll('*')].some(el => {
        if (el.closest('script, style')) return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (!!el.textContent?.trim() || /^(svg|canvas|img)$/i.test(el.tagName));
      }),
    );
    expect(drawn, 'the widget drew nothing').toBe(true);

    const violations = [];
    for (const f of page.frames())
      violations.push(...(await f.evaluate(() => /** @type {any} */ (window).__violations || []).catch(() => [])));
    expect(violations, 'a policy violation was reported').toEqual([]);
    expect(messages, 'the console reported a policy violation or an error').toEqual([]);
  });
}
