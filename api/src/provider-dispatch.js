/* Runs the provider handler for a multi-provider widget.

   handlers : { providerKey: async (ctx) => result }
   opts.field   : config field holding the provider key (default 'provider')
   opts.default : used when the field is empty or names no registered handler
   opts.onError : (err, ctx) => result. Rarely wanted: a handler failure should
                  propagate, so the widget's poll lifecycle sees a failure rather
                  than a successful response carrying an error field. */
async function dispatchProvider(ctx, handlers, opts = {}) {
  const field = opts.field || 'provider';
  const key = (ctx.config && ctx.config[field]) || opts.default;
  const fn = handlers[key] || (opts.default != null ? handlers[opts.default] : undefined);
  /* The key is from the widget's own config, not an upstream, so it is safe to
     name. */
  if (typeof fn !== 'function') ctx.fail(`Unknown ${field}: ${key}`, { kind: ctx.KIND.INVALID });
  if (!opts.onError) return fn(ctx);
  try { return await fn(ctx); }
  catch (e) { return opts.onError(e, ctx); }
}

module.exports = { dispatchProvider };
