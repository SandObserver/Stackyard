/* The importer against real files, rather than against snippets written to suit
   it.

   The three fixtures in ./fixtures were exported from gethomepage 1.x and Dashy
   4.5.7 running in containers: the Homepage pair is its config directory, and
   the Dashy file is what /conf.yml serves to the browser. Between them they
   carry a nested group, the extra list level a bookmarks file has, every icon
   convention both projects support, service widgets, environment placeholders,
   sub-items, status checks with and without their own URL, and non-ASCII names.

   Every one of these files parsed identically under js-yaml at the time it was
   captured, which is the property the parser is really being held to. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { parseYaml } = await import('/js/yaml-lite.js');
const { detectSource, convert, SKIP, NOTE } = await import('/js/import-foreign.js');

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const load = f => {
  const doc = parseYaml(read(f));
  const kind = detectSource(doc);
  return { kind, ...convert(kind, doc, []) };
};
const apps = out => out.items.filter(i => i.type === 'app');
const folders = out => out.items.filter(i => i.type === 'folder');

test('a real Homepage services.yaml imports as its groups and services', () => {
  const out = load('homepage-services.yaml');
  assert.equal(out.kind, 'homepage-services');
  assert.deepEqual(
    folders(out).map(f => f.label),
    ['Media', 'Media / Arr Stack', 'Infrastructure', 'Tools & Utilities'],
  );
  assert.equal(apps(out).length, 12);

  const plex = apps(out).find(a => a.label === 'Plex');
  assert.equal(plex.href, 'http://media.lab.internal:32400/web');
  assert.equal(plex.iconUrl, 'plex');
  assert.equal(plex.monitoring.healthcheck.pingUrl, 'http://media.lab.internal:32400/identity');
  assert.equal(plex.monitoring.healthcheck.container, 'sytest-plex');

  /* Prowlarr names a container on another host, so the container is reported
     rather than imported: this install cannot see that daemon. */
  const prowlarr = apps(out).find(a => a.label === 'Prowlarr');
  assert.equal(prowlarr.monitoring.healthcheck.container, '');
  assert.ok(out.notes.some(n => n.code === NOTE.CONTAINER_ON_REMOTE && n.name === 'Prowlarr'));

  /* Radarr is monitored by ICMP, which the HTTP health check cannot do. */
  const radarr = apps(out).find(a => a.label === 'Radarr');
  assert.equal(radarr.monitoring.healthcheck.enabled, false);
  assert.ok(out.notes.some(n => n.code === NOTE.PING_DROPPED && n.name === 'Radarr'));

  /* Every icon convention in the file, decided one way or the other. */
  assert.equal(apps(out).find(a => a.label === 'Jellyfin').iconUrl, 'jellyfin'); /* sh-jellyfin.webp */
  assert.equal(apps(out).find(a => a.label === 'Portainer').iconUrl, ''); /* /icons/*, local to Homepage */
  assert.equal(apps(out).find(a => a.label === 'Grafana').iconUrl, ''); /* a host the page's CSP refuses */
  assert.equal(apps(out).find(a => a.label === 'Café Monitor').iconUrl, 'grafana');

  /* A Homepage widget keeps the service as a link and nothing else. */
  assert.ok(out.notes.some(n => n.code === NOTE.WIDGET_AS_LINK && n.name === 'Sonarr'));
  assert.equal(JSON.stringify(out.items).includes('HOMEPAGE_VAR'), false, 'no placeholder reaches an item');
  assert.equal(JSON.stringify(out.items).includes('GRAFANA_PASSWORD'), false);
});

test('a real Homepage bookmarks.yaml is read through its extra list level', () => {
  const out = load('homepage-bookmarks.yaml');
  assert.equal(out.kind, 'homepage-bookmarks');
  assert.deepEqual(
    folders(out).map(f => f.label),
    ['Developer', 'Homelab Docs'],
  );
  assert.deepEqual(
    apps(out).map(a => a.label),
    ['Github', 'Stack Overflow', 'Homepage Docs', 'r/selfhosted', 'Awesome Selfhosted'],
  );
  assert.equal(apps(out).find(a => a.label === 'Github').href, 'https://github.com/');
  /* Every bookmark carries an abbr, which has no equivalent here. */
  assert.equal(out.notes.filter(n => n.code === NOTE.FIELDS_DROPPED).length, 5);
});

