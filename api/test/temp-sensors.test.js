const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tmpDir } = require('../test-support/tmp');
const { tempSensors, sensorTemps, cpuSensor } = require('../src/metrics');

/* A minimal /sys/class with real files and device symlinks, laid out as the
   kernel does. */
function sysfs(spec) {
  const root = tmpDir('sysfs');
  const devices = path.join(root, 'devices');
  for (const [zone, z] of Object.entries(spec.thermal || {})) {
    const dir = path.join(root, 'thermal', zone);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'type'), `${z.type}\n`);
    fs.writeFileSync(path.join(dir, 'temp'), `${z.temp}\n`);
  }
  for (const [hwmon, h] of Object.entries(spec.hwmon || {})) {
    const dir = path.join(root, 'hwmon', hwmon);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'name'), `${h.name}\n`);
    if (h.device) {
      const dev = path.join(devices, h.device);
      fs.mkdirSync(dev, { recursive: true });
      fs.symlinkSync(dev, path.join(dir, 'device'));
    }
    for (const [channel, c] of Object.entries(h.temps)) {
      fs.writeFileSync(path.join(dir, `${channel}_input`), `${c.input}\n`);
      if (c.label) fs.writeFileSync(path.join(dir, `${channel}_label`), `${c.label}\n`);
    }
  }
  return root;
}

const coretemp = {
  name: 'coretemp',
  device: 'platform/coretemp.0',
  temps: { temp1: { label: 'Package id 0', input: 43000 }, temp2: { label: 'Core 0', input: 41000 } },
};
const wifi = { name: 'iwlwifi_1', device: 'virtual/thermal/thermal_zone1', temps: { temp1: { input: 42000 } } };

test('sensor ids survive hwmon and thermal zone numbers swapping at boot', () => {
  const before = sysfs({
    hwmon: { hwmon0: coretemp, hwmon1: wifi },
    thermal: {
      thermal_zone0: { type: 'iwlwifi_1', temp: 42000 },
      thermal_zone1: { type: 'x86_pkg_temp', temp: 43000 },
    },
  });
  const after = sysfs({
    hwmon: { hwmon0: wifi, hwmon1: coretemp },
    thermal: {
      thermal_zone0: { type: 'x86_pkg_temp', temp: 43000 },
      thermal_zone1: { type: 'iwlwifi_1', temp: 42000 },
    },
  });
  const keys = ['coretemp/Package id 0', 'iwlwifi_1/temp1', 'cpu'];
  const want = { 'coretemp/Package id 0': 43, 'iwlwifi_1/temp1': 42, cpu: 43 };
  assert.deepEqual(sensorTemps(keys, before), want);
  assert.deepEqual(sensorTemps(keys, after), want);
});

test('sensors are listed by chip and label with readable names', () => {
  const root = sysfs({ hwmon: { hwmon0: coretemp, hwmon1: wifi } });
  assert.deepEqual(
    tempSensors(root).map(s => [s.id, s.label]),
    [
      ['coretemp/Core 0', 'Core 0 (coretemp)'],
      ['iwlwifi_1/temp1', 'iwlwifi_1'],
      ['coretemp/Package id 0', 'Package id 0 (coretemp)'],
    ],
  );
});

test('two chips with the same name are told apart by PCI address', () => {
  const nvme = addr => ({
    name: 'nvme',
    device: `pci0000:00/${addr}/nvme/nvme0`,
    temps: { temp1: { label: 'Composite', input: 38000 } },
  });
  const root = sysfs({ hwmon: { hwmon2: nvme('0000:03:00.0'), hwmon3: nvme('0000:04:00.0') } });
  assert.deepEqual(
    tempSensors(root).map(s => [s.id, s.label]),
    [
      ['nvme@0000:03:00.0/Composite', 'Composite (nvme 0000:03:00.0)'],
      ['nvme@0000:04:00.0/Composite', 'Composite (nvme 0000:04:00.0)'],
    ],
  );
});

test('thermal zones are listed only when no hwmon chip reports a temperature', () => {
  const root = sysfs({
    thermal: { thermal_zone0: { type: 'acpitz', temp: 50000 }, thermal_zone1: { type: 'acpitz', temp: 52000 } },
  });
  assert.deepEqual(
    tempSensors(root).map(s => [s.id, s.label]),
    [
      ['zone/acpitz#1', 'acpitz #1'],
      ['zone/acpitz#2', 'acpitz #2'],
    ],
  );
  assert.equal(cpuSensor(tempSensors(root)).id, 'zone/acpitz#1');
});

test('the CPU sensor is found on Intel, AMD and a Raspberry Pi', () => {
  const amd = sysfs({
    hwmon: {
      hwmon0: {
        name: 'k10temp',
        device: 'pci0000:00/0000:00:18.3',
        temps: { temp1: { label: 'Tctl', input: 55000 }, temp3: { label: 'Tccd1', input: 50000 } },
      },
      hwmon1: { name: 'acpitz', temps: { temp1: { input: 30000 } } },
    },
  });
  const pi = sysfs({
    hwmon: {
      hwmon0: { name: 'cpu_thermal', device: 'virtual/thermal/thermal_zone0', temps: { temp1: { input: 48000 } } },
    },
  });
  const intelZonesOnly = sysfs({
    thermal: {
      thermal_zone0: { type: 'iwlwifi_1', temp: 42000 },
      thermal_zone1: { type: 'x86_pkg_temp', temp: 43000 },
    },
  });
  assert.deepEqual(sensorTemps(['cpu'], amd), { cpu: 55 });
  assert.deepEqual(sensorTemps(['cpu'], pi), { cpu: 48 });
  assert.deepEqual(sensorTemps(['cpu'], intelZonesOnly), { cpu: 43 });
});

test('no CPU sensor gives no reading rather than another sensor', () => {
  const root = sysfs({ hwmon: { hwmon0: wifi } });
  assert.deepEqual(sensorTemps(['cpu'], root), {});
});

test('a legacy slot keeps reading its thermal zone by number', () => {
  const root = sysfs({
    thermal: {
      thermal_zone0: { type: 'x86_pkg_temp', temp: 43000 },
      thermal_zone1: { type: 'iwlwifi_1', temp: 42000 },
    },
  });
  assert.deepEqual(sensorTemps(['thermal_zone1', 0], root), { thermal_zone1: 42, 0: 43 });
});

test('a sensor that is gone gives no reading', () => {
  const root = sysfs({ hwmon: { hwmon0: coretemp } });
  assert.deepEqual(sensorTemps(['nvme/Composite', 'thermal_zone7'], root), {});
});

test('an older kernel keeps the attributes under the device folder', () => {
  const root = tmpDir('sysfs-old');
  const dir = path.join(root, 'hwmon', 'hwmon0', 'device');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'name'), 'coretemp\n');
  fs.writeFileSync(path.join(dir, 'temp1_input'), '44000\n');
  fs.writeFileSync(path.join(dir, 'temp1_label'), 'Package id 0\n');
  assert.deepEqual(sensorTemps(['cpu'], root), { cpu: 44 });
});
