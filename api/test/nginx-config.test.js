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
  assert.equal(directives.length, 1, 'csp-default.conf must hold the one header and nothing else');
  assert.match(directives[0], /^add_header Content-Security-Policy /);
});

test('the default policy is not repeated anywhere in dashboard.conf', () => {
  assert.ok(!dashboard.includes(policy), 'the default policy is inlined somewhere; include csp-default.conf instead');
});

test('every location that sets a CSP either includes the default or is a known exception', () => {
  const EXCEPTIONS = ['^~ /admin', '^~ /widgets/'];

  const inline = [...dashboard.matchAll(/add_header Content-Security-Policy/g)];
  assert.equal(
    inline.length,
    EXCEPTIONS.length,
    `expected ${EXCEPTIONS.length} inline CSP headers, found ${inline.length}`,
  );

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
    assert.match(
      dockerfile,
      new RegExp(`COPY nginx/${f.replace('.', '\\.')} `),
      `nginx/${f} is not copied into the image, so the include would fail at runtime`,
    );
  }
});

/* ── the icon lookup ──────────────────────────────────────────────────────── */

/* Icons resolve in two steps: the user's mounted volume, then the copy bundled
   in the image. Doing that with error_page 404 works, but a failed open is
   logged as an error, and an install that has uploaded no icons is the normal
   case rather than a fault. try_files tests for the file instead.

   The home-screen paths had no second step at all, so a fresh install answered
   404 and got no icon on the home screen. */
test('every icon path tries the mounted volume, then the bundled copy', () => {
  const block = name => {
    const at = dashboard.indexOf(`location ${name} {`);
    assert.ok(at !== -1, `location ${name} not found`);
    return dashboard.slice(at, dashboard.indexOf('\n    }', at));
  };

  assert.match(block('/icons/'), /^\s*root \/;$/m, 'root / maps the request path onto the mount');
  assert.match(block('/icons/'), /try_files \$uri @icon_miss;/);
  assert.match(block('@icon_miss'), /root \/usr\/share\/nginx\/html;/);

  for (const name of ['= /apple-touch-icon.png', '= /apple-touch-icon-precomposed.png']) {
    assert.match(block(name), /^\s*root \/;$/m, name);
    assert.match(block(name), /try_files \/icons\/favicon\.png @apple_icon_miss;/, name);
  }
  assert.match(block('@apple_icon_miss'), /root \/usr\/share\/nginx\/html;/);
  assert.match(block('@apple_icon_miss'), /try_files \/icons\/favicon\.png =404;/);
});

test('no icon path resolves its fallback through a logged 404', () => {
  assert.ok(!/error_page 404 = @icon/.test(dashboard), 'a failed open logs an error on every request');
});

/* ── frame-ancestors (P14-2) ──────────────────────────────────────────────── */

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
  assert.match(
    block,
    /add_header X-Frame-Options "" always;/,
    'if this stops being cleared, the dashboard cannot embed widgets',
  );
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

/* ── the hosts a page may reach ───────────────────────────────────────────── */

/* Google Fonts was allowed by three policies for a widget that no longer
   exists, so every page could pull a stylesheet and a font from a host nothing
   asked for. The app uses system fonts and ships its own assets. */
