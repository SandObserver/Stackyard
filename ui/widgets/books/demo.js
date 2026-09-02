const TITLES = [
  ['The Left Hand of Darkness', 'Ursula K. Le Guin'],
  ['Piranesi', 'Susanna Clarke'],
  ['The Dispossessed', 'Ursula K. Le Guin'],
  ['Klara and the Sun', 'Kazuo Ishiguro'],
  ['A Memory Called Empire', 'Arkady Martine'],
  ['The Vanished Birds', 'Simon Jimenez'],
  ['Station Eleven', 'Emily St. John Mandel'],
  ['The City and the City', 'China Mieville'],
  ['Solaris', 'Stanislaw Lem'],
  ['The Fifth Season', 'N. K. Jemisin'],
  ['Never Let Me Go', 'Kazuo Ishiguro'],
  ['Roadside Picnic', 'Arkady and Boris Strugatsky'],
  ['Annihilation', 'Jeff VanderMeer'],
  ['The Doors of Eden', 'Adrian Tchaikovsky'],
  ['Exhalation', 'Ted Chiang'],
  ['The Employees', 'Olga Ravn'],
];

module.exports = function booksDemo({ demo: { wave, round } }) {
  return {
    provider: 'audiobookshelf',
    source: 'unread',
    books: TITLES.map(([title, author], i) => {
      const finished = i % 5 === 2;
      const unread = i % 5 === 3;
      return {
        title,
        author,
        progress: finished ? 1 : unread ? null : round(wave(700 + i * 60, 0.05, 0.95, 1.7 * i), 3),
        finished,
        color: null,
        kind: 'book',
      };
    }),
  };
};
