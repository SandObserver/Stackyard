/* The picker searches four catalogues at once. What matters is that a name a
   person actually types finds the icon, that one unreachable catalogue does not
   empty the results, and that the same service is not listed four times. */

const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('icon-catalogs'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

const catalogs = require('../src/icon-catalogs');

const DI = {
  plex: { base: 'svg', aliases: [], colors: { light: 'plex-light', dark: 'plex' } },
  overseerr: { base: 'svg', aliases: ['request manager'] },
  seerr: { base: 'svg', aliases: [] },
  /* Claims a light file it does not hold. The catalogues do this. */
  alertmanager: { base: 'svg', aliases: [], colors: { light: 'alertmanager-light', dark: 'alertmanager-dark' } },
  'adguard-home': { base: 'svg', aliases: [] },
  /* 683 of this catalogue's entries are png only. */
  plexdrive: { base: 'png', aliases: [] },
  dagster: { base: 'svg', aliases: [], colors: { light: 'dagster-light', dark: 'dagster-dark' } },
};
const SELFHST = [
  { Name: 'BigBlueButton', Reference: 'bigbluebutton', SVG: 'Yes', Light: 'Yes', Dark: 'Yes', Tags: '' },
  { Name: 'Plex', Reference: 'plex', SVG: 'Yes', Light: 'No', Dark: 'No', Tags: '' },
  { Name: 'Seerr', Reference: 'seerr', SVG: 'Yes', Light: 'Yes', Dark: 'Yes', Tags: '' },
  /* 446 of this catalogue's entries have no svg. */
  { Name: 'SerpBear', Reference: 'serpbear', SVG: 'No', PNG: 'Yes', Light: 'No', Dark: 'No', Tags: '' },
];
const SIMPLE = [{ title: 'Plex', hex: 'EBAF00' }, { title: '.ENV' }, { title: 'Spring Boot' }];
const LOBE = { tree: [{ path: 'packages/static-svg/icons/deepseek.svg' }, { path: 'README.md' }] };

/* The repository's file list, which is the authority on what the picker may
   offer. dagster has no base file, alertmanager names a light file that is not
   here, and plexdrive is png only. */
const DI_FILES = {
  tree: [
    { path: 'svg/plex.svg' },
    { path: 'png/plex.png' },
    { path: 'svg/plex-light.svg' },
    { path: 'svg/overseerr.svg' },
    { path: 'svg/seerr.svg' },
    { path: 'svg/adguard-home.svg' },
    { path: 'svg/adguard-home-sync.svg' },
    { path: 'svg/alertmanager.svg' },
    { path: 'svg/alertmanager-dark.svg' },
    { path: 'svg/dagster-light.svg' },
    { path: 'svg/dagster-dark.svg' },
    { path: 'png/plexdrive.png' },
    { path: 'README.md' },
  ],
};

/** Answers each catalogue's index by hostname and path, and records failures. */
function stubIndexes(t, { fail = [] } = {}) {
  const original = https.request;
  const hits = [];
  https.request = (opts, cb) => {
    const url = `https://${opts.hostname}${opts.path}`;
    hits.push(url);
    const req = new EventEmitter();
    req.end = () => {
      let status = 200;
      let body = 'null';
      if (url.includes('git/trees')) body = JSON.stringify(url.includes('lobehub') ? LOBE : DI_FILES);
      else if (url.includes('homarr-labs')) body = JSON.stringify(DI);
      else if (url.includes('selfhst')) body = JSON.stringify(SELFHST);
      else if (url.includes('simple-icons')) body = JSON.stringify(SIMPLE);
      else if (url.includes('lobehub')) body = JSON.stringify(LOBE);
      if (fail.some(f => url.includes(f))) {
        status = 503;
        body = 'busy';
      }
      const res = Readable.from([Buffer.from(body)]);
      res.statusCode = status;
      res.headers = { 'content-type': 'application/json' };
      setImmediate(() => cb(res));
    };
    req.write = () => {};
    req.destroy = () => {};
    return req;
  };
  t.after(() => {
    https.request = original;
    catalogs._resetCatalogCache();
  });
  return hits;
}

test('a service is found however its name is spelled', async t => {
  stubIndexes(t);
  for (const q of ['adguard home', 'AdGuard Home', 'adguard_home', 'ADGUARD-HOME', ' adguardhome ']) {
    const r = await catalogs.searchIcons(q);
    assert.equal(r[0]?.ref, 'adguard-home', q);
  }
});

test('an alias finds an icon the name does not', async t => {
  stubIndexes(t);
  const r = await catalogs.searchIcons('request manager');
  assert.equal(r[0]?.ref, 'overseerr');
});

test('an exact name outranks a longer name that contains it', async t => {
  stubIndexes(t);
  const r = await catalogs.searchIcons('plex');
  assert.equal(r[0].ref, 'plex');
  assert.equal(r[0].source, 'di');
});

test('the same service from several catalogues is listed once', async t => {
  stubIndexes(t);
  const r = await catalogs.searchIcons('plex');
  assert.equal(r.filter(x => x.name.toLowerCase() === 'plex').length, 1);
});

test('a source only it holds is reachable', async t => {
  stubIndexes(t);
  assert.equal((await catalogs.searchIcons('bigbluebutton'))[0].ref, 'selfhst:bigbluebutton');
  assert.equal((await catalogs.searchIcons('deepseek'))[0].ref, 'lobe:deepseek');
  assert.equal((await catalogs.searchIcons('spring boot'))[0].ref, 'simple:springboot');
});

/* The index is on the CDN, and the repository is the second try for it, so a
   package-size refusal there does not take the largest catalogue offline. */
test('an index the CDN refuses is read from the repository', async t => {
  const hits = stubIndexes(t, { fail: ['cdn.jsdelivr.net/gh/homarr-labs'] });
  const r = await catalogs.searchIcons('overseerr');
  assert.equal(r[0]?.ref, 'overseerr');
  assert.ok(
    hits.some(u => u.startsWith('https://cdn.jsdelivr.net/gh/homarr-labs')),
    'the CDN was never tried first',
  );
  assert.ok(
    hits.some(u => u.startsWith('https://raw.githubusercontent.com/homarr-labs')),
    'the repository was never tried',
  );
});

/* Only that one catalogue has a mirror. A retry against a host that holds
   nothing is a wasted request on every search. */
test('a catalogue with no mirror is asked once', async t => {
  const hits = stubIndexes(t, { fail: ['selfhst'] });
  await catalogs.searchIcons('bigbluebutton');
  assert.equal(hits.filter(u => u.includes('selfhst')).length, 1);
});

/* Every debounced keystroke re-ran a failed fetch. Two of these listings come
   from api.github.com, whose unauthenticated 60 an hour are shared with the
   update check, so typing could take the update check down with it. */
test('a failed listing is not refetched on the next search', async t => {
  const hits = stubIndexes(t, { fail: ['selfhst'] });
  await catalogs.searchIcons('plex');
  const first = hits.filter(u => u.includes('selfhst')).length;
  assert.equal(first, 1);
  await catalogs.searchIcons('overseerr');
  await catalogs.searchIcons('seerr');
  assert.equal(hits.filter(u => u.includes('selfhst')).length, first, 'the failure was retried');
});

/* An empty result means "no such icon". With every catalogue unreachable the
   picker must say that instead. */
test('no catalogue answering is an error, not an empty result', async t => {
  stubIndexes(t, { fail: ['cdn.jsdelivr.net', 'api.github.com', 'raw.githubusercontent.com'] });
  await assert.rejects(() => catalogs.searchIcons('plex'), /no icon catalogue could be read/);
});

test('one unreachable catalogue does not empty the results', async t => {
  stubIndexes(t, { fail: ['homarr-labs'] });
  const r = await catalogs.searchIcons('plex');
  assert.ok(r.length, 'the other three catalogues still answer');
  assert.equal(r[0].source, 'selfhst');
});

test('every index is read once and reused', async t => {
  const hits = stubIndexes(t);
  await catalogs.searchIcons('plex');
  const first = hits.length;
  await catalogs.searchIcons('overseerr');
  assert.equal(hits.length, first, 'a second search went back upstream');
  assert.equal(first, 5, 'four indexes and one file list');
});

test('a query matching nothing returns nothing', async t => {
  stubIndexes(t);
  assert.deepEqual(await catalogs.searchIcons('zzzz-no-such-service'), []);
  assert.deepEqual(await catalogs.searchIcons('   '), []);
});

/* A configuration written before the other three catalogues existed holds a
   bare dashboard-icons name. */
test('a bare name stays dashboard-icons', () => {
  assert.deepEqual(catalogs.parseRef('plex'), { source: 'di', slug: 'plex' });
  assert.deepEqual(catalogs.parseRef('selfhst:plex'), { source: 'selfhst', slug: 'plex' });
  assert.deepEqual(catalogs.parseRef('nosuch:plex'), { source: 'di', slug: 'nosuch:plex' });
});

test('two buttons never point at one file', async t => {
  stubIndexes(t);
  const plex = await catalogs.lookupIcon('plex', { verify: true });
  assert.deepEqual(
    plex.variants.map(v => v.ref),
    ['plex', 'plex-light'],
  );
  const refs = plex.variants.map(v => v.ref);
  assert.equal(new Set(refs).size, refs.length);
});

/* Neither the catalogue metadata nor its tree.json says whether the base file
   exists, and both shapes occur, so the file itself is asked. */
test('a base file that is not there is not offered', async t => {
  stubIndexes(t);
  const dagster = await catalogs.lookupIcon('dagster-dark');
  assert.deepEqual(
    dagster.variants.map(v => v.ref),
    ['dagster-light', 'dagster-dark'],
  );
});

test('a base file that is there is offered alongside both variants', async t => {
  stubIndexes(t);
  const bbb = await catalogs.lookupIcon('selfhst:bigbluebutton');
  assert.deepEqual(
    bbb.variants.map(v => v.key),
    ['base', 'light', 'dark'],
  );
});

/* A catalogue naming a variant it does not hold would otherwise put a button
   on the form that draws nothing. */
test('a variant the catalogue only claims is not offered', async t => {
  stubIndexes(t);
  const am = await catalogs.lookupIcon('alertmanager');
  assert.deepEqual(
    am.variants.map(v => v.ref),
    ['alertmanager', 'alertmanager-dark'],
  );
});

/* One list answers for the whole catalogue, so nothing is asked per file. */
test('no file is ever probed', async t => {
  const hits = stubIndexes(t);
  await catalogs.searchIcons('plex');
  await catalogs.lookupIcon('alertmanager');
  await catalogs.lookupIcon('dagster-dark');
  assert.equal(hits.filter(u => u.includes('/svg/') || u.includes('/png/')).length, 0);
  assert.equal(hits.filter(u => u.includes('git/trees') && u.includes('dashboard-icons')).length, 1);
});

/* Light and dark exist for 921 services in one catalogue and not in the one
   that otherwise ranks first. A choice nobody can see is no choice. */
test('the catalogue holding the variants wins the row', async t => {
  stubIndexes(t);
  const r = await catalogs.searchIcons('seerr');
  const seerr = r.find(x => x.name.toLowerCase() === 'seerr');
  assert.equal(seerr.source, 'selfhst', 'the row came from the catalogue with no variants');
  assert.deepEqual(
    (await catalogs.lookupIcon(seerr.ref)).variants.map(v => v.key),
    ['base', 'light', 'dark'],
  );
});

test('a service with variants in the first catalogue keeps it', async t => {
  stubIndexes(t);
  const r = await catalogs.searchIcons('plex');
  assert.equal(r[0].source, 'di');
});

/* Verifying costs a request per file, so a search does not do it. */
test('a search probes no files', async t => {
  const hits = stubIndexes(t);
  await catalogs.searchIcons('plex');
  assert.equal(hits.filter(u => u.startsWith('HEAD')).length, 0);
});

test('a stored variant finds its siblings', async t => {
  stubIndexes(t);
  const hit = await catalogs.lookupIcon('dagster-dark');
  assert.deepEqual(
    hit.variants.map(v => v.ref),
    ['dagster-light', 'dagster-dark'],
  );
});

test('an icon with one file offers no variant choice', async t => {
  stubIndexes(t);
  assert.deepEqual((await catalogs.lookupIcon('simple:plex')).variants, []);
});

/* The row must draw a file that is there. Eight entries name a base file the
   repository does not hold, and the row used to ask for it and fail. */
test('a row asks for one file, and one that exists', async t => {
  stubIndexes(t);
  const dagster = (await catalogs.searchIcons('dagster'))[0];
  assert.equal(dagster.ref, 'dagster-light', 'the row points at a file that is not there');
  assert.deepEqual(dagster.urls, ['https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/dagster-light.svg']);
  const png = (await catalogs.searchIcons('plexdrive'))[0];
  assert.deepEqual(png.urls, ['https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/plexdrive.png']);
});

/* selfh.st states the format and the variants of every entry and is right
   about all 2894 of them, so its word is taken and no second format follows. */
test('a catalogue that is right about its own files is taken at its word', async t => {
  stubIndexes(t);
  const r = await catalogs.searchIcons('bigbluebutton');
  assert.deepEqual(r[0].urls, ['https://cdn.jsdelivr.net/gh/selfhst/icons/svg/bigbluebutton.svg']);
  const png = await catalogs.searchIcons('serpbear');
  assert.deepEqual(png[0].urls, ['https://cdn.jsdelivr.net/gh/selfhst/icons/png/serpbear.png']);
});

/* A file list that cannot be read must not empty the picker. */
test('a missing file list falls back to what the metadata claims', async t => {
  stubIndexes(t, { fail: ['git/trees'] });
  const r = await catalogs.searchIcons('plex');
  assert.equal(r[0].ref, 'plex');
  assert.equal(r[0].urls.length, 2, 'with no list, both formats are offered');
});

/* formatHint runs before the icon cache is consulted on every dashboard icon,
   so a linear scan there blocks the API for the whole page. */
test('a saved reference is found without scanning the catalogue', async t => {
  stubIndexes(t);
  await catalogs.searchIcons('plex');
  assert.equal(catalogs.formatHint('plexdrive'), 'png');
  assert.equal(catalogs.formatHint('dagster-dark'), 'svg', 'a variant is indexed too');
  assert.equal(catalogs.formatHint('nothing-like-this'), '');
});

test('simple-icons filenames follow its own slug rules', () => {
  assert.equal(catalogs.simpleSlug('.ENV'), 'dotenv');
  assert.equal(catalogs.simpleSlug('Spring Boot'), 'springboot');
  assert.equal(catalogs.simpleSlug('C++'), 'cplusplus');
  assert.equal(catalogs.simpleSlug('Renée'), 'renee');
});

/* Asking for the wrong format is a guaranteed 404 on every page load, and the
   catalogues say which format they hold. */
test('the declared format is asked for first', async t => {
  stubIndexes(t);
  const png = (await catalogs.searchIcons('plexdrive'))[0];
  assert.equal(png.format, 'png');
  assert.match(png.urls[0], /\/png\/plexdrive\.png$/);
  const svg = (await catalogs.searchIcons('plex'))[0];
  assert.match(svg.urls[0], /\/svg\/plex\.svg$/);
  const noSvg = (await catalogs.searchIcons('serpbear'))[0];
  assert.equal(noSvg.format, 'png');
  assert.match(noSvg.urls[0], /\/png\/serpbear\.png$/);
});

/* With the file list in hand there is nothing to guess, so no second format
   is offered and no request can 404. */
test('only the format the file is in is offered', async t => {
  stubIndexes(t);
  const r = (await catalogs.searchIcons('plexdrive'))[0];
  assert.deepEqual(r.urls, ['https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/plexdrive.png']);
});

/* The format for a saved reference comes from the index already held for
   search. It must never fetch one: the first icon on a cold dashboard would
   wait for a 1 MB catalogue. */
test('the format hint answers only from an index already in memory', async t => {
  const hits = stubIndexes(t);
  assert.equal(catalogs.formatHint('plexdrive'), '', 'an index was fetched to answer');
  assert.equal(hits.length, 0);
  await catalogs.searchIcons('plexdrive');
  assert.equal(catalogs.formatHint('plexdrive'), 'png');
  assert.equal(catalogs.formatHint('plex'), 'svg');
  assert.equal(catalogs.formatHint('selfhst:serpbear'), 'png');
});

/* A png-only entry still has its variants, which are png too. */
test('a variant is probed in the format its entry declares', async t => {
  const hits = stubIndexes(t);
  await catalogs.lookupIcon('selfhst:bigbluebutton', { verify: true });
  assert.ok(
    hits.filter(u => u.startsWith('HEAD')).every(u => u.endsWith('.svg')),
    'a probe asked for a format the entry does not have',
  );
});

test('a file URL is built per catalogue', () => {
  assert.equal(catalogs.fileUrl('selfhst', 'plex', 'png'), 'https://cdn.jsdelivr.net/gh/selfhst/icons/png/plex.png');
  assert.equal(catalogs.fileUrl('simple', 'plex', 'png'), '', 'simple-icons ships svg only');
  assert.equal(catalogs.fileUrl('lobe', 'deepseek', 'png'), '');
  assert.equal(catalogs.rawFileUrl('selfhst', 'plex', 'svg'), '', 'only dashboard-icons has a mirror');
});
