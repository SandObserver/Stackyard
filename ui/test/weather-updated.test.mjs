import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const dir = new URL('../widgets/weather/i18n/', import.meta.url);
const page = fs.readFileSync(new URL('../widgets/weather/index.html', import.meta.url), 'utf8');

test('every language keeps the summary and the time in the updated line', () => {
  for (const file of fs.readdirSync(dir)) {
    const line = JSON.parse(fs.readFileSync(new URL(file, dir), 'utf8'))['ui.updated'];
    assert.ok(line, `${file} has no ui.updated`);
    assert.match(line, /\{summary\}/, file);
    assert.match(line, /\{time\}/, file);
  }
});

test('the hover and screen-reader text say when the reading arrived', () => {
  assert.match(
    page,
    /wt\('ui\.updated', '\{summary\}\. Updated \{time\}', \{ summary: _summary, time: sinceLabel\(_fetchedAt\) \}\)/,
  );
  assert.match(page, /setInterval\(describe, 60000\)/);
});
