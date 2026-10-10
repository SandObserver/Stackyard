import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* A small card is not exactly square, so a 1.5px strip of card shows beside the
   scaled widget. Any other colour on the widget's outer box shows as a line. */

const widgets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'widgets');

const onGraphite = fs.readdirSync(widgets).filter(name => {
  const manifest = path.join(widgets, name, 'widget.json');
  return fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).card === 'graphite';
});

test('the scan finds the widgets on a graphite card', () => {
  assert.ok(onGraphite.includes('nowplaying'));
  assert.ok(onGraphite.includes('disk-health'));
});

test('a widget on a graphite card paints its outer box graphite or not at all', () => {
  for (const name of onGraphite) {
    const html = fs.readFileSync(path.join(widgets, name, 'index.html'), 'utf8');
    const rule = html.match(/\n\s*\.widget\s*\{([^}]*)\}/);
    const bg = rule && rule[1].match(/background\s*:\s*([^;}]+)/);
    if (!bg) continue;
    assert.equal(bg[1].trim().toUpperCase(), '#2C2C2E', `${name} paints ${bg[1].trim()} against a #2C2C2E card`);
  }
});
