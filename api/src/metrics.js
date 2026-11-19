const fs = require('fs');
const path = require('path');

/* A kernel reporting fewer fields yields undefined. That becomes NaN and
   poisons every later result. */
function readCpuStat() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const [, ...rest] = line.trim().split(/\s+/);
  const [user, nice, sys, idle, iowait, irq, softirq, steal] = rest.map(v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
  const total = user + nice + sys + idle + iowait + irq + softirq + steal;
  return { total, busy: total - idle - iowait, iowait };
}

const _pct = v => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);

function computeCpu(a, b) {
  const dt = b.total - a.total;
  if (dt <= 0) return { cpu: 0, iowait: 0 };
  return {
    cpu: _pct(((b.busy - a.busy) / dt) * 100),
    iowait: _pct(((b.iowait - a.iowait) / dt) * 100),
  };
}

async function cpuSample() {
  const a = readCpuStat();
  await new Promise(r => setTimeout(r, 500));
  return computeCpu(a, readCpuStat());
}

/* The 4th field of /proc/loadavg is "runnable/total". */
function procCount() {
  try {
    const f = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/);
    const total = (f[3] || '').split('/')[1];
    return parseInt(total, 10) || 0;
  } catch {
    return 0;
  }
}

/* The first field of /proc/uptime is seconds. */
function uptimeSeconds() {
  try {
    const v = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]);
    return Number.isFinite(v) ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

/* MemAvailable is absent on some kernels and container setups. Treating it as 0
   reports every machine at 100% used. */
function ramPercent() {
  const text = fs.readFileSync('/proc/meminfo', 'utf8');
  const get = key => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? parseInt(m[1], 10) : null;
  };
  const total = get('MemTotal');
  if (!total || total <= 0) return 0;

  let avail = get('MemAvailable');
  if (avail === null) {
    avail = (get('MemFree') || 0) + (get('Buffers') || 0) + (get('Cached') || 0) + (get('SReclaimable') || 0);
  }
  if (!Number.isFinite(avail) || avail < 0 || avail > total) return 0;
  return ((total - avail) / total) * 100;
}

const SYS_CLASS = '/sys/class';
const PCI_ADDRESS = /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/i;
const I2C_CLIENT = /^\d+-([0-9a-f]{4})$/i;

