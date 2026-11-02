const crypto = require('node:crypto');
const fs = require('node:fs');
const log = require('./log');
const { loadConfig, loadConfigForUpdate, saveConfig } = require('./config');
const { authActive, hashPassword, storePassword } = require('./auth');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP_LEN = 4;
/* About 118 bits, so guessing needs no limit. Do not add a failure count that
   replaces or blocks the code: behind a proxy without TRUSTED_PROXY every
   client shares one address, and anyone could then lock the owner out. */
const CODE_LEN = 24;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 1024;

let _code = null;
let _printed = false;

function newCode() {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

function format(code) {
  return code.match(new RegExp(`.{1,${GROUP_LEN}}`, 'g')).join('-');
}

const REASONS = {
  host: [
    '  Stackyard refused an address because no password is set. To set one',
    '  there, enter this code on the page. A restart makes a new code.',
  ],
  damaged: [
    '  The saved dashboard password is damaged, so no password works. To set',
    '  a new one, enter this code on the sign-in page. A restart makes a new code.',
  ],
};

/** Never send the code anywhere but the log. Reading the log is the only
    proof of owning the server.
    @param {'host'|'damaged'} [reason] */
function announce(reason = 'host') {
  if (!_code) {
    _code = newCode();
    _printed = false;
  }
  if (_printed) return;
  _printed = true;
  log.print(['', `  Setup code  ${format(_code)}`, ...REASONS[reason], ''].join('\n'));
}

/** With no code yet, prints one. Otherwise an owner holding a code from before
    a restart has no working code in the log.
    @param {unknown} input @param {'host'|'damaged'} [reason] @returns {boolean} */
function matches(input, reason) {
  if (!_code) {
    announce(reason);
    return false;
  }
  if (typeof input !== 'string') return false;
  const letters = input
    .slice(0, 256)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(-CODE_LEN);
  const given = Buffer.from(letters);
  const want = Buffer.from(_code);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

/* Call whenever a password is set or removed. A code printed before must not
   work later. */
function retire() {
  _code = null;
  _printed = false;
}

function readInitialPassword() {
  const file = process.env.INITIAL_PASSWORD_FILE;
  if (file) {
    try {
      return fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    } catch (e) {
      log.warn('INITIAL_PASSWORD_FILE could not be read', { error: e.message });
      return '';
    }
  }
  return process.env.INITIAL_PASSWORD || '';
}

/** Store INITIAL_PASSWORD or INITIAL_PASSWORD_FILE once, on a first start.
    Never again after the owner set, skipped or removed a password. */
async function applyInitialPassword() {
  const password = readInitialPassword();
  delete process.env.INITIAL_PASSWORD;
  if (!password) return false;
  const first = stored => {
    const auth = stored.settings?.auth;
    return !auth?.passwordHash && !auth?.setupPrompted && !auth?.initialPasswordApplied;
  };
  if (!first(loadConfig())) return false;
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    log.warn(
      `INITIAL_PASSWORD ignored: it must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters. In docker-compose.yml, write each $ as $$.`,
      {},
    );
    return false;
  }
  const passwordHash = await hashPassword(password);
  const cfg = loadConfigForUpdate();
  if (!first(cfg) || authActive(cfg)) return false;
  storePassword(cfg, passwordHash);
  cfg.settings.auth.initialPasswordApplied = true;
  saveConfig(cfg);
  retire();
  log.audit('password set from INITIAL_PASSWORD', {});
  return true;
}

module.exports = {
  announce,
  matches,
  retire,
  applyInitialPassword,
  CODE_LEN,
  _reset: () => retire(),
};
