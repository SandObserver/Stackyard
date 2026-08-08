/* logfmt logger: "<time> <LVL> msg=<msg> key=value ...".

   A leaf module, so it can be used anywhere without a circular dependency: the
   active level is pushed in with setLevel() rather than read from config here.
   `audit` records security-relevant events and always emits. */

const RANK = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD = { debug: 10, info: 20, warn: 30, error: 30, errors: 30 };
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

/* Errors are non-enumerable, so JSON.stringify(err) is "{}". Pull out the
   useful fields, for a bare Error passed as data or one nested under a key. */
function _fields(data) {
  if (data instanceof Error) return { error: { message: data.message, stack: data.stack } };
  const out = {};
  for (const [k, v] of Object.entries(data || {}))
    out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
  return out;
}

/* Values reach here from config, hostnames and upstream error messages, so a
   newline in one can forge a whole record, including a line that reads like a
   genuine audit entry. Nothing is discarded, only quoted and escaped. */
/* Not quoted on an embedded '"': a bare value runs to the next whitespace, so it
   is unambiguous, and quoting would escape every character of a JSON value. A
   leading one is quoted, since a parser reads it as the start of a value. */
const QUOTE_TRIGGER = /^"|[\s=]/;
const _isControl = code => code < 0x20 || code === 0x7f;

function _needsQuoting(s) {
  if (QUOTE_TRIGGER.test(s)) return true;
  for (let i = 0; i < s.length; i++) if (_isControl(s.charCodeAt(i))) return true;
  return false;
}

/* One pass, because the escapes overlap: a backslash introduces the others, so a
   replace chain would be order-dependent. */
function _quote(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === '"' || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    /* No escape of its own; the \u form keeps the value readable and on one line. */ else if (_isControl(code))
      out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

/* Scalars print bare (count=9); objects and arrays print as JSON (widgets=[...]).
   Either is quoted if it needs to be. */
function _val(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return _needsQuoting(s) ? _quote(s) : s;
}

function _emit(level, msg, data) {
  const rank = RANK[level];
  if (rank != null && rank < _threshold) return; /* audit has no rank → never filtered */
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
  } /* unstructured, e.g. the boot banner */,
  setLevel(name) {
    return _apply(name);
  },
};

module.exports = log;
