/* logfmt logger: "<time> <LVL> msg=<msg> key=value ...". */

const RANK = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD = { debug: 10, info: 20, warn: 30, error: 30 };
const ABBR = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR', audit: 'AUD' };

let _threshold = THRESHOLD.info;
function _apply(name) {
  const r = THRESHOLD[String(name || '').toLowerCase()];
  if (r != null) {
    _threshold = r;
    return true;
  }
  return false;
}
_apply(process.env.LOG_LEVEL);

function _fields(data) {
  if (data instanceof Error) return { error: { message: data.message, stack: data.stack } };
  const out = {};
  for (const [k, v] of Object.entries(data || {}))
    out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
  return out;
}

/* Quote and escape every value. Values carry config, hostnames and upstream
   error messages, and a newline in one forges a whole record. */
const QUOTE_TRIGGER = /^"|[\s=]/;
const _isControl = code => code < 0x20 || code === 0x7f;

function _needsQuoting(s) {
  if (QUOTE_TRIGGER.test(s)) return true;
  for (let i = 0; i < s.length; i++) if (_isControl(s.charCodeAt(i))) return true;
  return false;
}

function _quote(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === '"' || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (_isControl(code)) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

function _val(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return _needsQuoting(s) ? _quote(s) : s;
}

function _emit(level, msg, data) {
  const rank = RANK[level];
  if (rank != null && rank < _threshold) return; /* audit has no rank, so it is never filtered */
  let line = `${new Date().toISOString()} ${ABBR[level] || level.toUpperCase()} msg=${_val(msg)}`;
  for (const [k, v] of Object.entries(_fields(data))) line += ` ${k}=${_val(v)}`;
  process.stdout.write(line + '\n');
}

const log = {
  debug(msg, data) {
    _emit('debug', msg, data);
  },
  info(msg, data) {
    _emit('info', msg, data);
  },
  warn(msg, data) {
    _emit('warn', msg, data);
  },
  error(msg, data) {
    _emit('error', msg, data);
  },
  audit(msg, data) {
    _emit('audit', msg, data);
  },
  print(text) {
    process.stdout.write(String(text) + '\n');
  },
  setLevel(name) {
    return _apply(name);
  },
};

module.exports = log;
