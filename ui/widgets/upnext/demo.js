const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function at(now, days, hour) {
  const d = new Date(now + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}
const day = (now, days) => new Date(now + days * DAY).toISOString().slice(0, 10);
const ends = (t, min) => new Date(t + min * 60000).toISOString();

function episode(now, days, hour, title, season, episodeNo, name, extra = {}) {
  const t = at(now, days, hour);
  return {
    kind: 'episode',
    title,
    at: new Date(t).toISOString(),
    day: '',
    season,
    episode: episodeNo,
    lastEpisode: episodeNo,
    name,
    premiere: episodeNo === 1,
    finale: '',
    link: '',
    ends: ends(t, 50),
    ...extra,
  };
}

module.exports = function () {
  const now = Date.now();
  return {
    items: [
      episode(now, 0, 21, 'Northbound', 2, 4, 'The Long Pass'),
      episode(now, 1, 20, 'Fieldwork', 1, 8, 'Hollow Ground'),
      {
        kind: 'film',
        title: 'Glass Harbor',
        at: null,
        day: day(now, 2),
        release: 'digital',
        year: 2026,
        link: '',
        ends: '',
      },
      episode(now, 3, 18, 'Small Hours', 3, 1, 'Lamplight'),
      {
        kind: 'album',
        title: 'Low Tide',
        at: null,
        day: day(now, 5),
        artist: 'Marrow Lane',
        albumType: 'album',
        link: '',
        ends: '',
      },
      episode(now, 5, 21, 'Northbound', 2, 5, 'Cold Front'),
      episode(now, 8, 20, 'Fieldwork', 1, 9, 'Season Turn', { finale: 'season' }),
    ],
    missing: [],
    days: 14,
  };
};
