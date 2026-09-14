/* Open-Meteo (keyless) or OpenWeather (free API key). Returns
   { temp, units, code, isDay, usedFeels, city }, where code is the WMO weather
   code for both providers. The city search always uses Open-Meteo's geocoder. */

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

/* OpenWeather condition id to the WMO code the page renders. */
function wmoFromOpenWeather(id) {
  if (id >= 200 && id < 300) return 95;
  if (id >= 300 && id < 400) return 51;
  if (id === 511) return 66;
  if (id >= 520 && id < 600) return 80;
  if (id >= 500 && id < 600) return 61;
  if (id >= 620 && id < 700) return 85;
  if (id >= 600 && id < 700) return 71;
  if (id >= 700 && id < 800) return 45;
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
    isDay,
  };
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

  const useFeels = config.feelsLike === true || config.feelsLike === 'true';
  return {
    temp: Math.round(useFeels ? w.feels : w.real),
    usedFeels: useFeels,
    units: units,
    code: w.code,
    isDay: w.isDay,
    city: config.city || '',
  };
};
