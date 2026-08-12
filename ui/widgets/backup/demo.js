module.exports = function backupDemo({ config }) {
  const slots = Array.isArray(config?.slots) ? config.slots : [];
  const now = Date.now();
  return slots.map((s, i) => ({
    id: 'demo-' + i,
    name: s.customName || 'Backup',
    provider: s.provider || 'duplicati',
    status: 'healthy',
    lastFinished: new Date(now - 3 * 3600 * 1000).toISOString(),
    nextRun: new Date(now + 21 * 3600 * 1000).toISOString(),
    size: '42.7 GB',
    href: '',
  }));
};
