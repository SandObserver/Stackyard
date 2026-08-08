/* Invented conditions for the public demo. */

module.exports = function weatherDemo({ demo: { wave } }) {
  return {
    temp: Math.round(wave(3600, 16, 21)),
    usedFeels: true,
    units: 'c',
    code: 1,
    isDay: true,
    city: 'San Francisco, California, USA',
  };
};
