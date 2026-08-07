/* Selects and runs the provider handler for a multi-provider widget, replacing
   the hand-written switch/if-ladder each such widget's data.js carried.

   handlers : { providerKey: async (ctx) => result }
   opts.field   : config field holding the provider key (default 'provider';
                  the disk-health widget uses 'diskProvider').
   opts.default : provider key used when the field is empty or names a handler
                  that isn't registered. Matches the old "fall through to the
                  first provider" behavior.
   opts.onError : (err, ctx) => result. Wraps a thrown handler error into the
                  widget's own error shape. Rarely wanted: a handler failure
                  should normally propagate, so it is sanitised on the way out
                  and the widget's poll lifecycle sees a failure rather than a
                  successful response carrying an error field. */
async function dispatchProvider(ctx, handlers, opts = {}) {
  const field = opts.field || 'provider';
  const key = (ctx.config && ctx.config[field]) || opts.default;
  const fn = handlers[key] || (opts.default != null ? handlers[opts.default] : undefined);
  /* The key comes from the widget's own config, not from an upstream, so it is
     safe to name. Thrown rather than returned so it reaches the caller as a
     failure like any other. */
  if (typeof fn !== 'function') ctx.fail(`Unknown ${field}: ${key}`, { kind: ctx.KIND.INVALID });
  if (!opts.onError) return fn(ctx);
  try { return await fn(ctx); }
  catch (e) { return opts.onError(e, ctx); }
}

module.exports = { dispatchProvider };