test('a real Dashy conf.yml imports as its sections, sub-items flattened', () => {
  const out = load('dashy-conf.yml');
  assert.equal(out.kind, 'dashy');
  assert.deepEqual(
    folders(out).map(f => f.label),
    ['Media', 'Infrastructure', 'Bookmarks'],
  );
  assert.equal(apps(out).length, 10);

  /* The parent tile keeps its own link and its sub-items join the same folder,
     since folders do not nest. */
  const media = folders(out).find(f => f.label === 'Media');
  assert.equal(media.children.length, 5);
  assert.ok(out.notes.some(n => n.code === NOTE.SUBITEMS_FLATTENED && n.name === 'Sonarr'));

  /* Jellyfin carries a second address for the other network, and asks for a
     status check without naming a URL for it. */
  const jellyfin = apps(out).find(a => a.label === 'Jellyfin');
  assert.equal(jellyfin.href, 'https://jellyfin.lab.internal/');
  assert.equal(jellyfin.monitoring.healthcheck.pingUrl, 'https://jellyfin.lab.internal/');
  assert.ok(out.notes.some(n => n.code === NOTE.LOCAL_URL_DROPPED && n.name === 'Jellyfin'));

  /* statusCheck with no URL of its own falls back to the link. */
  assert.equal(
    apps(out).find(a => a.label === 'Plex').monitoring.healthcheck.pingUrl,
    'http://media.lab.internal:32400/identity',
  );
  /* Proxmox asks for the check to tolerate its own certificate. */
  assert.equal(apps(out).find(a => a.label === 'Proxmox').skipTlsVerify, true);
  /* A section holding only widgets contributes no folder and no app. */
  assert.equal(
    folders(out).some(f => f.label === 'System Widgets'),
    false,
  );
  assert.ok(out.notes.some(n => n.code === NOTE.WIDGETS_DROPPED && n.group === 'System Widgets'));
  /* Emoji and font icons have no equivalent; the tile keeps its letter. */
  assert.equal(apps(out).find(a => a.label === 'Café ☕').iconUrl, '');
});

test('nothing in the real files produces an item the save route would refuse', () => {
  for (const f of ['homepage-services.yaml', 'homepage-bookmarks.yaml', 'dashy-conf.yml']) {
    const out = load(f);
    const ids = out.items.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length, `${f}: ids are unique`);
    for (const item of out.items) {
      assert.ok(item.id && typeof item.id === 'string', `${f}: every item has an id`);
      assert.ok(item.type === 'app' || item.type === 'folder', `${f}: known type`);
      if (item.type === 'app') assert.equal(item.dock, false, `${f}: an import never fills the dock`);
      if (item.type === 'folder') assert.ok(item.children.length > 0, `${f}: no empty folder`);
    }
    assert.equal(out.skipped.filter(s => s.reason === SKIP.UNREADABLE).length, 0, `${f}: nothing unreadable`);
  }
});

/* Dashy's own default config writes its sequences level with the key rather
   than indented under it. */
test('a config in the flush layout converts like any other', () => {
  const out = load('dashy-flush-layout.yml');
  assert.equal(out.kind, 'dashy');
  assert.deepEqual(
    folders(out).map(f => f.label),
    ['Getting Started'],
  );
  assert.deepEqual(
    apps(out).map(a => a.label),
    ['Source', 'Long Icon'],
  );
  /* A section with an empty list of items contributes no folder. */
  assert.equal(
    folders(out).some(f => f.label === 'Empty On Purpose'),
    false,
  );
  /* The icon was folded across two lines in the source. */
  assert.equal(
    apps(out).find(a => a.label === 'Long Icon').iconUrl,
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/plex.svg',
  );
  assert.equal(apps(out).find(a => a.label === 'Long Icon').monitoring.healthcheck.pingUrl, 'https://plex.example.com');
});

/* The hardest constructs in one config: inline lists and mappings, unquoted
   environment placeholders, an anchor on a value, a folded description and a
   comment after a quoted value. Every one is taken from a public gethomepage
   config, and the file is what Homepage's own documentation tells people to
   write. */
test('a services.yaml using flow syntax and placeholders imports in full', () => {
  const out = load('homepage-services-flow.yaml');
  assert.equal(out.kind, 'homepage-services');
  assert.deepEqual(
    folders(out).map(f => f.label),
    ['Productivity', 'Monitoring'],
  );
  assert.equal(apps(out).length, 6);

  /* The widget fields are an inline list. The service around it still imports. */
  const nextcloud = apps(out).find(a => a.label === 'Nextcloud');
  assert.equal(nextcloud.href, 'https://cloud.example.com');
  assert.equal(nextcloud.monitoring.healthcheck.pingUrl, 'https://cloud.example.com/status.php');
  assert.equal(nextcloud.monitoring.healthcheck.container, 'nextcloud');

  /* The whole widget is written as an inline mapping on one line. */
  const paperless = apps(out).find(a => a.label === 'Paperless');
  assert.equal(paperless.href, 'https://paper.example.com');
  assert.ok(out.notes.some(n => n.code === NOTE.WIDGET_AS_LINK && n.name === 'Paperless'));

  /* An icon-font name has no CDN slug, so it is dropped and reported. */
  assert.ok(out.notes.some(n => n.code === NOTE.ICON_DROPPED && n.name === 'Weather API'));

  assert.equal(apps(out).filter(a => !a.href).length, 0);
});
