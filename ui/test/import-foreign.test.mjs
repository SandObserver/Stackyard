/* The conversion rules, exercised against the shapes real gethomepage and
   Dashy files actually take.

   Two of these matter more than the rest. An href holding a placeholder only
   the other dashboard can fill in would import as a dead tile, and an href with
   a script scheme would be refused by the server for the whole save, so both
   have to be dropped here rather than passed along. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { parseYaml } = await import('/js/yaml-lite.js');
const {
  detectSource,
  convert,
  convertIcon,
  convertDashy,
  insecureApps,
  clearSkipTls,
  convertHomepageServices,
  convertHomepageBookmarks,
  parseErrorsAsSkipped,
  SKIP,
  NOTE,
} = await import('/js/import-foreign.js');

const apps = out => out.items.filter(i => i.type === 'app');
const folders = out => out.items.filter(i => i.type === 'folder');
const byName = (rows, name) => rows.filter(r => r.name === name);

const SERVICES = `- Media:
    - Plex:
        icon: plex.png
        href: http://plex:32400
        description: Movies
        siteMonitor: http://plex:32400/web
        container: plex
    - Arr Stack:
        - Sonarr:
            icon: mdi-television
            href: http://sonarr:8989
            ping: sonarr.lan
            container: sonarr
            server: other-host
- Secrets:
    - Broken:
        href: http://{{HOMEPAGE_VAR_HOST}}:8080
    - Nasty:
        href: "javascript:alert(1)"
    - NoLink:
        icon: nginx.png
`;

const BOOKMARKS = `- Developer:
    - Github:
        - abbr: GH
          href: https://github.com/
          icon: github
    - Docs:
        - href: https://example.com/docs
          icon: sh-readthedocs.webp
`;

const DASHY = `pageInfo:
  title: My Dash
appConfig:
  theme: nord
sections:
  - name: Network
    icon: fas fa-network-wired
    items:
      - title: Router
        url: http://10.0.0.1
        icon: favicon
        statusCheck: true
        tags: net
        subItems:
          - title: Switch
            url: http://10.0.0.2
      - title: NAS
        url: http://nas.lan
        localUrl: http://192.168.1.5
        statusCheck: true
        statusCheckUrl: http://nas.lan/health
      - title: Plain
        url: http://plain.lan
        statusCheck: false
        statusCheckUrl: http://plain.lan/health
pages:
  - name: Second
    path: other.yml
`;

test('detects each format from its shape, not its filename', () => {
  assert.equal(detectSource(parseYaml(SERVICES)), 'homepage-services');
  assert.equal(detectSource(parseYaml(BOOKMARKS)), 'homepage-bookmarks');
  assert.equal(detectSource(parseYaml(DASHY)), 'dashy');
  assert.equal(detectSource(parseYaml('items:\n  - id: a\n')), null);
  assert.equal(detectSource(null), null);
});

test('a Homepage group becomes a folder holding its services', () => {
  const out = convertHomepageServices(parseYaml(SERVICES));
  const media = folders(out).find(f => f.label === 'Media');
  const plex = apps(out).find(a => a.label === 'Plex');
  assert.ok(media);
  assert.deepEqual(media.children, [plex.id]);
  assert.equal(plex.href, 'http://plex:32400');
  assert.equal(plex.iconUrl, 'plex');
  assert.equal(plex.type, 'app');
  assert.equal(plex.dock, false);
  assert.equal(plex.color, 'dark');
});

test('a nested group becomes its own folder with a compound name', () => {
  const out = convertHomepageServices(parseYaml(SERVICES));
  const nested = folders(out).find(f => f.label === 'Media / Arr Stack');
  assert.ok(nested, 'nested group produced a folder');
  const sonarr = apps(out).find(a => a.label === 'Sonarr');
  assert.deepEqual(nested.children, [sonarr.id]);
  assert.equal(byName(out.notes, 'Arr Stack')[0].code, NOTE.GROUP_FLATTENED);
});

test('siteMonitor becomes the health check, ping does not', () => {
  const out = convertHomepageServices(parseYaml(SERVICES));
  const plex = apps(out).find(a => a.label === 'Plex');
  const sonarr = apps(out).find(a => a.label === 'Sonarr');
  assert.equal(plex.monitoring.healthcheck.pingUrl, 'http://plex:32400/web');
  assert.equal(plex.monitoring.healthcheck.enabled, true);
  assert.equal(sonarr.monitoring.healthcheck.pingUrl, '');
  assert.ok(out.notes.some(n => n.code === NOTE.PING_DROPPED && n.name === 'Sonarr'));
});

test('a container is imported only when it runs on this host', () => {
  const out = convertHomepageServices(parseYaml(SERVICES));
  assert.equal(apps(out).find(a => a.label === 'Plex').monitoring.healthcheck.container, 'plex');
  const sonarr = apps(out).find(a => a.label === 'Sonarr');
  assert.equal(sonarr.monitoring.healthcheck.container, '');
  assert.equal(sonarr.monitoring.healthcheck.enabled, false);
  assert.ok(out.notes.some(n => n.code === NOTE.CONTAINER_ON_REMOTE && n.detail === 'other-host'));
});

test('a link the other dashboard fills in from its own environment is skipped', () => {
  const out = convertHomepageServices(parseYaml(SERVICES));
  const skip = out.skipped.find(s => s.name === 'Broken');
  assert.equal(skip.reason, SKIP.PLACEHOLDER_HREF);
  assert.equal(
    apps(out).some(a => a.label === 'Broken'),
    false,
  );
});

test('a script-scheme link is skipped rather than saved and refused', () => {
  const out = convertHomepageServices(parseYaml(SERVICES));
  assert.equal(out.skipped.find(s => s.name === 'Nasty').reason, SKIP.UNSAFE_HREF);
});

test('a service with no link is skipped', () => {
  const out = convertHomepageServices(parseYaml(SERVICES));
  assert.equal(out.skipped.find(s => s.name === 'NoLink').reason, SKIP.NO_HREF);
});

test('a group whose services all fail produces no empty folder', () => {
  const out = convertHomepageServices(parseYaml(SERVICES));
  assert.equal(
    folders(out).some(f => f.label === 'Secrets'),
    false,
  );
});

test('a widget keeps its service as a link', () => {
  const out = convertHomepageServices(
    parseYaml(`- Tools:
    - Uptime:
        href: http://up:3001
        widget:
          type: uptimekuma
          url: http://up:3001
`),
  );
  assert.equal(apps(out)[0].href, 'http://up:3001');
  assert.ok(out.notes.some(n => n.code === NOTE.WIDGET_AS_LINK && n.name === 'Uptime'));
});

test('bookmarks are read through their extra list level', () => {
  const out = convertHomepageBookmarks(parseYaml(BOOKMARKS));
  const gh = apps(out).find(a => a.label === 'Github');
  assert.equal(gh.href, 'https://github.com/');
  assert.equal(gh.iconUrl, 'github');
  assert.equal(apps(out).find(a => a.label === 'Docs').iconUrl, 'readthedocs');
  assert.deepEqual(folders(out)[0].children.length, 2);
  assert.ok(out.notes.some(n => n.code === NOTE.FIELDS_DROPPED && n.detail.includes('abbr')));
});

test('a Dashy section becomes a folder and subItems join it', () => {
  const out = convertDashy(parseYaml(DASHY));
  const net = folders(out).find(f => f.label === 'Network');
  assert.deepEqual(
    net.children.map(id => apps(out).find(a => a.id === id).label),
    ['Router', 'Switch', 'NAS', 'Plain'],
  );
  assert.ok(out.notes.some(n => n.code === NOTE.SUBITEMS_FLATTENED && n.name === 'Switch'));
});

test('statusCheck decides the health check, with or without its own URL', () => {
  const out = convertDashy(parseYaml(DASHY));
  const get = label => apps(out).find(a => a.label === label).monitoring.healthcheck;
  assert.equal(get('Router').pingUrl, 'http://10.0.0.1');
  assert.equal(get('NAS').pingUrl, 'http://nas.lan/health');
  assert.equal(get('Plain').pingUrl, '');
  assert.equal(get('Plain').enabled, false);
});

test('localUrl is dropped and extra pages are reported', () => {
  const out = convertDashy(parseYaml(DASHY));
  assert.equal(apps(out).find(a => a.label === 'NAS').href, 'http://nas.lan');
  assert.ok(out.notes.some(n => n.code === NOTE.PAGES_NOT_FOLLOWED && n.detail === '1'));
});

test('icons: a slug survives, an icon font does not', () => {
  assert.deepEqual(convertIcon('sonarr.png'), { iconUrl: 'sonarr', dropped: false });
  assert.deepEqual(convertIcon('sonarr.webp'), { iconUrl: 'sonarr', dropped: false });
  assert.deepEqual(convertIcon('sh-jellyfin'), { iconUrl: 'jellyfin', dropped: false });
  assert.deepEqual(convertIcon('https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/x.png'), {
    iconUrl: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/x.png',
    dropped: false,
  });
  for (const bad of [
    'mdi-television',
    'si-docker',
    'fas fa-home',
    'far fa-star',
    'favicon',
    '/icons/local.png',
    '🚀',
    'https://grafana.com/static/assets/img/fav32.png',
  ]) {
    assert.equal(convertIcon(bad).iconUrl, '', `${bad} should not become an icon`);
    assert.equal(convertIcon(bad).dropped, true);
  }
});

/* Found against a real Homepage export: grafana.com served the icon, the page's
   img-src refused it, and the tile showed a broken image with a CSP violation
   in the console. An icon the browser will not load is not an icon. */