function _text(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function _entries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function _milliDegrees(file) {
  const raw = _text(file);
  if (raw === null) return null;
  const val = parseInt(raw, 10);
  return Number.isNaN(val) ? null : parseFloat((val / 1000).toFixed(1));
}

function zoneTemp(zone, root = SYS_CLASS) {
  return _milliDegrees(path.join(root, 'thermal', `thermal_zone${zone}`, 'temp'));
}

const _natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const _shape = name => name.replace(/\d+/g, '#');

/* Kernel instance numbers below a PCI function (ataN, hostN, i2c-N) follow
   probe order. Never put one in a key. */
function _device(dir) {
  let real;
  try {
    real = fs.realpathSync(path.join(dir, 'device'));
  } catch {
    return { key: '', bus: false, path: '' };
  }
  const parts = real.split(path.sep);
  const at = parts.findLastIndex(p => PCI_ADDRESS.test(p));
  if (at < 0) {
    const key = parts.includes('virtual') ? '' : path.basename(real);
    return { key, bus: false, path: real };
  }
  const key = [parts[at].toLowerCase()];
  let parent = parts.slice(0, at + 1).join(path.sep);
  for (const part of parts.slice(at + 1)) {
    const i2c = I2C_CLIENT.exec(part);
    if (i2c) key.push(i2c[1].toLowerCase());
    else if (/\d/.test(part)) {
      const same = _entries(parent)
        .filter(e => _shape(e) === _shape(part))
        .sort(_natural);
      if (same.length > 1) key.push(`${part.replace(/[^a-z]/gi, '')}${same.indexOf(part) + 1}`);
    }
    parent = path.join(parent, part);
  }
  return { key: key.join('-'), bus: true, path: real };
}

/** @typedef {{ chip: string, device: string, bus: boolean, path: string, channel: string, label: string,
      alone: boolean, zone: boolean, file: string, id: string, qualifier: string, raw: string }} Sensor */

/** @param {Partial<Sensor> & { chip: string, file: string }} fields @returns {Sensor} */
const _sensor = fields => ({
  device: '',
  bus: false,
  path: '',
  channel: '',
  label: '',
  alone: true,
  zone: false,
  id: '',
  qualifier: '',
  raw: '',
  ...fields,
});

/* Older kernels keep the attributes under hwmonN/device. */
function _hwmonSensors(root) {
  /** @type {Sensor[]} */
  const out = [];
  for (const entry of _entries(path.join(root, 'hwmon'))) {
    const top = path.join(root, 'hwmon', entry);
    const dir = _text(path.join(top, 'name')) !== null ? top : path.join(top, 'device');
    const chip = _text(path.join(dir, 'name'));
    if (!chip) continue;
    const channels = _entries(dir)
      .flatMap(f => {
        const m = /^(temp\d+)_input$/.exec(f);
        return m ? [m[1]] : [];
      })
      .sort(_natural);
    const device = _device(top);
    for (const channel of channels) {
      const label = _text(path.join(dir, `${channel}_label`)) || '';
      out.push(
        _sensor({
          chip,
          device: device.key,
          bus: device.bus,
          path: device.path,
          channel,
          label,
          alone: channels.length === 1,
          file: path.join(dir, `${channel}_input`),
        }),
      );
    }
  }
  return out;
}

function _zoneSensors(root) {
  const zones = _entries(path.join(root, 'thermal'))
    .filter(e => /^thermal_zone\d+$/.test(e))
    .sort(_natural);
  /** @type {Sensor[]} */
  const out = [];
  for (const zone of zones) {
    const dir = path.join(root, 'thermal', zone);
    const type = _text(path.join(dir, 'type'));
    if (!type) continue;
    const device = _device(dir);
    out.push(
      _sensor({
        chip: type,
        zone: true,
        device: device.key,
        bus: device.bus,
        path: device.path,
        file: path.join(dir, 'temp'),
      }),
    );
  }
  return out;
}

function _countBy(list, key) {
  const counts = new Map();
  for (const s of list) counts.set(key(s), (counts.get(key(s)) || 0) + 1);
  return counts;
}

/* An id must name the same physical sensor after a reboot. hwmonN and
   thermal_zoneN numbers follow driver load order, so neither may appear in an
   id. A bus device is always keyed, or its id changes when an identical
   device is added or removed. */
/** @param {Sensor[]} list */
function _name(list) {
  const base = s => (s.zone ? `zone/${s.chip}` : `${s.chip}/${s.label || s.channel}`);
  const keyed = s => (s.zone ? `zone/${s.chip}@${s.device}` : `${s.chip}@${s.device}/${s.label || s.channel}`);
  const shared = _countBy(list, base);
  for (const s of list) {
    const clash = shared.get(base(s)) > 1;
    s.id = s.device && (s.bus || clash) ? keyed(s) : base(s);
    if (clash && s.device) s.qualifier = s.device;
  }
  const left = _countBy(list, s => s.id);
  const seen = new Map();
  const byPlace = [...list].sort((a, b) => _natural(a.path, b.path) || _natural(a.channel, b.channel));
  for (const s of byPlace) {
    if (left.get(s.id) < 2) continue;
    const n = (seen.get(s.id) || 0) + 1;
    seen.set(s.id, n);
    s.qualifier = s.qualifier ? `${s.qualifier} #${n}` : `#${n}`;
    s.id = `${s.id}#${n}`;
  }
  for (const s of list) {
    s.raw = s.label || '';
    const chip = s.qualifier ? `${s.chip} ${s.qualifier}` : s.chip;
    if (s.zone || (!s.label && s.alone)) s.label = chip;
    else s.label = s.label ? `${s.label} (${chip})` : `${chip} ${s.channel}`;
  }
  return list;
}

/** Temperature sensors by stable id. Thermal zones are read only when no hwmon
    chip reports a temperature.
    @returns {{ id: string, label: string, chip: string, raw: string, file: string }[]} */
function tempSensors(root = SYS_CLASS) {
  let list = _hwmonSensors(root);
  if (!list.length) list = _zoneSensors(root);
  return _name(list)
    .map(({ id, label, chip, raw, file }) => ({ id, label, chip, raw, file }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
}

function _cpuRank(s) {
  const chip = s.chip.toLowerCase();
  const label = s.raw;
  const amd = chip === 'k10temp' || chip === 'zenpower';
  if (chip === 'coretemp' && /^Package id \d+$/.test(label)) return 0;
  if (amd && label === 'Tdie') return 1;
  if (amd && label === 'Tctl') return 2;
  if (/^(cpu|soc)[-_]thermal$/.test(chip)) return 3;
  if (chip === 'x86_pkg_temp') return 4;
  if (chip === 'coretemp' || amd) return 5;
  if (chip === 'acpitz') return 6;
  return null;
}

function cpuSensor(sensors) {
  let best = null;
  let bestRank = Infinity;
  for (const s of [...sensors].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) {
    const rank = _cpuRank(s);
    if (rank !== null && rank < bestRank) {
      best = s;
      bestRank = rank;
    }
  }
  return best;
}

const LEGACY_ZONE = /^thermal_zone(\d+)$/;

/** Readings for the keys a widget asks for: "cpu", a sensor id, or a thermal
    zone number in either legacy form. Keys with no reading are left out.
    @param {(string|number)[]} keys @returns {Record<string, number>} */
function sensorTemps(keys, root = SYS_CLASS) {
  /** @type {ReturnType<typeof tempSensors> | null} */
  let sensors = null;
  const all = () => {
    sensors ??= tempSensors(root);
    return sensors;
  };
  /** @type {Record<string, number>} */
  const out = {};
  for (const key of new Set(keys)) {
    /** @type {number | null} */
    let value = null;
    const legacy = Number.isInteger(key) ? key : LEGACY_ZONE.exec(String(key))?.[1];
    if (legacy !== undefined) value = zoneTemp(legacy, root);
    else {
      const s = key === 'cpu' ? cpuSensor(all()) : all().find(x => x.id === key);
      if (s) value = _milliDegrees(s.file);
    }
    if (value !== null) out[key] = value;
  }
  return out;
}

function diskStats(mountPoint) {
  try {
    const s = fs.statfsSync(mountPoint);
    const total = s.blocks * s.bsize,
      avail = s.bavail * s.bsize;
    return { usedPct: total > 0 ? ((total - avail) / total) * 100 : 0, totalGb: total / 1024 ** 3 };
  } catch {
    return { usedPct: 0, totalGb: 0 };
  }
}

module.exports = {
  cpuSample,
  computeCpu,
  ramPercent,
  zoneTemp,
  tempSensors,
  cpuSensor,
  sensorTemps,
  diskStats,
  procCount,
  uptimeSeconds,
};
