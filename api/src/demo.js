/* With DEMO_MODE=true the instance serves the bundled config in api/demo/,
   refuses every write, and makes no outbound requests. */
const IS_DEMO = process.env.DEMO_MODE === 'true';

const DEMO_READONLY_MSG = 'Saving is disabled in the live demo.';

module.exports = { IS_DEMO, DEMO_READONLY_MSG };