test('an icon URL the page cannot load is dropped, not stored', () => {
  assert.deepEqual(convertIcon('https://grafana.com/static/assets/img/fav32.png'), { iconUrl: '', dropped: true });
  assert.deepEqual(convertIcon('http://192.168.1.5/icon.png'), { iconUrl: '', dropped: true });
  assert.deepEqual(convertIcon('https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/plex.svg'), {
    iconUrl: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/plex.svg',
    dropped: false,
  });
  assert.deepEqual(convertIcon('https://['), { iconUrl: '', dropped: true });
});

/* The preview prints "group / name", so the note for a flattened group used to
   read "Media / Media / Arr Stack". */
test('the flattened-group note names the child once', () => {
  const out = convertHomepageServices(parseYaml(SERVICES));
  const note = out.notes.find(n => n.code === NOTE.GROUP_FLATTENED);
  assert.equal(note.name, 'Arr Stack');
  assert.equal(note.group, 'Media');
  assert.equal(note.detail, 'Media / Arr Stack');
});

/* All three found against the real Dashy export. */
test('Dashy allow-insecure carries across to the TLS switch Stackyard already has', () => {
  const out = convertDashy(
    parseYaml(`sections:
  - name: Net
    items:
      - title: PVE
        url: https://pve.lan:8006
        statusCheck: true
        statusCheckAllowInsecure: true
      - title: Plain
        url: https://plain.lan
        statusCheck: true
`),
  );
  assert.equal(apps(out).find(a => a.label === 'PVE').skipTlsVerify, true);
  assert.equal(apps(out).find(a => a.label === 'Plain').skipTlsVerify, undefined);
});

