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

/* Scalars print bare (count=9); objects and arrays print as JSON (widgets=[...]). */
function _val(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function _emit(level, msg, data) {
  const rank = RANK[level];
  if (rank != null && rank < _threshold) return; /* audit has no rank → never filtered */
  let line = `${new Date().toISOString()} ${ABBR[level] || level.toUpperCase()} msg=${msg}`;
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
