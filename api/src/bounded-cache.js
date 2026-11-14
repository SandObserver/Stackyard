const SERVERS_KEPT = 32;

/** @template K, V
    @param {Map<K, V>} map @param {K} key @param {V} value @param {number} [cap]
    @returns {V} */
function remember(map, key, value, cap = SERVERS_KEPT) {
  map.delete(key);
  map.set(key, value);
  while (map.size > cap) map.delete(map.keys().next().value);
  return value;
}

module.exports = { remember, SERVERS_KEPT };