test('no policy allows an outside font or stylesheet host', () => {
  const all = [...dashboard.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map(m => m[1]);
  all.push(policy);
  for (const p of all) {
    const directives = Object.fromEntries(
      p
        .split(';')
        .map(d => d.trim())
        .filter(Boolean)
        .map(d => {
          const [name, ...values] = d.split(/\s+/);
          return [name, values];
        }),
    );
    for (const name of ['font-src', 'style-src']) {
      const values = directives[name] || [];
      const hosts = values.filter(v => v.startsWith('http') || v.includes('.'));
      assert.deepEqual(hosts, [], `${name} allows an outside host: ${hosts.join(' ')}`);
    }
  }
});

/* ── P16-5 and P16-6: version disclosure and compression ──────────────────── */

test('the nginx version is not advertised', () => {
  assert.match(
    dashboard,
    /^\s*server_tokens off;$/m,
    'without this, every response carries Server: nginx/x.y.z and error pages print the version',
  );
});

/* The API was not compressed at all: gzip_types listed text, CSS, JavaScript and
   SVG, and nothing JSON. */
test('JSON responses are compressed', () => {
  assert.match(dashboard, /^\s*application\/json$/m);
  assert.match(dashboard, /^\s*application\/manifest\+json$/m, 'the PWA manifest is JSON too');
});

/* Which MIME type nginx reports for .js depends on the build's mime.types, and
   the move to the RFC 9239 name is still open upstream. Listing one of them would
   silently stop compressing the frontend on a build that reports the other. */
test('both JavaScript MIME types are listed', () => {
  assert.match(dashboard, /^\s*text\/javascript$/m);
  assert.match(dashboard, /^\s*application\/javascript$/m);
});

/* nginx compresses text/html whenever gzip is on, and warns about a duplicate if
   it is also listed. */
test('text/html is not listed in gzip_types', () => {
  const block = dashboard.slice(
    dashboard.indexOf('gzip_types'),
    dashboard.indexOf(';', dashboard.indexOf('gzip_types')),
  );
  assert.ok(!/\btext\/html\b/.test(block), 'nginx warns about this as a duplicate');
});

/* Correctness rather than tidying: without Vary, a shared cache in front can
   serve a gzipped body to a client that did not ask for one. */
test('compressed responses vary on Accept-Encoding', () => {
  assert.match(dashboard, /^\s*gzip_vary on;$/m);
});

test('responses to proxied requests are compressed too', () => {
  assert.match(dashboard, /^\s*gzip_proxied \w+;$/m);
});

test('every type listed for compression is a plausible MIME type', () => {
  const at = dashboard.indexOf('gzip_types');
  const block = dashboard.slice(at + 'gzip_types'.length, dashboard.indexOf(';', at));
  const types = block.split(/\s+/).filter(Boolean);
  assert.ok(types.length >= 8, `expected the full list, found ${types.length}`);
  for (const t of types) {
    assert.match(t, /^[a-z]+\/[a-z0-9.+-]+$/, `${t} does not look like a MIME type`);
  }
  assert.equal(new Set(types).size, types.length, 'a type is listed twice');
});

/* ── P16-2: nginx was the strictest limit, invisibly ─────────────────────────
   client_max_body_size was unset, so nginx used its 1 MB default while the API
   allowed 2 MB for an icon upload. An icon between the two was refused by nginx
   with a generic 413 page, although the upload form offers 2 MB. The component
   that knows what the limit means was never the one enforcing it.

   The ordering is the property worth pinning: nginx must stay above every limit
   the API enforces, or it silently becomes the real one again. */

const { BODY_LIMIT } = require('../src/router');

/* nginx accepts 3m, 512k and so on. */
function nginxSize(text, directive) {
  const m = new RegExp('^\\s*' + directive + '\\s+(\\d+)([kmg]?)\\s*;', 'im').exec(text);
  if (!m) return null;
  const mult = { '': 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 }[m[2].toLowerCase()];
  return Number(m[1]) * mult;
}

test('nginx sets a body size limit at all', () => {
  const limit = nginxSize(dashboard, 'client_max_body_size');
  assert.ok(limit, 'unset means nginx quietly applies its own 1 MB default');
});

test('nginx allows at least as much as the API does', () => {
  const nginxLimit = nginxSize(dashboard, 'client_max_body_size');
  const iconLimit = 2 * 1024 * 1024; /* ICON_MAX_BYTES in routes/icons.js */

  assert.ok(nginxLimit >= BODY_LIMIT, `nginx allows ${nginxLimit} but the API accepts bodies up to ${BODY_LIMIT}`);
  assert.ok(nginxLimit >= iconLimit, `nginx allows ${nginxLimit} but icon uploads may be ${iconLimit}`);
});

/* Headroom, not a blank cheque: a body is buffered before it is forwarded, and
   this runs on hardware with 512 MB or less. */
test('the limits stay within reach of each other', () => {
  const nginxLimit = nginxSize(dashboard, 'client_max_body_size');
  assert.ok(
    nginxLimit <= BODY_LIMIT * 4,
    `nginx allows ${nginxLimit}, far above the API's ${BODY_LIMIT}; buffering that costs memory`,
  );
});

/* The measurement the API limit is derived from. If a config item grows enough
   for this to fail, the limit needs revisiting rather than the test relaxing. */
test('the API limit leaves real configurations far inside it', () => {
  const app = {
    id: 'radarr_m9x2p4',
    type: 'app',
    label: 'Radarr',
    href: 'https://radarr.example.lan:7878',
    iconUrl: 'radarr',
    color: 'dark',
    dock: false,
    monitoring: {
      healthcheck: { enabled: true },
      activity: {
        enabled: true,
        url: 'https://radarr.example.lan:7878/api/v3/queue',
        interval: 30,
        headers: [{ key: 'X-Api-Key', value: '0'.repeat(32), secret: true }],
        params: [],
      },
    },
    badge: { enabled: true, url: 'https://radarr.example.lan:7878/api/v3/queue', interval: 30 },
    container: 'radarr',
    ping: 'https://radarr.example.lan:7878',
  };
  const big = JSON.stringify({
    items: Array.from({ length: 300 }, (_, i) => ({ ...app, id: `app${i}` })),
    settings: { background: {}, server: {} },
    _rev: 12,
  });

  assert.ok(
    big.length < BODY_LIMIT / 4,
    `a 300-app config is ${big.length} bytes against a ${BODY_LIMIT} limit; the headroom has gone`,
  );
});

/* The Host nginx forwards decides whether a write is accepted.

   checkOrigin compares the browser's Origin against the Host header. nginx's
   $host strips the port; a browser's Origin keeps it. Forwarding $host
   therefore compared "server:8700" against "server" and refused every write on
   any install reached directly on a mapped port, which is the usual way this is
   run. A reverse proxy on 443 hid it, having no port to strip.

   Found by the end-to-end suite on its first working run. */

test('the proxied Host keeps its port, or every write is refused', () => {
  const conf = dashboard;
  const hostLines = conf.split('\n').filter(l => /proxy_set_header\s+Host\s/.test(l));
  assert.ok(hostLines.length >= 2, 'the proxied Host header is gone');
  for (const line of hostLines) {
    assert.match(line, /\$http_host/, 'use $http_host: $host drops the port and breaks the origin check');
    assert.doesNotMatch(line, /\$host\b(?!_)/, '$host strips the port');
  }
});

/* Where request logs go.

   Alpine's packaged nginx.conf sends the access log and the error log to files
   under /var/log/nginx. Nothing in the container reads them, and nothing trims
   them: no logrotate binary is installed and no cron runs. So request failures
   an operator needs (413, upstream refused, permission problems) were invisible
   in `docker logs`, while the files grew unbounded in the writable layer.

   Both directives are valid in the server context, so this stays in a file the
   repo owns rather than shipping our own nginx.conf. That also bounds it:
   master and startup errors still follow the main context. */

test('request errors reach the container log', () => {
  const serverLevel = dashboard.slice(0, dashboard.indexOf('location'));
  assert.match(
    serverLevel,
    /^\s*error_log stderr\b/m,
    'without this, request failures are written to a file nobody reads',
  );
});

test('the access log is off rather than written to an unrotated file', () => {
  const serverLevel = dashboard.slice(0, dashboard.indexOf('location'));
  assert.match(serverLevel, /^\s*access_log off;$/m);
});

/* The health check runs every few seconds forever, so it was given its own
   access_log off long before the server-level one existed. */
test('the health check is still excluded', () => {
  const health = dashboard.slice(dashboard.indexOf('location = /health'));
  assert.match(health.slice(0, health.indexOf('}')), /access_log off;/);
});

/* A hashed URL may be cached for a year. A page that names those URLs must not
   be, or a browser keeps requesting the previous release's assets. */
test('hashed asset paths are immutable and their entry points are not', () => {
  const block = name => {
    const at = dashboard.indexOf(`location ${name} {`);
    assert.ok(at !== -1, `location ${name} not found`);
    return dashboard.slice(at, dashboard.indexOf('\n    }', at));
  };
  for (const name of ['/js/', '/css/']) {
    assert.match(block(name), /add_header Cache-Control "public, max-age=31536000, immutable"/, name);
  }
  /* Stamped by hand or not at all, so a year-long lifetime would strand them. */
  for (const name of ['^~ /widgets/', '/i18n/', '= /', '^~ /admin']) {
    assert.match(block(name), /add_header Cache-Control "no-cache/, name);
  }
});

test('the image stamps assets itself, so a locally built image is not pinned to ?v=1', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '../../Dockerfile'), 'utf8');
  assert.match(dockerfile, /RUN node scripts\/bump-cache-busting\.js/);
  /* scripts/ is excluded from the build context except by name. */
  const ignore = fs.readFileSync(path.join(__dirname, '../../.dockerignore'), 'utf8');
  assert.match(ignore, /^!scripts\/bump-cache-busting\.js$/m, 'the script must reach the build context');
  assert.match(dockerfile, /COPY --from=assets \/src\/ui\/ \/usr\/share\/nginx\/html\//);
  assert.ok(
    !/^COPY ui\/ \/usr\/share\/nginx\/html/m.test(dockerfile),
    'the web root must come from the stamped stage, not straight from the build context',
  );
});
