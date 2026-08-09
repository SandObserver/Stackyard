/* The only way a test should get a temporary directory.

   P7-3 and P7-4. Two problems, one cause: nothing owned the cleanup.

   Tests that called fs.mkdtempSync directly mostly never removed the result.
   Measured before this landed: one run of the suite left 49 directories behind,
   and 2,354 had accumulated over three days, about 205 MB.

   Tests that instead pointed CONFIG_PATH at a fixed path like
   /tmp/stackyard-auth-test-nonexistent.json were relying on nothing ever
   creating it. That held until a test called something that writes config, at
   which point the file persisted and every later run read what the previous one
   had stored. That is not hypothetical; it happened during this work and cost
   an afternoon, because a stale 16-byte secret kept reappearing.

   tmpDir() gives a fresh directory and registers its removal. Removal is on
   process exit rather than in an after() hook, because most of these tests need
   their path at module scope: they set process.env.CONFIG_PATH before requiring
   the module that reads it, which happens long before any hook could run.

   ui/test/tmp-hygiene.test.mjs holds the rule, so a new test cannot go back to
   calling mkdtempSync or naming a fixed path. */

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
