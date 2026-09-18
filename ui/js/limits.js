/* Limits both sides must agree on. The server rejects a config that breaks one
   and the browser stops the user reaching it.

   The server requires this file directly. Keep it free of the DOM, of window
   and of imports. */

/* dashboard.js shows this many dock apps. The admin toggle and the save check
   must refuse beyond it, or a saved app never appears. */
export const DOCK_MAX = 4;
