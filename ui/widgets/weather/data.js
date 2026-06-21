/* Weather widget data function — Open-Meteo (keyless).

   Config:
     city      : display name (resolved to lat/long in the editor)
     lat, lon  : coordinates stored once the city is confirmed
     units     : 'c' (default) or 'f'
     href      : optional click-through URL

   Returns the normalized shape the widget HTML renders:
     { temp, units, code, isDay, condition, city }
   code is the WMO weather code; the front-end maps it to an icon + label. */

module.exports = async function (ctx) {
  const { config, fetchJSON } = ctx;
  const lat = config.lat, lon = config.lon;
  if (lat == null || lon == null || lat === '' || lon === '') {
    return { error: 'Location not set' };
  }
  const units = config.units === 'f' ? 'f' : 'c';
  const tempUnit = units === 'f' ? 'fahrenheit' : 'celsius';

  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
    + '&current=temperature_2m,apparent_temperature,weather_code,is_day'
    + `&daily=sunrise,sunset&temperature_unit=${tempUnit}`
    + '&timezone=auto&forecast_days=1';

  let r;
  try { r = await fetchJSON(url, { timeout: 8000 }); }
  catch (e) { return { error: e.message }; }
  if (r.status >= 400 || !r.data || !r.data.current) {
    return { error: 'Weather unavailable (' + r.status + ')' };
  }

  const cur = r.data.current;
  let isDay = cur.is_day === 1 || cur.is_day === true;
  /* is_day is provided by Open-Meteo; fall back to sunrise/sunset if absent. */
  if (cur.is_day == null && r.data.daily && r.data.daily.sunrise) {
    const now = new Date(cur.time).getTime();
    const sr = new Date(r.data.daily.sunrise[0]).getTime();
    const ss = new Date(r.data.daily.sunset[0]).getTime();
    isDay = now >= sr && now < ss;
  }

  const useFeels = config.feelsLike === true || config.feelsLike === 'true';
  const real  = cur.temperature_2m;
  const feels = cur.apparent_temperature != null ? cur.apparent_temperature : real;
  const shown = useFeels ? feels : real;

  return {
    temp:      Math.round(shown),
    usedFeels: useFeels,
    units:     units,
    code:      cur.weather_code,
    isDay:     isDay,
    city:      config.city || '',
  };
};
