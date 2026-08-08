/* Saves the same config over and over until it is killed.

   Used by config-kill.test.js, which SIGKILLs this process at a random moment
   and then inspects what is on disk. Outside test/ because `node --test`
   collects every .js under a directory called test and would report this as a
   test file with no tests.

   Argv: <configPath> <appCount>. Writes "ready" to stdout once the first save
   has completed, so the parent knows a complete file exists before it starts
   interrupting. */

const path = require('node:path');

const [, , configPath, appCount] = process.argv;
process.env.CONFIG_PATH = configPath;

const { saveConfig } = require(path.join(__dirname, '..', 'src', 'config'));

/* Big enough that a write takes long enough to be interrupted. Roughly the
   155 KB of a 300-app dashboard, which is the documented realistic ceiling. */
const items = Array.from({ length: Number(appCount) }, (_, i) => ({
  id: `app_${i}`,
  type: 'app',
  label: `Application number ${i}`,
  href: `http://service-${i}.internal.example:8080/some/path?query=${i}`,
  iconUrl: `/icons/service-${i}.svg`,
  color: '#0289ff',
  monitoring: { healthcheck: { enabled: true, container: `service-${i}` } },
}));

let generation = 0;
saveConfig({ items, settings: { generation: ++generation } });
process.stdout.write('ready\n');

/* Tight loop, no yielding: the kill has to land inside a write for the test to
   be testing anything. */
for (;;) saveConfig({ items, settings: { generation: ++generation } });
