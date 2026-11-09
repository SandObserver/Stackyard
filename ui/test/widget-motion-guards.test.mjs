import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('the VPN pulse is a css animation over a static map', () => {
  const page = read('widgets/connections/connections-vpn.html');
  assert.doesNotMatch(page, /raf=requestAnimationFrame\(paintGeo\);\s*\n\s*\}\s*\n\s*function paintSoon/);
  assert.match(page, /\.glow\{[^}]*animation:vpn-glow 2042ms ease-in-out infinite alternate/);
  assert.match(page, /\.glow\.off\{animation-play-state:paused/);
  assert.match(page, /prefers-reduced-motion:reduce\)\{\.glow\{animation:none/);
});

function backupTimes(querySelector) {
  const page = read('widgets/backup/backup.html');
  const source = /function paintTimes\([\s\S]*?\n\}/.exec(page)?.[0];
  assert.ok(source, 'paintTimes is gone');
  let writes = 0;
  const bmeta = {
    querySelector,
    set innerHTML(_v) {
      writes++;
    },
  };
  const front = { setAttribute() {} };
  const paint = new Function(
    'document',
    'wt',
    'relTime',
    'setHtml',
    'html',
    'formatList',
    'STATUS_KEY',
    'STATUS_EN',
    `${source}; return paintTimes;`,
  )(
    { getElementById: id => (id.startsWith('front') ? front : bmeta) },
    (_k, en) => en,
    () => '',
    () => {},
    () => '',
    () => '',
    {},
    {},
  );
  return { paint, writes: () => writes };
}

test('a running backup keeps its spinner across polls', () => {
  const kept = backupTimes(() => ({}));
  kept.paint(0, { status: 'running' });
  assert.equal(kept.writes(), 0);
  const first = backupTimes(() => null);
  first.paint(0, { status: 'running' });
  assert.equal(first.writes(), 1);
});

test('backup loops pause off screen and times refresh between polls', () => {
  const page = read('widgets/backup/backup.html');
  assert.match(page, /whileOnScreen\(w, v => w\.classList\.toggle\('off', !v\)\)/);
  assert.match(page, /\.off \.card-back\.running, \.off \.sync-icon \{ animation-play-state: paused/);
  assert.match(page, /setInterval\(refreshTimes, 60000\)/);
  assert.match(page, /function applyError\(line\) \{\n {2}_shownJobs=null;/);
});

test('rolled and clock figures use tabular digits', () => {
  assert.match(read('widgets/dns/index.html'), /\.pct\s*\{[^}]*tabular-nums/);
  assert.match(read('widgets/weather/index.html'), /\.temp\{[^}]*tabular-nums/);
  assert.match(read('widgets/clock/digital.html'), /\.fig \{[^}]*tabular-nums/);
});

test('book spines hold a layer only while raised', () => {
  const page = read('widgets/books/index.html');
  assert.doesNotMatch(/\.bk\{[^}]*\}/.exec(page)[0], /will-change/);
  assert.match(page, /\.bk\.up\{will-change:transform/);
});

test('weather rebuilds the icon only when it changes', () => {
  const page = read('widgets/weather/index.html');
  assert.match(page, /if\(nextIcon!==iconKey\)\{\s*iconKey=nextIcon;\s*icoEl\.innerHTML=/);
});

test('now playing text takes its direction from its content', () => {
  const page = read('widgets/nowplaying/index.html');
  for (const id of ['title', 'sub', 'player']) assert.match(page, new RegExp(`id="${id}" dir="auto"`));
});

test('dashboard switch hover motion is for fine pointers only', () => {
  const page = read('widgets/dashboard-switch/index.html');
  const style = /<style>([\s\S]*?)<\/style>/.exec(page)[1];
  const gated = /@media \(hover:hover\) and \(pointer:fine\)\{[\s\S]*?\n {2}\}/.exec(style)?.[0];
  assert.ok(gated, 'the hover block is gone');
  assert.match(gated, /\.kc:hover \.key/);
  assert.doesNotMatch(style.replace(gated, ''), /:hover/);
});

test('downloads tape moves by transform', () => {
  const page = read('widgets/downloads/index.html');
  assert.match(page, /\.tp \.fill \{[^}]*transition: transform 0\.6s/);
  const shift = new Function(`${/const tapeShift = .*/.exec(page)[0]}; return tapeShift;`)();
  assert.equal(shift(0.5), 'translateX(-50%)');
  assert.equal(shift(1), 'translateX(0%)');
  assert.equal(shift(0), 'translateX(-96%)');
});

test('a number roll stays inside the interface budget', () => {
  assert.match(read('js/widget-toolbox.js'), /const ROLL_MS = 240;/);
});
