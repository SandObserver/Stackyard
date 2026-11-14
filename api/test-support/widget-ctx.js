/* The error-reporting half of the ctx widget-data.js hands a widget's data.js.

   A test that builds its own ctx has to include these, or `ctx.fail(...)` is
   undefined and the widget dies on a TypeError instead of reporting what went
   wrong. The real implementations rather than stand-ins, so a test observes the
   same WidgetError the route would. */

const { KIND, WidgetError } = require('../src/api-error');

const errorParts = () => ({
  fail: (message, opts) => {
    throw new WidgetError(message, opts);
  },
  KIND,
});

/* The ctx the route builds, with the real fetcher, so the runtime's reply
   guards run. Set CONFIG_PATH before the first call. */
function runtimeCtx(config, endpoint = '') {
  const { dataFnContext } = require('../src/widget-data');
  const { fetchUnchecked } = require('../src/proxy');
  return dataFnContext(config, endpoint, new URLSearchParams(), fetchUnchecked);
}

module.exports = { errorParts, runtimeCtx };