test('a homelab-svg-assets icon resolves like a selfh.st one', () => {
  assert.deepEqual(convertIcon('hl-jellyfin'), { iconUrl: 'jellyfin', dropped: false });
});

test('a second local address is reported rather than dropped in silence', () => {
  const out = convertDashy(parseYaml(DASHY));
  const note = out.notes.find(n => n.code === NOTE.LOCAL_URL_DROPPED);
  assert.equal(note.name, 'NAS');
  assert.equal(note.detail, 'http://192.168.1.5');
});

test('a note about a whole section carries no item name to repeat', () => {
  const out = convertDashy(
    parseYaml(`sections:
  - name: Stats
    widgets:
      - type: clock
`),
  );
  const note = out.notes.find(n => n.code === NOTE.WIDGETS_DROPPED);
  assert.equal(note.name, '');
  assert.equal(note.group, 'Stats');
});

/* All five found by feeding the converter deliberately damaged files. Silence
   is the thing being tested against: a mangled entry that vanishes leaves a
   smaller dashboard and no way to tell what went missing. */
test('an entry that is not in a readable shape is reported, not passed over', () => {
  const hp = convertHomepageServices(parseYaml('- G:\n    - just a string\n    - Two: keys\n      Here: yes\n'));
  assert.equal(hp.skipped.filter(s => s.reason === SKIP.UNREADABLE).length, 2);

  const dashy = convertDashy(parseYaml('sections:\n  - name: A\n    items:\n      - just a string\n'));
  assert.equal(dashy.skipped.find(s => s.reason === SKIP.UNREADABLE).group, 'A');

  const bm = convertHomepageBookmarks(parseYaml('- G:\n    - Name:\n        - not a mapping\n'));
  assert.equal(bm.skipped[0].reason, SKIP.UNREADABLE);
});

