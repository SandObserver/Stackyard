import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDGETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'widgets');
const read = p => fs.readFileSync(path.join(WIDGETS, p), 'utf8');

const PINS = { 'system-summary/index.html': 'widget', 'clock/digital.html': 'time-block' };
const pinTags = rel => read(rel).match(/<[a-z][^>]*\sdir="(?:ltr|rtl)"[^>]*>/g) || [];

function widgetPages() {
  return fs
    .readdirSync(WIDGETS, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .flatMap(d =>
      fs
        .readdirSync(path.join(WIDGETS, d.name))
        .filter(f => f.endsWith('.html'))
        .map(f => `${d.name}/${f}`),
    );
}

test('each pinned widget sets dir="ltr" on its one recorded element only', () => {
  for (const [rel, id] of Object.entries(PINS)) {
    const tags = pinTags(rel);
    assert.equal(tags.length, 1, `${rel} pins a direction on one element`);
    assert.match(tags[0], new RegExp(`\\sid="${id}"`), `${rel} pins #${id}`);
    assert.match(tags[0], /\sdir="ltr"/, `${rel} pins left-to-right`);
  }
});

test('no other widget pins a direction', () => {
  const offenders = widgetPages().filter(rel => !(rel in PINS) && pinTags(rel).length > 0);
  assert.deepEqual(offenders, [], 'these widgets pin a direction without a recorded reason');
});
