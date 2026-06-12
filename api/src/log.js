const log = {
  _write(level, msg, data = {}) {
    process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...data }) + '\n');
  },
  info  (msg, data) { this._write('info',  msg, data); },
  warn  (msg, data) { this._write('warn',  msg, data); },
  error (msg, data) { this._write('error', msg, data); },
  audit (msg, data) { this._write('audit', msg, data); },
};

module.exports = log;
