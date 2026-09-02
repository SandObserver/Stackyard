/* An icon filename is used as saved. Lowercasing the extension requests a file
   that does not exist, and uppercase extensions arrive routinely from Windows
   and cameras.

   The filename is encoded into the path. A space survives unencoded because
   browsers encode it, but '+' and '&' change a URL's meaning and request
   something else. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { resolveIcon, iconChain, loadLocalIcons, cdnIconName } = await import('../js/icons.js');

/* loadLocalIcons fills the module's set from the API, so stand in for that
   rather than reaching into the module. */
async function withLocalIcons(files, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ files }) });
  try {
    await loadLocalIcons();
    await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const ON_DISK = ['LOGO.SVG', 'plex.png', 'My Icon.svg', 'a+b&c.svg', 'Radarr.PNG'];

/* ── the extension case ───────────────────────────────────────────────────── */

test('an uploaded icon keeps the case it has on disk', async () => {
  await withLocalIcons(ON_DISK, () => {
    assert.equal(resolveIcon('LOGO.SVG'), '/icons/LOGO.SVG', 'lowercasing this asked for a file that does not exist');
    assert.equal(resolveIcon('Radarr.PNG'), '/icons/Radarr.PNG');
  });
});

test('a lowercase name still works', async () => {
  await withLocalIcons(ON_DISK, () => {
    assert.equal(resolveIcon('plex.png'), '/icons/plex.png');
  });
});

/* Matching stays exact. Guessing at case could pick the wrong file, and a
   filesystem may hold both spellings. */
test('a name that differs only by case is not a match', async () => {
  await withLocalIcons(ON_DISK, () => {
    assert.equal(resolveIcon('logo.svg'), '', 'no local file by that exact name');
  });
});

/* ── encoding ─────────────────────────────────────────────────────────────── */

test('a filename with a space is encoded', async () => {
  await withLocalIcons(ON_DISK, () => {
    assert.equal(resolveIcon('My Icon.svg'), '/icons/My%20Icon.svg');
  });
});

/* The characters that actually change a URL's meaning rather than merely
   looking untidy. */
test('a filename with + or & is encoded', async () => {
  await withLocalIcons(ON_DISK, () => {
    assert.equal(resolveIcon('a+b&c.svg'), '/icons/a%2Bb%26c.svg');
  });
});

test('the /icons/ prefix is never encoded', async () => {
  await withLocalIcons(ON_DISK, () => {
    for (const f of ON_DISK) {
      assert.match(resolveIcon(f), /^\/icons\/[^/]*$/, `${f} produced a mangled prefix`);
    }
  });
});

/* ── remote URLs ──────────────────────────────────────────────────────────── */

test('a remote URL whose filename is held locally is served locally', async () => {
  await withLocalIcons(ON_DISK, () => {
    assert.equal(resolveIcon('https://cdn.example/plex.png'), '/icons/plex.png');
  });
});

test('a remote URL with no local copy is left alone', async () => {
  await withLocalIcons(ON_DISK, () => {
    assert.equal(resolveIcon('https://cdn.example/other.png'), 'https://cdn.example/other.png');
  });
});

test('an empty or missing value produces nothing', async () => {
  await withLocalIcons(ON_DISK, () => {
    for (const v of ['', null, undefined]) assert.equal(resolveIcon(v), '');
  });
});

/* ── iconChain ────────────────────────────────────────────────────────────── */

test('a local icon is tried before the CDN', async () => {
  await withLocalIcons(ON_DISK, () => {
    const chain = iconChain('LOGO.SVG');
    assert.equal(chain[0], '/icons/LOGO.SVG', 'the local file comes first');
    assert.ok(chain.length > 1, 'and the CDN is still a fallback');
  });
});

test('a name with no local copy falls through to the CDN', async () => {
  await withLocalIcons([], () => {
    const chain = iconChain('radarr');
    assert.deepEqual(chain, [
      '/api/icons/cdn?name=radarr&ext=svg',
      '/api/icons/cdn?name=radarr&ext=png',
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/radarr.svg',
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/radarr.png',
    ]);
  });
});

test('CDN URLs are encoded too', async () => {
  await withLocalIcons([], () => {
    for (const u of iconChain('a+b&c')) {
      const name = u.startsWith('/api/') ? u.slice(u.indexOf('name=') + 5, u.indexOf('&ext=')) : u;
      assert.ok(!name.includes('+') && !name.includes('&'), `unencoded character in ${u}`);
    }
  });
});

test('an explicit extension picks only that CDN path', async () => {
  await withLocalIcons([], () => {
    assert.ok(iconChain('radarr.png').every(u => u.endsWith('.png') || u.endsWith('ext=png')));
    assert.ok(iconChain('radarr.svg').every(u => u.endsWith('.svg') || u.endsWith('ext=svg')));
  });
});

test('no icon produces an empty chain', async () => {
  await withLocalIcons(ON_DISK, () => {
    assert.deepEqual(iconChain(''), []);
    assert.deepEqual(iconChain(null), []);
  });
});

/* ── the CDN spells things its own way ───────────────────────────────────────
   Every file in the dashboard-icons repository is lowercase and hyphenated, and
   jsDelivr serves GitHub paths, which are case-sensitive. An unnormalised name
   404s with nothing on screen to explain it. */

test('a typed name is spelled the way the catalogue spells it', () => {
  assert.equal(cdnIconName('MySpeed'), 'myspeed');
  assert.equal(cdnIconName('Home Assistant'), 'home-assistant');
  assert.equal(cdnIconName('home_assistant'), 'home-assistant');
});

test('spacing and stray separators are tidied', () => {
  assert.equal(cdnIconName('  Plex  '), 'plex');
  assert.equal(cdnIconName('A  B'), 'a-b');
  assert.equal(cdnIconName('-radarr-'), 'radarr');
  assert.equal(cdnIconName(''), '');
  assert.equal(cdnIconName(null), '');
});

test('a name already in catalogue form is unchanged', () => {
  for (const n of ['radarr', 'home-assistant', 'pi-hole']) assert.equal(cdnIconName(n), n);
});

test('a mixed-case name reaches the right CDN URL', async () => {
  await withLocalIcons([], () => {
    assert.equal(iconChain('MySpeed')[0], '/api/icons/cdn?name=myspeed&ext=svg');
    assert.equal(iconChain('Home Assistant')[0], '/api/icons/cdn?name=home-assistant&ext=svg');
    assert.ok(iconChain('MySpeed').includes('https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/myspeed.svg'));
  });
});

/* An uploaded icon is the user's own file. Guessing at its spelling could pick
   the wrong one, and a filesystem may hold two names differing only by case. */
test('a local icon is still matched exactly, not normalised', async () => {
  await withLocalIcons(['LOGO.SVG', 'My Icon.svg'], () => {
    assert.equal(resolveIcon('LOGO.SVG'), '/icons/LOGO.SVG');
    assert.equal(resolveIcon('My Icon.svg'), '/icons/My%20Icon.svg');
    assert.equal(resolveIcon('logo.svg'), '', 'no local file by that exact name');
  });
});

/* A local file wins over the CDN, so normalising must not skip it. */
test('a local icon still takes precedence over the CDN', async () => {
  await withLocalIcons(['MySpeed.svg'], () => {
    assert.equal(iconChain('MySpeed.svg')[0], '/icons/MySpeed.svg');
  });
});
