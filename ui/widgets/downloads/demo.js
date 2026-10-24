const { arrange } = require('./download-items');

const GB = 1e9;

module.exports = function downloadsDemo(ctx) {
  const { wave, round } = ctx.demo;
  const job = (name, size, base, speed, phase) => {
    const progress = round(Math.min(0.99, base + wave(900, 0, 0.12, phase)), 3);
    const rate = round(speed * wave(40, 0.8, 1.2, phase));
    return { name, size, progress, speed: rate, eta: Math.round(((1 - progress) * size) / rate), state: 'run' };
  };
  const now = Date.now();
  return {
    ...arrange([
      job('Fedora-Workstation-Live-43.iso', 2.4 * GB, 0.8, 9.8e6, 0),
      job('Sintel.2010.mkv', 1.1 * GB, 0.5, 6.2e6, 1),
      job('ubuntu-26.04-desktop-amd64.iso', 6.1 * GB, 0.3, 11.2e6, 2),
      {
        name: 'big-buck-bunny-4k-60fps.mkv',
        size: 3.6 * GB,
        progress: 0.23,
        speed: 0,
        eta: null,
        state: 'stall',
        reason: 'noPeers',
      },
    ]),
    finished: [now - 27 * 60000, now - 2.5 * 3600000, now - 5 * 3600000],
    link: '',
  };
};
