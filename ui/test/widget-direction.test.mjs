/* Widgets follow the interface direction, which is what makes a Persian
   dashboard mirror properly. The System Summary is the deliberate exception.

   Its content is percentages, byte counts and sparklines rather than prose.
   Mirroring runs each sparkline's time axis backwards, which reads as a
   rendering fault rather than as a translation. Content with its own inherent
   directionality stays unmirrored.

   The exception lives on the widget's own root, so the document still carries
   the page's language and direction for anything that reads them, including the
   screen-reader summary, which is prose and does follow the page.

   Pinned here because `dir="ltr"` on one element looks exactly like an
   oversight: without a test, the next person to tidy the markup removes it and
   the layout silently starts mirroring again. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDGETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'widgets');
const read = p => fs.readFileSync(path.join(WIDGETS, p), 'utf8');

test('the System Summary pins its own layout to left-to-right', () => {
  const src = read('system-summary/index.html');
  assert.match(src, /<div class="widget" id="widget"[^>]*\sdir="ltr"/, 'the System Summary root must keep dir="ltr"');
});

test('the pin is on the widget root, not on the document', () => {
  /* Pinning the document would also flip the screen-reader summary, which is a
     sentence and belongs in the reader's direction. */
  const src = read('system-summary/index.html');
  assert.doesNotMatch(src, /<html[^>]*\sdir=/, "the document direction is the dashboard's to set");
  const srLine = src.split('\n').find(l => l.includes('id="sr-sum"')) || '';
  assert.doesNotMatch(srLine, /\sdir=/, 'the screen-reader summary should follow the page');
});

test('no other widget pins a direction', () => {
  /* Every other widget mirrors. A second exception should be a decision, not
     something that accumulates. */
  const offenders = [];
  for (const dir of fs.readdirSync(WIDGETS, { withFileTypes: true }).filter(d => d.isDirectory())) {
    for (const file of fs.readdirSync(path.join(WIDGETS, dir.name)).filter(f => f.endsWith('.html'))) {
      const rel = `${dir.name}/${file}`;
      if (rel === 'system-summary/index.html') continue;
      if (/\sdir="(ltr|rtl)"/.test(read(rel))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], 'these widgets pin a direction without a recorded reason');
});
