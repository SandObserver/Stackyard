/* Regression tests for the shared CSP include (P16-3).

   The default Content-Security-Policy used to be repeated verbatim at nine
   sites in nginx/dashboard.conf. A one-line policy change therefore meant a
   nine-place edit, and nothing caught a site that was missed. These tests pin
   the include, and pin the two locations that deliberately differ.

   They read the config as text rather than running nginx, so they work in CI
   without an nginx binary. `nginx -t` against the built image is the separate
   chore/nginx-config-test branch; it catches syntax, this catches drift. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const NGINX_DIR = path.join(__dirname, '../../nginx');
const read = f => fs.readFileSync(path.join(NGINX_DIR, f), 'utf8');

const dashboard = read('dashboard.conf');
const cspDefault = read('csp-default.conf');
const INCLUDE = 'include /etc/nginx/http.d/csp-default.conf;';

/* The policy text, taken from the include rather than restated here. Restating
   it would mean this file becomes a tenth copy to keep in sync. */
const policy = (cspDefault.match(/add_header Content-Security-Policy "([^"]+)"/) || [])[1];

test('csp-default.conf declares exactly one Content-Security-Policy header', () => {
  assert.ok(policy, 'no Content-Security-Policy header found in csp-default.conf');
  const directives = cspDefault.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  assert.equal(directives.length, 1,
    'csp-default.conf must hold the one header and nothing else');
  assert.match(directives[0], /^add_header Content-Security-Policy /);
});

test('the default policy is not repeated anywhere in dashboard.conf', () => {
  assert.ok(!dashboard.includes(policy),
    'the default policy is inlined somewhere; include csp-default.conf instead');
});

test('every location that sets a CSP either includes the default or is a known exception', () => {
  /* Locations that state their own policy. Both are intentional and documented
     in csp-default.conf; adding a third should be a deliberate decision, so it
     fails here until this list is updated. */
  const EXCEPTIONS = ['^~ /admin', '^~ /widgets/'];

  const inline = [...dashboard.matchAll(/add_header Content-Security-Policy/g)];
  assert.equal(inline.length, EXCEPTIONS.length,
    `expected ${EXCEPTIONS.length} inline CSP headers, found ${inline.length}`);

  for (const name of EXCEPTIONS) {
    const at = dashboard.indexOf(`location ${name} {`);
    assert.ok(at !== -1, `location ${name} not found`);
    const block = dashboard.slice(at, dashboard.indexOf('\n    }', at));
    assert.match(block, /add_header Content-Security-Policy/, `${name} should set its own policy`);
    assert.ok(!block.includes(INCLUDE), `${name} should not also include the default`);
  }
});

test('the two exception policies stay distinct from the default', () => {
  const others = [...dashboard.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map(m => m[1]);
  for (const p of others) assert.notEqual(p, policy, 'an exception drifted into the default policy');
  assert.equal(new Set(others).size, others.length, 'the two exception policies are identical to each other');
});

test('the include is used, and every use points at the same path', () => {
  const uses = (dashboard.match(/include \/etc\/nginx\/http\.d\/csp-default\.conf;/g) || []).length;
  assert.ok(uses >= 8, `expected the include at 8 or more sites, found ${uses}`);
});

test('the Dockerfile ships every nginx config file', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '../../Dockerfile'), 'utf8');
  for (const f of fs.readdirSync(NGINX_DIR).filter(f => f.endsWith('.conf'))) {
    assert.match(dockerfile, new RegExp(`COPY nginx/${f.replace('.', '\\.')} `),
      `nginx/${f} is not copied into the image, so the include would fail at runtime`);
  }
});

/* ── frame-ancestors (P14-2) ──────────────────────────────────────────────── */

/* /widgets/ deliberately clears X-Frame-Options so the dashboard can embed
   widgets, but nothing replaced it, so widget pages could be framed by any
   origin. They are the only pages allowed inline script, and they have clickable
   elements, so the exposure is clickjacking. The session cookie is
   SameSite=Strict, so a foreign frame carries no credentials.

   Every policy states frame-ancestors now, not only the one that was missing it.
   X-Frame-Options already enforced the same thing on the others, but it is
   obsolete and unspecified, so a location that omits it in future would
   otherwise have no framing policy at all. That is exactly how this gap
   appeared. */

function policyFor(location) {
  const at = dashboard.indexOf(`location ${location} {`);
  assert.ok(at !== -1, `location ${location} not found`);
  const block = dashboard.slice(at, dashboard.indexOf('\n    }', at));
  const m = block.match(/add_header Content-Security-Policy "([^"]+)"/);
  assert.ok(m, `${location} has no inline Content-Security-Policy`);
  return m[1];
}

test('widget pages restrict who may frame them', () => {
  assert.match(policyFor('^~ /widgets/'), /frame-ancestors 'self'/);
});

test('widgets still clear X-Frame-Options, so frame-ancestors is the only guard', () => {
  const at = dashboard.indexOf('location ^~ /widgets/ {');
  const block = dashboard.slice(at, dashboard.indexOf('\n    }', at));
  assert.match(block, /add_header X-Frame-Options "" always;/,
    'if this stops being cleared, the dashboard cannot embed widgets');
});

test('admin refuses framing entirely, matching its X-Frame-Options DENY', () => {
  assert.match(policyFor('^~ /admin'), /frame-ancestors 'none'/);
  const at = dashboard.indexOf('location ^~ /admin {');
  const block = dashboard.slice(at, dashboard.indexOf('\n    }', at));
  assert.match(block, /X-Frame-Options "DENY"/, 'the two headers must not disagree');
});

test('the default policy restricts framing to same origin', () => {
  assert.match(policy, /frame-ancestors 'self'/);
});

test('every policy in the config states a frame-ancestors', () => {
  const all = [...dashboard.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map(m => m[1]);
  all.push(policy);
  for (const p of all) {
    assert.match(p, /frame-ancestors /, `a policy without frame-ancestors: ${p.slice(0, 60)}...`);
  }
});
