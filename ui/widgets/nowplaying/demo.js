module.exports = function nowplayingDemo({ demo: { wave, round } }) {
  return {
    provider: 'jellyfin',
    sessions: [
      {
        id: 'demo-film',
        title: 'Interstellar',
        subtitle: '2014 · 2160p',
        progress: round(wave(300, 0.04, 0.96), 3),
        state: 'playing',
        type: 'movie',
        player: 'Living Room TV',
      },
      {
        id: 'demo-music',
        title: 'Time',
        subtitle: 'Hans Zimmer',
        progress: round(wave(220, 0.04, 0.96, 2), 3),
        state: 'paused',
        type: 'audio',
        player: 'Kitchen Speaker',
      },
    ],
  };
};
