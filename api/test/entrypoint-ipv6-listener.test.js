/* The IPv6 listener is rendered at container start, not baked into the image.

   Some platforms reach the container only over IPv6, so nginx must bind [::]:80
   as well as the IPv4 listener in dashboard.conf. Binding it unconditionally is
   not an option: nginx exits when it cannot bind, and a container without IPv6
   would serve nothing at all.

   nginx is stood in for here. What is being tested is which listener the
   entrypoint renders for a given container, not nginx's parser. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { tmpDir } = require('../test-support/tmp');

const ENTRYPOINT = path.join(__dirname, '../../docker-entrypoint.sh');
const DASHBOARD_CONF = path.join(__dirname, '../../nginx/dashboard.conf');

/* @returns {{ status: number, listen: string }} */
function run({ inet6 = null } = {}) {
  const dir = tmpDir('entrypoint-ipv6');
  const listen = path.join(dir, 'listen-ipv6.inc');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);

  const stub = (name, body) => {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
    return p;
  };
  stub('nginx', 'exit 0');
  const handoff = stub('handoff', 'true');

  /* A container without IPv6 has no /proc/net/if_inet6 at all; one with IPv6
     disabled at runtime can have it present but empty. Both must read as no. */
  let inet6Path = path.join(dir, 'absent');
  if (inet6 !== null) {
    inet6Path = path.join(dir, 'if_inet6');
    fs.writeFileSync(inet6Path, inet6);
  }

  let status = 0;
  try {
    execFileSync('sh', [ENTRYPOINT, handoff], {
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        REALIP_CONF: path.join(dir, 'realip.conf'),
        LISTEN_CONF: listen,
        INET6_PROC: inet6Path,
        SUPERVISOR_FATAL_MARKER: path.join(dir, 'fatal'),
      },
      stdio: 'pipe',
    });
  } catch (e) {
    status = e.status;
  }

  return { status, listen: fs.readFileSync(listen, 'utf8') };
}

test('a container with IPv6 gets the IPv6 listener', () => {
  const r = run({ inet6: '00000000000000000000000000000001 01 80 10 80 lo\n' });
  assert.equal(r.status, 0);
  assert.match(r.listen, /^listen \[::\]:80;$/m);
});

test('a container without IPv6 gets no listener', () => {
  const r = run();
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.listen, /listen/);
});

test('an empty if_inet6 counts as no IPv6', () => {
  const r = run({ inet6: '' });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.listen, /listen/);
});

/* The IPv4 listener stays. nginx defaults to ipv6only=on, so [::]:80 does not
   accept IPv4 connections and dropping `listen 80;` would break every other
   deployment. */
test('dashboard.conf keeps the IPv4 listener and includes the generated file', () => {
  const conf = fs.readFileSync(DASHBOARD_CONF, 'utf8');
  assert.match(conf, /^\s*listen 80;$/m);
  assert.match(conf, /^\s*include \/etc\/nginx\/listen-ipv6\.inc;$/m);
});

/* Alpine's nginx.conf includes /etc/nginx/http.d/*.conf at the http level,
   where `listen` is rejected and nginx will not start. */
test('the generated file is outside the http.d glob', () => {
  const entrypoint = fs.readFileSync(ENTRYPOINT, 'utf8');
  const fallback = entrypoint.match(/LISTEN_CONF="\$\{LISTEN_CONF:-([^}]+)\}"/);
  assert.ok(fallback, 'LISTEN_CONF has no default path');
  assert.doesNotMatch(fallback[1], /http\.d\/.*\.conf$/);
});

/* Every file under /proc reports a size of 0, so `test -s` is always false on
   /proc/net/if_inet6 and reports IPv6 as absent on a container that has it. The
   temporary files above are regular files, where -s works, so only the source
   shape can catch this. */
test('IPv6 is detected by reading if_inet6, not by its reported size', () => {
  const entrypoint = fs.readFileSync(ENTRYPOINT, 'utf8');
  assert.doesNotMatch(entrypoint, /-s\s+"\$INET6_PROC"/);
  assert.match(entrypoint, /cat "\$INET6_PROC"/);
});
