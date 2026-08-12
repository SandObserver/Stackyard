module.exports = function dnsDemo({ demo: { wave } }) {
  const total = Math.round(wave(600, 46000, 52000));
  const blocked = Math.round(total * 0.19);
  const hourly = base =>
    Array.from({ length: 24 }, (_, h) => Math.round(base * (0.4 + 0.6 * Math.abs(Math.sin(h / 3.8)))));
  return {
    num_dns_queries: total,
    num_blocked_filtering: blocked,
    num_cached: Math.round(total * 0.31),
    num_forwarded: Math.round(total * 0.5),
    dns_queries: hourly(total / 24),
    blocked_filtering: hourly(blocked / 24),
  };
};
