/* The "Third-party requests" section of docs/security.md against the code.

   The section tells an operator exactly which hosts Stackyard reaches on its
   own. A host added in code and not added there turns that promise into a
   false one, and prose is the part nobody re-reads.

   EXAMPLES below are hosts that appear in source but are never contacted: form
   placeholders and documentation links. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const EXAMPLES = new Set(['app.example.com', 'example.com', 'github.com']);

function listFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) listFiles(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

/* The nginx policies count too: a host allowed there is one the browser is
   permitted to reach. */
function sourceFiles() {
  const nginxDir = path.join(root, 'nginx');
  return [
    ...listFiles(path.join(root, 'api', 'src')),
    ...listFiles(path.join(root, 'ui', 'js')),
    ...fs
      .readdirSync(nginxDir)
      .filter(f => f.endsWith('.conf'))
      .map(f => path.join(nginxDir, f)),
  ];
}

function hostsInSource() {
  const found = new Set();
  for (const file of sourceFiles()) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)) {
      if (!EXAMPLES.has(m[1])) found.add(m[1]);
    }
  }
  return found;
}

test('every outbound host in the source is named in the security doc', () => {
  const doc = read('docs/security.md');
  const section = doc.slice(doc.indexOf('## Third-party requests'));
  assert.ok(section, 'the section is gone');
  for (const host of hostsInSource()) {
    assert.ok(section.includes(host), `${host} is contacted but not documented under Third-party requests`);
  }
});

test('the doc names no host the code does not contact', () => {
  const doc = read('docs/security.md');
  const section = doc.slice(doc.indexOf('## Third-party requests'), doc.indexOf('## HTTPS and the session cookie'));
  const hosts = hostsInSource();
  for (const m of section.matchAll(/`([a-z0-9.-]+\.[a-z]{2,})`/g)) {
    assert.ok(hosts.has(m[1]), `${m[1]} is documented as contacted but appears nowhere in the source`);
  }
});
