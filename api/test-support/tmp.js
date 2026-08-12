const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const created = [];
let armed = false;

/* Registered once, and only when a directory has actually been made, so a test
   file that never asks for one adds no exit handler. Kept synchronous: exit
   handlers cannot await, and the directories are small. */
function arm() {
  if (armed) return;
  armed = true;
  process.on('exit', () => {
    for (const dir of created) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });
}

/** A fresh temporary directory, removed when the process exits.
    @param {string} [label] short hint for the directory name, to make a stray
      one traceable to the test that made it
    @returns {string} absolute path */
function tmpDir(label = 'test') {
  arm();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sy-${label}-`));
  created.push(dir);
  return dir;
}

/** A path inside a fresh temporary directory. The file itself is not created,
    so this is safe for a test that wants a path nothing has written yet, which
    is what the fixed "-nonexistent" paths were reaching for.
    @param {string} [name] file name within the directory
    @param {string} [label] see tmpDir
    @returns {string} absolute path */
function tmpPath(name = 'apps.json', label = 'test') {
  return path.join(tmpDir(label), name);
}

module.exports = { tmpDir, tmpPath };
