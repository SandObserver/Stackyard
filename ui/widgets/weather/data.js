/* Open-Meteo (keyless) or OpenWeather (free API key). Returns
   { temp, units, code, condition?, isDay, usedFeels, city, alerts? }, where code is the
   WMO weather code for both providers. condition names sand or volcanic ash,
   which share a WMO code with dust or smoke. The city search always uses Open-Meteo's geocoder.
   alerts lists UV and air quality readings at or above their warning level, worst first. */

async function geocode(ctx) {
  const q = String(ctx.config.cityQuery || ctx.config.city || '').trim();
  if (!q) ctx.fail('Enter a city name to search.', { kind: ctx.KIND.INVALID });
  const url =
    'https://geocoding-api.open-meteo.com/v1/search' + `?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  const r = await ctx.fetchJSON(url, { timeout: 8000 });
  if (r.status >= 400) ctx.fail('Geocoding HTTP ' + r.status);
  const options = ((r.data && r.data.results) || []).map(p => ({
    value: [p.name, p.admin1, p.country].filter(Boolean).join(', '),
    label: [p.name, p.admin1, p.country].filter(Boolean).join(', '),
    set: { lat: p.latitude, lon: p.longitude },
  }));
  return { options };
}

async function openMeteo(ctx, lat, lon, units) {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
    `&daily=sunrise,sunset&temperature_unit=${units === 'f' ? 'fahrenheit' : 'celsius'}` +
    '&timezone=auto&forecast_days=1';

  const r = await ctx.fetchJSON(url, { timeout: 8000 });
  if (r.status >= 400 || !r.data || !r.data.current) {
    ctx.fail('Weather unavailable (' + r.status + ')');
  }

  const cur = r.data.current;
  let isDay = cur.is_day === 1 || cur.is_day === true;
  if (cur.is_day == null && r.data.daily && r.data.daily.sunrise) {
    const now = new Date(cur.time).getTime();
    const sr = new Date(r.data.daily.sunrise[0]).getTime();
    const ss = new Date(r.data.daily.sunset[0]).getTime();
    isDay = now >= sr && now < ss;
  }
  const real = cur.temperature_2m;
  return {
    real,
    feels: cur.apparent_temperature != null ? cur.apparent_temperature : real,
    code: cur.weather_code,
    isDay,
  };
}

const OW_ATMOSPHERE = { 701: 10, 711: 4, 721: 5, 731: 8, 741: 45, 751: 7, 761: 6, 762: 4, 771: 18, 781: 19 };
const OW_CONDITION = { 751: 'sand', 762: 'ash' };

/* OpenWeather condition id to the WMO code the page renders. */
function wmoFromOpenWeather(id) {
  if (id >= 200 && id < 300) return 95;
  if (id >= 300 && id < 400) return 51;
  if (id === 511) return 66;
  if (id >= 520 && id < 600) return 80;
  if (id >= 500 && id < 600) return 61;
  if (id >= 611 && id <= 613) return 79;
  if (id === 615 || id === 616) return 68;
  if (id >= 620 && id < 700) return 85;
  if (id >= 600 && id < 700) return 71;
  if (id >= 700 && id < 800) return OW_ATMOSPHERE[id] ?? 45;
  if (id === 800) return 0;
  if (id === 801) return 1;
  if (id === 802) return 2;
  return 3;
}

async function openWeather(ctx, lat, lon, units) {
  const key = String(ctx.config.owKey || '').trim();
  if (!key) ctx.fail('Enter an OpenWeather API key.', { kind: ctx.KIND.INVALID });
  const url =
    'https://api.openweathermap.org/data/2.5/weather' +
    `?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
    `&units=${units === 'f' ? 'imperial' : 'metric'}&appid=${encodeURIComponent(key)}`;

  const r = await ctx.fetchJSON(url, { timeout: 8000 });
  if (r.status === 401) {
    ctx.fail('OpenWeather rejected the API key. A new key can take a few hours to activate.', { kind: ctx.KIND.AUTH });
  }
  const d = r.data;
  if (r.status >= 400 || !d || !d.main || !Array.isArray(d.weather) || !d.weather[0]) {
    ctx.fail('Weather unavailable (' + r.status + ')');
  }

  const w = d.weather[0];
  let isDay;
  if (typeof w.icon === 'string' && /[dn]$/.test(w.icon)) isDay = w.icon.endsWith('d');
  else isDay = d.sys && d.dt ? d.dt >= d.sys.sunrise && d.dt < d.sys.sunset : true;
  const real = d.main.temp;
  return {
    real,
    feels: d.main.feels_like != null ? d.main.feels_like : real,
    code: wmoFromOpenWeather(w.id),
    condition: OW_CONDITION[w.id],
    isDay,
  };
}

