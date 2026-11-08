const setupCode = require('../src/setup-code');
const log = require('../src/log');

/** The code a first password needs, without printing it. */
function firstPasswordCode() {
  const print = log.print;
  log.print = () => {};
  try {
    setupCode.announce('first');
  } finally {
    log.print = print;
  }
  return setupCode._current();
}

module.exports = { firstPasswordCode };
