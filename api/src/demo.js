/* Demo mode. When DEMO_MODE=true the instance is a public, read-only showcase:
   it serves the bundled config in api/demo/, refuses every write, and makes no
   outbound requests (the proxy layer short-circuits, and a fake-data layer
   supplies widget activity). Off by default. */
const IS_DEMO = process.env.DEMO_MODE === 'true';

const DEMO_READONLY_MSG = 'Saving is disabled in the live demo.';

module.exports = { IS_DEMO, DEMO_READONLY_MSG };
