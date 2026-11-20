// @ts-check

const SEED_MARK = '_e2eSeed';

/** Whether seeding may replace the config a server holds. True for a config
    the suite wrote, one with no items of its own, or when E2E_ALLOW_WIPE=1.
    @param {any} stored the config as GET /api/config returns it
    @param {Record<string, string | undefined>} [env] */
function mayReplace(stored, env = process.env) {
  if (env.E2E_ALLOW_WIPE === '1') return true;
  if (stored?.[SEED_MARK] === true) return true;
  const items = Array.isArray(stored?.items) ? stored.items : [];
  return !items.some(item => item && !item.system);
}

module.exports = { SEED_MARK, mayReplace };
