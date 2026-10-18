import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const page = fs.readFileSync(new URL('../widgets/backup/backup.html', import.meta.url), 'utf8');
const source = /function pickHaiku\([\s\S]*?\n\}/.exec(page)?.[0];
const pickHaiku = new Function(`${source}; return pickHaiku;`)();

const charW = line => line.length * 6;
const pick = (haikus, usableW, H = 200) => pickHaiku(haikus, charW, usableW, H, 2, 8, 11, 16);

test('a haiku with one line too wide is skipped whole', () => {
  const tooWide = ['Hope is not', 'a strategy.'];
  const fits = ['Back it', 'up.'];
  assert.deepEqual(pick([tooWide, fits], 70), fits);
});

test('the first haiku that fits is shown', () => {
  const first = ['Trust, but', 'verify.'];
  assert.deepEqual(pick([first, ['Backup or', 'regret.']], 100), first);
});

test('no haiku is shown when none fits', () => {
  assert.equal(pick([['Hope is not', 'a strategy.']], 40), null);
  assert.equal(pick(null, 100), null);
});

test('a haiku taller than the card is skipped', () => {
  const tall = ['Nightly run.', 'Morning calm.', 'Data lives.'];
  const short = ['Trust, but', 'verify.'];
  assert.deepEqual(pick([tall, short], 100, 40), short);
});
