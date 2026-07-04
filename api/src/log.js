/* Structured JSON logger. This is a leaf module: it imports nothing app-level,
   so it can be used everywhere without risking a circular dependency. The
   active level is not read from config here; boot and the config-save handler
   push it in via setLevel(), keeping the dependency one-directional.

   Levels, low to high: debug, info, warn, error. A level is dropped when it
   ranks below the active threshold. `audit` records security-relevant events
   and always emits regardless of the threshold. The three user-facing choices
   map as: debug = everything, info = info and above, error = warnings + errors. */

const RANK = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD = { debug: 10, info: 20, warn: 30, error: 30, errors: 30 };

let _threshold = THRESHOLD.info;
function _apply(name) {
  const r = THRESHOLD[String(name || '').toLowerCase()];
  if (r != null) { _threshold = r; return true; }
  return false;
}
_apply(process.env.LOG_LEVEL);

/* Pull an Error's useful fields out (they are non-enumerable, so a plain
   JSON.stringify of an Error yields {}). Handles both a bare Error passed as
   data and an Error nested under a data property (e.g. { error: err }). */
function _fields(data) {
  if (data instanceof Error) return { error: { message: data.message, stack: data.stack } };
  const out = {};
  for (const [k, v] of Object.entries(data || {}))
    out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
  return out;
}

function _emit(level, msg, data) {
  const rank = RANK[level];
  if (rank != null && rank < _threshold) return; /* audit has no rank → never filtered */
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level, msg, ..._fields(data) }) + '\n');
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
