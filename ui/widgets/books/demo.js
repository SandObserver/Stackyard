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
  ['Ancillary Justice', 'Ann Leckie'],
  ['The Three-Body Problem', 'Liu Cixin'],
  ['Hyperion', 'Dan Simmons'],
  ['Blindsight', 'Peter Watts'],
  ['The Sparrow', 'Mary Doria Russell'],
  ['Void Star', 'Zachary Mason'],
  ['Semiosis', 'Sue Burke'],
  ['The Book of Strange New Things', 'Michel Faber'],
  ['A Canticle for Leibowitz', 'Walter M. Miller Jr.'],
  ['Gnomon', 'Nick Harkaway'],
  ['The Peripheral', 'William Gibson'],
  ['Version Control', 'Dexter Palmer'],
];

module.exports = function booksDemo({ demo: { wave, round } }) {
  const shelf = (source, offset) => ({
    source,
    books: TITLES.slice(offset, offset + 16).map(([title, author], i) => {
      const n = offset + i;
      const finished = n % 5 === 2;
      const unread = source === 'unread' || n % 5 === 3;
      return {
        title,
        author,
        progress: finished ? 1 : unread ? null : round(wave(700 + n * 60, 0.05, 0.95, 1.7 * n), 3),
        finished,
        color: null,
        kind: 'book',
      };
    }),
  });
  return {
    provider: 'audiobookshelf',
    shelves: [shelf('unread', 0), shelf('recently', 8), shelf('list', 12)],
  };
};
