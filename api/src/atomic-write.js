const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** @typedef {Readonly<Record<string, readonly [number, string]>>} WriteFailures */

/** @type {WriteFailures} */
const WRITE_FAILURES = Object.freeze({
  ENOSPC: [507, 'internal.disk-full'],
  EDQUOT: [507, 'internal.disk-full'],
  EACCES: [500, 'internal.config-not-writable'],
  EPERM: [500, 'internal.config-not-writable'],
  EROFS: [500, 'internal.config-not-writable'],
});

/** @type {WriteFailures} */
const ICONS_WRITE_FAILURES = Object.freeze({
  ...WRITE_FAILURES,
  EACCES: [500, 'internal.icons-not-writable'],
  EPERM: [500, 'internal.icons-not-writable'],
  EROFS: [500, 'internal.icons-not-writable'],
});

const UPLOAD_TMP_RE = /^\.upload-[0-9a-f]+\.tmp$/;

/** @param {string} dir @param {number} maxAgeMs */
function removeStaleUploads(dir, maxAgeMs) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!UPLOAD_TMP_RE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (Date.now() - fs.lstatSync(file).mtimeMs > maxAgeMs) fs.unlinkSync(file);
    } catch {
      /* nothing more to do */
    }
  }
}

/** @param {any} e @param {WriteFailures} [failures] */
function tagWriteFailure(e, failures = WRITE_FAILURES) {
  const known = failures[e?.code];
  if (known) [e.status, e.apiCode] = known;
  return e;
}

const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

/** @param {string} tmp @param {string} target */
function linkNoReplace(tmp, target) {
  try {
    fs.linkSync(tmp, target);
  } catch (e) {
    if (!NO_HARD_LINKS.has(e.code)) throw e;
    if (fs.existsSync(target)) throw Object.assign(new Error('file already exists'), { code: 'EEXIST' });
    fs.renameSync(tmp, target);
    return;
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* the target is complete */
  }
}

/** Writes to a temp file in the target's folder, flushes it, then moves it to
    the target and flushes the folder. On any failure the temp file is removed
    and the target is untouched. Errors carry `status` and `apiCode` for the
    known disk and permission failures.

    @param {string} target
    @param {string | Buffer} data
    @param {{ mode?: number, tmp?: string, noReplace?: boolean,
              failures?: WriteFailures }} [opts]
      tmp: a fixed temp path, removed first if a crash left it.
      noReplace: fail with EEXIST rather than replace an existing target. */
function writeFileAtomic(target, data, opts = {}) {
  const { mode = 0o666, noReplace = false, failures = WRITE_FAILURES } = opts;
  const dir = path.dirname(target);
  const tmp = opts.tmp || path.join(dir, `.upload-${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (opts.tmp) {
      /* Keep the unlink. A temp file left by a crash keeps its mode through the
         rename and exposes the secrets. */
      try {
        fs.unlinkSync(tmp);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    const fd = fs.openSync(tmp, 'wx', mode);
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (noReplace) linkNoReplace(tmp, target);
    else fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing more to do */
    }
    throw tagWriteFailure(e, failures);
  }

  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* Some filesystems refuse to fsync a directory. The contents are already
       durable. */
  }
}

module.exports = { writeFileAtomic, removeStaleUploads, tagWriteFailure, WRITE_FAILURES, ICONS_WRITE_FAILURES };
