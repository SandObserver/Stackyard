async function dispatchProvider(ctx, handlers, opts = {}) {
  const field = opts.field || 'provider';
  const key = (ctx.config && ctx.config[field]) || opts.default;
  const own = k => (k != null && Object.hasOwn(handlers, k) ? handlers[k] : undefined);
  const fn = own(key) || own(opts.default);
  if (typeof fn !== 'function') ctx.fail(`Unknown ${field}: ${key}`, { kind: ctx.KIND.INVALID });
  if (!opts.onError) return fn(ctx);
  try {
    return await fn(ctx);
  } catch (e) {
    return opts.onError(e, ctx);
  }
}

module.exports = { dispatchProvider };
