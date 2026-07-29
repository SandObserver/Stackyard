/* logfmt logger: prints "<time> <LVL> msg=<msg> key=value ..." for readable
   container logs. Leaf module (imports nothing app-level) so it can be used
   everywhere without a circular dependency; the active level is pushed in via
   setLevel() by boot and the config-save handler, not read from config here.

   Levels low to high: debug, info, warn, error. A level is dropped when it
   ranks below the active threshold. `audit` records security-relevant events
   and always emits. User-facing choices map as: debug = everything,
   info = info and above, error = warnings + errors. */

const RANK = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD = { debug: 10, info: 20, warn: 30, error: 30, errors: 30 };
const ABBR = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR', audit: 'AUD' };

let _threshold = THRESHOLD.info;
function _apply(name) {
  const r = THRESHOLD[String(name || '').toLowerCase()];
  if (r != null) { _threshold = r; return true; }
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

/* logfmt quoting.

   A value printed bare could end the line and start another. Values reach here
   from config (widget types, item ids), from hostnames, and from upstream error
   messages, so a newline in one of them forged a whole record: a single
   log.error call could emit a second line reading like a genuine AUD entry.
   Spaces and '=' broke parsing more quietly, splitting one field into several.

   So: quote when the value contains anything that would not survive being
   printed bare, and escape what would end the quoted string. Nothing is
   discarded, which matters because these values are usually the reason someone
   is reading the log. A value needing no quoting prints exactly as before. */
/* Quote on whitespace, '=' or a control character, and on a leading '"'.

   Not on a '"' anywhere else: a bare value runs to the next whitespace, so an
   embedded quote is unambiguous, and including it would wrap every JSON value in
   quotes and escape all of its own. That would turn the documented
   widgets=["a","b"] into widgets="[\"a\",\"b\"]", which is correct but is
   exactly the readability this logger exists for. A leading quote does have to
   be escaped, since a parser reads it as the start of a quoted value. */
const QUOTE_TRIGGER = /^"|[\s=]/;
const _isControl = code => code < 0x20 || code === 0x7f;

function _needsQuoting(s) {
  if (QUOTE_TRIGGER.test(s)) return true;
  for (let i = 0; i < s.length; i++) if (_isControl(s.charCodeAt(i))) return true;
  return false;
}

/* One pass rather than chained replaces: the escapes overlap (a backslash
   introduces the others), so the order of a replace chain is load-bearing and
   easy to get wrong later. Iterating by code point keeps astral characters
   intact. */
function _quote(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === '"' || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    /* No escape of its own; the \u form keeps the value readable and on one line. */
    else if (_isControl(code)) out += '\\u' + code.toString(16).padStart(4, '0');
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
  /* msg is a developer-written literal at every call site today, but it is
     quoted on the same terms as any other value: it is the field most likely to
     be handed a variable one day, and it sits before every other field on the
     line. */
  let line = `${new Date().toISOString()} ${ABBR[level] || level.toUpperCase()} msg=${_val(msg)}`;
  for (const [k, v] of Object.entries(_fields(data))) line += ` ${k}=${_val(v)}`;
  process.stdout.write(line + '\n');
}

const log = {
  debug (msg, data) { _emit('debug', msg, data); },
  info  (msg, data) { _emit('info',  msg, data); },
  warn  (msg, data) { _emit('warn',  msg, data); },
  error (msg, data) { _emit('error', msg, data); },
  audit (msg, data) { _emit('audit', msg, data); },
  print (text) { process.stdout.write(String(text) + '\n'); }, /* unstructured, e.g. the boot banner */
  setLevel(name) { return _apply(name); },
};

module.exports = log;
