const crypto = require('node:crypto');
const fs = require('node:fs');
const log = require('./log');
const { loadConfig, loadConfigForUpdate, saveConfig, configDamage } = require('./config');
const { authActive, hashPassword, storePassword } = require('./auth');
const { newPasswordError } = require('./new-password');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP_LEN = 4;
/* About 118 bits, so guessing needs no limit. Do not add a failure count that
   replaces or blocks the code: behind a proxy without TRUSTED_PROXY every
   client shares one address, and anyone could then lock the owner out. */
const CODE_LEN = 24;

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
  first: [
    '  No dashboard password is set. To set the first one, enter this code where',
    '  Stackyard asks for it. A restart makes a new code.',
  ],
  damaged: [
    '  The saved dashboard password is damaged, so no password works. To set',
    '  a new one, enter this code on the sign-in page. A restart makes a new code.',
  ],
};

/** Never send the code anywhere but the log. Reading the log is the only
    proof of owning the server.
    @param {'host'|'first'|'damaged'} [reason] */
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
    @param {unknown} input @param {'host'|'first'|'damaged'} [reason] @returns {boolean} */
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

/* Thrown when a first start cannot store the configured password. The caller
   must not start the API: it would answer with no password. */
class InitialPasswordError extends Error {}

/* A byte-order mark or an extra line ending would be stored as part of the
   password, and the owner could never sign in. */
function cleanInitialPassword(value, name) {
  const password = value.replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '');
  const unusable = [...password].some(ch => {
    const c = ch.codePointAt(0) ?? 0;
    return c < 0x20 || c === 0x7f || c === 0xfffd;
  });
  if (unusable)
    throw new InitialPasswordError(
      `${name} holds control characters or text that is not UTF-8. Save it as plain UTF-8 text.`,
    );
  const refused = newPasswordError(password);
  if (refused) {
    const hint =
      name === 'INITIAL_PASSWORD' && refused.code === 'invalid.password-short'
        ? ' In docker-compose.yml or .env, write each $ as $$.'
        : '';
    throw new InitialPasswordError(`${name}: ${refused.error}${hint}`);
  }
  return password;
}

function readInitialPassword(name) {
  if (name === 'INITIAL_PASSWORD') return cleanInitialPassword(process.env.INITIAL_PASSWORD || '', name);
  try {
    return cleanInitialPassword(fs.readFileSync(process.env.INITIAL_PASSWORD_FILE || '', 'utf8'), name);
  } catch (e) {
    if (e instanceof InitialPasswordError) throw e;
    throw new InitialPasswordError(`INITIAL_PASSWORD_FILE could not be read: ${e.message}`);
  }
}

/** Store INITIAL_PASSWORD or INITIAL_PASSWORD_FILE once, on a first start.
    Never again after the owner set, skipped or removed a password.
    Throws InitialPasswordError when a first start cannot store it. */
async function applyInitialPassword() {
  const name = process.env.INITIAL_PASSWORD_FILE
    ? 'INITIAL_PASSWORD_FILE'
    : process.env.INITIAL_PASSWORD
      ? 'INITIAL_PASSWORD'
      : null;
  if (!name) return false;
  if (configDamage()) {
    log.warn(
      `${name} not applied: the settings file cannot be used. It applies on the first start after the file is fixed.`,
      {},
    );
    return false;
  }
  const first = stored => {
    const auth = stored.settings?.auth;
    return !auth?.passwordHash && !auth?.setupPrompted && !auth?.initialPasswordApplied;
  };
  const current = loadConfig();
  if (!first(current)) {
    if (!current.settings?.auth?.initialPasswordApplied)
      log.warn(
        `${name} ignored: a password was set, skipped or removed before. Set a password in Settings instead.`,
        {},
      );
    return false;
  }
  const password = readInitialPassword(name);
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
  InitialPasswordError,
  CODE_LEN,
  _reset: () => retire(),
  _current: () => _code,
};