test('a link with no scheme is skipped, since it would resolve against this dashboard', () => {
  const out = convertHomepageServices(parseYaml('- G:\n    - Trav:\n        href: ../../../../etc/passwd\n'));
  assert.equal(out.skipped[0].reason, SKIP.RELATIVE_HREF);
  assert.equal(apps(out).length, 0);
});

test('a name written unquoted as a number is still a name', () => {
  const out = convertDashy(
    parseYaml('sections:\n  - name: 2024\n    items:\n      - title: 42\n        url: http://a.lan\n'),
  );
  assert.equal(apps(out)[0].label, '42');
  assert.equal(folders(out)[0].label, '2024');
});

test('a section with no name takes the caller-supplied label, so it can be translated', () => {
  const out = convertDashy(
    parseYaml('sections:\n  - items:\n      - title: T\n        url: http://a.lan\n'),
    [],
    'Importé',
  );
  assert.equal(folders(out)[0].label, 'Importé');
});

test('ids never collide with what is already on the dashboard, or across files', () => {
  const existing = ['Plex_abc', 'Media_abc'];
  const taken = new Set(existing);
  const first = convert('homepage-services', parseYaml(SERVICES), taken);
  for (const item of first.items) taken.add(item.id);
  const second = convert('homepage-services', parseYaml(SERVICES), taken);
  const all = [...existing, ...first.items.map(i => i.id), ...second.items.map(i => i.id)];
  assert.equal(new Set(all).size, all.length, 'every id is unique');
});

test('conversion adds items only, so nothing existing is touched', () => {
  const out = convert('dashy', parseYaml(DASHY), []);
  for (const item of out.items) {
    assert.ok(item.id && item.type, 'every item has the id and type the server requires');
    assert.equal(item.type === 'folder' || item.type === 'app', true);
  }
});

/* detectSource settles the format on the first entry that matches, so a group
   the rest of the file does not agree with reaches the converter. Passing over
   it imported a smaller dashboard with nothing in the preview saying so. */
test('a group that is not a list is counted, not passed over', () => {
  const doc = parseYaml('- Dev:\n    - Git:\n        href: http://git\n- Broken: notalist\n');
  const out = convertHomepageServices(doc, []);
  assert.equal(apps(out).length, 1);
  assert.equal(byName(out.skipped, 'Broken').length, 1);
  assert.equal(out.skipped[0].reason, SKIP.UNREADABLE);
});

