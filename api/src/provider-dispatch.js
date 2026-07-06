/* Selects and runs the provider handler for a multi-provider widget, replacing
   the hand-written switch/if-ladder each such widget's data.js carried.

   handlers : { providerKey: async (ctx) => result }
   opts.field   : config field holding the provider key (default 'provider';
                  the disk-health widget uses 'diskProvider').
   opts.default : provider key used when the field is empty or names a handler
                  that isn't registered. Matches the old "fall through to the
                  first provider" behavior.
   opts.onError : (err, ctx) => result. Wraps a thrown handler error into the
                  widget's own error shape. When omitted, thrown errors are not
                  caught here and propagate exactly as before, so adopting this
                  in a widget whose handlers only ever return { error } (rather
                  than throw) keeps behavior identical. */
async function dispatchProvider(ctx, handlers, opts = {}) {
  const field = opts.field || 'provider';
  const key = (ctx.config && ctx.config[field]) || opts.default;
  const fn = handlers[key] || (opts.default != null ? handlers[opts.default] : undefined);
  if (typeof fn !== 'function') return { error: `Unknown ${field}: ${key}` };
  if (!opts.onError) return fn(ctx);
  try { return await fn(ctx); }
  catch (e) { return opts.onError(e, ctx); }
}

module.exports = { dispatchProvider };