/* Must match the geocoder's English country names. A mismatch silently picks the US index. */
const EAQI_COUNTRIES = new Set([
  'Austria',
  'Belgium',
  'Bulgaria',
  'Croatia',
  'Cyprus',
  'Czechia',
  'Czech Republic',
  'Denmark',
  'Estonia',
  'Finland',
  'France',
  'Germany',
  'Greece',
  'Hungary',
  'Iceland',
  'Ireland',
  'Italy',
  'Latvia',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Malta',
  'Netherlands',
  'The Netherlands',
  'Norway',
  'Poland',
  'Portugal',
  'Romania',
  'Slovakia',
  'Slovenia',
  'Spain',
  'Sweden',
  'Switzerland',
  'United Kingdom',
]);

const airScale = city => (EAQI_COUNTRIES.has(String(city).split(',').pop().trim()) ? 'eu' : 'us');

const UV_BANDS = [
  [11, 'extreme', 4],
  [8, 'veryHigh', 3],
  [6, 'high', 2],
  [3, 'moderate', 1],
];
const AIR_BANDS = {
  us: [
    [301, 'hazardous', 5],
    [201, 'veryUnhealthy', 4],
    [151, 'unhealthy', 3],
    [101, 'sensitive', 2],
  ],
  eu: [
    [100, 'extremelyPoor', 4],
    [80, 'veryPoor', 3],
    [60, 'poor', 2],
  ],
};
const band = (bands, value) => bands.find(([min]) => value >= min);

function alertsFrom(uv, aqi, scale) {
  const out = [];
  if (Number.isFinite(aqi)) {
    const value = Math.round(aqi);
    const b = band(AIR_BANDS[scale], value);
    if (b) out.push({ kind: 'air', scale, value, band: b[1], level: b[2] });
  }
  if (Number.isFinite(uv)) {
    const value = Math.round(uv);
    const b = band(UV_BANDS, value);
    if (b) out.push({ kind: 'uv', value, band: b[1], level: b[2] });
  }
  return out.sort((a, b) => b.level - a.level);
}

/* Keep the catch. An air quality outage must not blank the weather. */
async function exposure(ctx, lat, lon, scale) {
  const key = scale === 'eu' ? 'european_aqi' : 'us_aqi';
  const url =
    'https://air-quality-api.open-meteo.com/v1/air-quality' +
    `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    `&current=uv_index,${key}&timezone=auto`;
  try {
    const r = await ctx.fetchJSON(url, { timeout: 8000 });
    const cur = r.status < 400 && r.data && r.data.current;
    if (!cur) return [];
    return alertsFrom(cur.uv_index, cur[key], scale);
  } catch {
    return [];
  }
}

module.exports = async function (ctx) {
  const { config } = ctx;
  if (ctx.endpoint === 'geocode') return await geocode(ctx);
  const lat = config.lat,
    lon = config.lon;
  if (lat == null || lon == null || lat === '' || lon === '') ctx.fail('Location not set', { kind: ctx.KIND.INVALID });
  const units = config.units === 'f' ? 'f' : 'c';

  const read = config.provider === 'openweather' ? openWeather : openMeteo;
  const w = await read(ctx, lat, lon, units);
  const warn = config.warnings !== false && config.warnings !== 'false';
  const alerts = warn ? await exposure(ctx, lat, lon, airScale(config.city || '')) : [];

  const useFeels = config.feelsLike === true || config.feelsLike === 'true';
  const temp = useFeels ? w.feels : w.real;
  if (typeof temp !== 'number' || !Number.isFinite(temp)) ctx.fail('Weather reply has no temperature');
  return {
    temp: Math.round(temp),
    usedFeels: useFeels,
    units: units,
    code: w.code,
    ...(w.condition && { condition: w.condition }),
    isDay: w.isDay,
    city: config.city || '',
    ...(alerts.length && { alerts }),
  };
};