test('a bookmarks group that is not a list is counted too', () => {
  const doc = [{ Dev: [{ Git: [{ href: 'http://git' }] }] }, { Broken: 'notalist' }];
  const out = convertHomepageBookmarks(doc, []);
  assert.equal(apps(out).length, 1);
  assert.equal(byName(out.skipped, 'Broken').length, 1);
});

test('a Dashy section with no readable items is counted, not dropped', () => {
  const out = convertDashy({ sections: [{ name: 'Apps' }] }, []);
  assert.equal(out.items.length, 0);
  assert.equal(byName(out.skipped, 'Apps').length, 1);
  assert.equal(out.skipped[0].reason, SKIP.UNREADABLE);
});

/* A section that only holds widgets already reports them as dropped, so a
   second line about the same section would say nothing new. */
test('a Dashy section holding only widgets reports the widgets alone', () => {
  const out = convertDashy({ sections: [{ name: 'Stats', widgets: [{ type: 'cpu' }] }] }, []);
  assert.deepEqual(out.skipped, []);
  assert.equal(out.notes[0].code, NOTE.WIDGETS_DROPPED);
});

/* The caller builds one set and passes it to every file in the batch. Copying
   it inside meant the second file could not see what the first allocated. */
test('the caller sees the ids a conversion allocated', () => {
  const taken = new Set(['Plex_abc']);
  const out = convertHomepageServices(parseYaml(SERVICES), taken);
  for (const item of out.items) assert.ok(taken.has(item.id), 'the id is in the caller’s set');
});

/* A file from another dashboard can ask for certificate checking to be skipped.
   The import names those apps and asks, rather than taking a security setting on
   the file's say-so, so the conversion has to keep the request separable from
   the decision. */
test('the apps a file asked to skip certificate checking for are identifiable', () => {
  const out = convertDashy(
    parseYaml(`
sections:
  - name: Net
    items:
      - title: PVE
        url: https://pve.lan:8006
        statusCheck: true
        statusCheckAllowInsecure: true
      - title: Plain
        url: https://plain.lan
        statusCheck: true
`),
  );
  assert.deepEqual(
    insecureApps(out.items).map(a => a.label),
    ['PVE'],
  );
});

test('turning the request down leaves the app as one that never asked', () => {
  const items = [
    { id: 'a', type: 'app', label: 'PVE', skipTlsVerify: true },
    { id: 'b', type: 'app', label: 'Plain' },
    { id: 'c', type: 'folder', label: 'Net' },
  ];
  clearSkipTls(items);
  assert.deepEqual(items[0], { id: 'a', type: 'app', label: 'PVE' });
  assert.deepEqual(insecureApps(items), []);
});

test('accepting the request is what keeps it, and nothing else is touched', () => {
  const items = [{ id: 'a', type: 'app', label: 'PVE', skipTlsVerify: true }];
  assert.equal(insecureApps(items).length, 1);
  assert.equal(items[0].skipTlsVerify, true);
});

test('insecureApps tolerates the shapes a damaged conversion could produce', () => {
  assert.deepEqual(insecureApps(null), []);
  assert.deepEqual(insecureApps([null, undefined, { type: 'app' }, { type: 'folder', skipTlsVerify: true }]), []);
});

/* A line the parser had to drop is a missing service, so it belongs in the same
   list the preview already shows for everything else left out. */
test('parser errors become skipped rows carrying the line and the file', () => {
  const rows = parseErrorsAsSkipped(
    [
      { line: 12, reason: 'merge keys are not supported' },
      { line: 30, reason: 'an alias to a block anchor is not supported' },
    ],
    'services.yaml',
  );
  assert.deepEqual(rows, [
    { reason: SKIP.UNPARSABLE, name: 'services.yaml', group: '', detail: '12' },
    { reason: SKIP.UNPARSABLE, name: 'services.yaml', group: '', detail: '30' },
  ]);
});

test('a clean parse contributes no skipped rows', () => {
  assert.deepEqual(parseErrorsAsSkipped([], 'services.yaml'), []);
  assert.deepEqual(parseErrorsAsSkipped(null), []);
});
