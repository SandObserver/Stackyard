/* Optional. Only used when the dashboard runs with DEMO_MODE=true, where your
   service is unreachable, so the widget is handed this body instead of running
   data.js. Delete this file if you do not care how your widget looks there.

   ctx is the same one data.js receives, plus ctx.demo. Using ctx.demo.wave for
   anything that should look alive keeps your numbers drifting on the same clock
   as every other widget's. */

module.exports = function (ctx) {
  const { wave, round } = ctx.demo;
  return {
    items: [{ name: 'First item' }, { name: 'Second item' }],
    total: Math.round(wave(600, 8, 20)),
    ratio: round(wave(300, 0, 1), 2),
  };
};
