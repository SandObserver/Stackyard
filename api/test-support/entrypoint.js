const fs = require('node:fs');
const path = require('node:path');

const LIB = path.join(__dirname, '../../docker-entrypoint-lib.sh');
const HARNESS = path.join(__dirname, 'entrypoint-harness.sh');

/** Arguments for `sh` that run the entrypoint as docker-entrypoint.sh does,
    with the paths a test chooses.
    @param {string} dir test directory. A path not given is a missing file in
      it, except the port floor, which holds 0 as Docker sets it. The system
      folders default to one folder, `system`, in it, and the folders allowed
      on a mount of their own to one folder, `mountable`.
    @param {{ runtime?: string, data?: string, icons?: string, inet6?: string, floor?: string, mountinfo?: string, system?: string, mountable?: string }} paths
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
    mountinfo: path.join(dir, 'absent-mountinfo'),
    system: path.join(dir, 'system'),
    mountable: path.join(dir, 'mountable'),
    ...paths,
  };
  return [
    HARNESS,
    LIB,
    p.runtime,
    p.data,
    p.icons,
    p.inet6,
    p.floor,
    p.mountinfo,
    p.system,
    p.mountable,
    '--',
    ...command,
  ];
}

module.exports = { entrypointArgs, LIB };
