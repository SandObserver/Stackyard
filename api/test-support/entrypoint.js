const fs = require('node:fs');
const path = require('node:path');

const LIB = path.join(__dirname, '../../docker-entrypoint-lib.sh');
const HARNESS = path.join(__dirname, 'entrypoint-harness.sh');

/** Arguments for `sh` that run the entrypoint as docker-entrypoint.sh does,
    with the paths a test chooses.
    @param {string} dir test directory. A path not given is a missing file in
      it, except the port floor, which holds 0 as Docker sets it.
    @param {{ runtime?: string, data?: string, icons?: string, inet6?: string, floor?: string }} paths
    @param {string[]} command what the entrypoint hands off to
    @returns {string[]} */
function entrypointArgs(dir, paths, command) {
  if (!paths.floor) fs.writeFileSync(path.join(dir, 'docker-floor'), '0\n');
  const p = {
    runtime: path.join(dir, 'run'),
    data: path.join(dir, 'no-data'),
    icons: path.join(dir, 'no-icons'),
    inet6: path.join(dir, 'absent-inet6'),
    floor: path.join(dir, 'docker-floor'),
    ...paths,
  };
  return [HARNESS, LIB, p.runtime, p.data, p.icons, p.inet6, p.floor, '--', ...command];
}

module.exports = { entrypointArgs, LIB };
