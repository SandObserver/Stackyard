import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', 'widgets');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('widgets that name their own failure include the time since it', () => {
  const cases = {
    'github/contributions.html': /name\(failureName\(line, since\)\)/,
    'system-summary/index.html': /sum\.textContent = failureName\(line, since\)/,
    'backup/backup.html': /applyError\(line, failureName\(line, since\)\)/,
    'nowplaying/index.html': /failureName\(errorLine\(failure\.error\), failure\.since\)/,
  };
  for (const [file, pattern] of Object.entries(cases)) {
    const src = read(file);
    assert.match(src, pattern, file);
    assert.match(
      src,
      /import \{[^}]*\bfailureName\b[^}]*\} from '\/js\/widget-toolbox\.js/,
      `${file} imports failureName`,
    );
  }
});

test('a Backup card names its failure with the label, and shows the line', () => {
  const src = read('backup/backup.html');
  const card = src.match(/function applyCardError\(idx, line, label = line\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(card, /setAttribute\('aria-label', label\)/);
  assert.match(card, /fitName\(bname, line\)/, 'the visible card keeps the short line');
});
