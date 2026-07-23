const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'weather', 'data.js'));

function ctxFor(config, endpoint, reply) {
  const calls = [];
  return {
    calls,
    ctx: {
      config,
      endpoint,
      fetchJSON: async (url) => { calls.push(url); return reply; },
    },
  };
}

const GEO = { status: 200, data: { results: [
  { name: 'Ottawa', admin1: 'Ontario', country: 'Canada', latitude: 45.42, longitude: -75.7 },
  { name: 'Ottawa', admin1: 'Illinois', country: 'United States', latitude: 41.35, longitude: -88.84 },
] } };

test('geocode returns one option per match, each carrying lat and lon', async () => {
  const { ctx, calls } = ctxFor({ cityQuery: 'Ottawa' }, 'geocode', GEO);
  const r = await dataFn(ctx);
  assert.equal(r.options.length, 2);
  assert.equal(r.options[0].value, 'Ottawa, Ontario, Canada');
  assert.equal(r.options[0].label, 'Ottawa, Ontario, Canada');
  assert.deepEqual(r.options[0].set, { lat: 45.42, lon: -75.7 });
  assert.equal(r.options[1].value, 'Ottawa, Illinois, United States');
  assert.match(calls[0], /^https:\/\/geocoding-api\.open-meteo\.com\//);
  assert.match(calls[0], /name=Ottawa/);
});

test('geocode falls back to the saved city when the search box is empty', async () => {
  const { ctx, calls } = ctxFor({ city: 'Ottawa, Ontario, Canada' }, 'geocode', GEO);
  await dataFn(ctx);
  assert.match(calls[0], /name=Ottawa%2C%20Ontario%2C%20Canada/);
});

test('geocode reports a missing search term instead of calling out', async () => {
  const { ctx, calls } = ctxFor({}, 'geocode', GEO);
  const r = await dataFn(ctx);
  assert.equal(r.options, undefined);
  assert.match(r.error, /city name/i);
  assert.equal(calls.length, 0);
});

test('geocode surfaces an upstream error status', async () => {
  const { ctx } = ctxFor({ cityQuery: 'Ottawa' }, 'geocode', { status: 503, data: null });
  const r = await dataFn(ctx);
  assert.equal(r.error, 'Geocoding HTTP 503');
});

test('geocode tolerates a response with no results', async () => {
  const { ctx } = ctxFor({ cityQuery: 'zzzz' }, 'geocode', { status: 200, data: {} });
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, []);
});

test('the default endpoint still reports an unset location', async () => {
  const { ctx, calls } = ctxFor({ city: 'Ottawa' }, '', GEO);
  const r = await dataFn(ctx);
  assert.equal(r.error, 'Location not set');
  assert.equal(calls.length, 0);
});

test('the default endpoint reads the forecast, not the geocoder', async () => {
  const { ctx, calls } = ctxFor({ city: 'Ottawa', lat: 45.42, lon: -75.7, units: 'f' }, '', {
    status: 200,
    data: { current: { temperature_2m: 71.4, apparent_temperature: 75.2, weather_code: 3, is_day: 1 } },
  });
  const r = await dataFn(ctx);
  assert.match(calls[0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  assert.equal(r.temp, 71);
  assert.equal(r.units, 'f');
  assert.equal(r.usedFeels, false);
  assert.equal(r.city, 'Ottawa');
});

test('feelsLike swaps in the apparent temperature', async () => {
  const { ctx } = ctxFor({ lat: 45.42, lon: -75.7, feelsLike: true }, '', {
    status: 200,
    data: { current: { temperature_2m: 21.4, apparent_temperature: 25.2, weather_code: 3, is_day: 1 } },
  });
  const r = await dataFn(ctx);
  assert.equal(r.temp, 25);
  assert.equal(r.usedFeels, true);
});
