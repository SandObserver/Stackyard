/** Settings in the environment that Stackyard does not use as written.
    @param {NodeJS.ProcessEnv} env @param {string | null} logLevel the level LOG_LEVEL set, or null
    @returns {{ msg: string, fields: Record<string, string> }[]} */
function envWarnings(env, logLevel) {
  const out = [];
  const shown = v => String(v).slice(0, 40);
  if (env.LOG_LEVEL && !logLevel)
    out.push({
      msg: 'LOG_LEVEL is not debug, info, warn or error; the level from Settings is used',
      fields: { value: shown(env.LOG_LEVEL) },
    });
  if (env.SESSION_MAX_AGE_DAYS && !(Number(env.SESSION_MAX_AGE_DAYS) > 0))
    out.push({
      msg: 'SESSION_MAX_AGE_DAYS is not a number above 0; sessions last 12 hours',
      fields: { value: shown(env.SESSION_MAX_AGE_DAYS) },
    });
  if (env.ALLOW_PRIVATE_IPS && env.ALLOW_PRIVATE_IPS !== 'true' && env.ALLOW_PRIVATE_IPS !== 'false')
    out.push({
      msg: 'ALLOW_PRIVATE_IPS is not true or false; private addresses stay blocked',
      fields: { value: shown(env.ALLOW_PRIVATE_IPS) },
    });
  return out;
}

module.exports = { envWarnings };
