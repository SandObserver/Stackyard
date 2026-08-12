module.exports = function booksDemo({ demo: { wave, round } }) {
  return {
    provider: 'audiobookshelf',
    source: 'unread',
    books: [
      {
        title: 'The Left Hand of Darkness',
        author: 'Ursula K. Le Guin',
        progress: round(wave(900, 0.05, 0.95), 3),
        finished: false,
        color: null,
        kind: 'book',
      },
      {
        title: 'Piranesi',
        author: 'Susanna Clarke',
        progress: round(wave(700, 0.05, 0.95, 1.7), 3),
        finished: false,
        color: null,
        kind: 'book',
      },
      {
        title: 'The Dispossessed',
        author: 'Ursula K. Le Guin',
        progress: 1,
        finished: true,
        color: null,
        kind: 'book',
      },
      {
        title: 'Klara and the Sun',
        author: 'Kazuo Ishiguro',
        progress: null,
        finished: false,
        color: null,
        kind: 'book',
      },
    ],
  };
};
