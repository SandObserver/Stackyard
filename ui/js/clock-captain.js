// @ts-check

/** @param {number} hour 0 to 23 @returns {'morning' | 'day' | 'dusk' | 'night' | 'late'} */
export function partOfDay(hour) {
  if (hour >= 6 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  if (hour >= 20) return 'night';
  return 'late';
}

/** @param {() => number} [random] @returns {number} */
export function beerLevel(random = Math.random) {
  return 0.22 + random() * 0.7;
}

/** @param {number} width @param {number} size @param {number} max @param {number} [min] @returns {number} */
export function fitSize(width, size, max, min = 0) {
  if (!(width > 0)) return size;
  return Math.max(min, Math.min(size, (size * max) / width));
}

/** @param {string} before @param {string} after @returns {number[]} */
export function changedFigures(before, after) {
  const out = [];
  for (let i = 0; i < after.length; i++) if (before[i] !== after[i]) out.push(i);
  return out;
}

/** @param {string} line @returns {string[]} */
export function splitLine(line) {
  const comma = line.search(/[،,，]/);
  const space = comma < 0 ? -1 : line.indexOf(' ', comma);
  return space < 0 ? [line] : [line.slice(0, space), line.slice(space + 1)];
}
