const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* The Community Applications template and profile. A wrong value here is not a
   build failure: it is a listing that installs an unreachable container, or one
   that loses its configuration on the next update. */

const ROOT = path.join(__dirname, '..', '..');
const REPO = 'SandObserver/Stackyard';
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;

const template = fs.readFileSync(path.join(ROOT, 'templates', 'stackyard.xml'), 'utf8');
const profile = fs.readFileSync(path.join(ROOT, 'ca_profile.xml'), 'utf8');

const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
};

test('the template declares a name and a repository', () => {
  assert.equal(tag(template, 'Name'), 'Stackyard');
  assert.equal(tag(template, 'Repository'), 'ghcr.io/sandobserver/stackyard:latest');
});

test('the profile has a non-empty description', () => {
  const body = /<Profile>\s*<Profile>([\s\S]*?)<\/Profile>/.exec(profile);
  assert.ok(body && body[1].trim().length > 40, 'ca_profile.xml needs a real Profile paragraph');
});

test('TemplateURL points at this file on the default branch', () => {
  assert.equal(tag(template, 'TemplateURL'), `${RAW}/templates/stackyard.xml`);
});

/* [PORT:x] names the container port, not the published one. Unraid swaps in
   whichever host port maps to it. Writing 8700 there leaves the WebUI button
   pointing at a port the container does not listen on. */
test('the WebUI port token matches the container port, not the host port', () => {
  const webui = tag(template, 'WebUI');
  const port = /<Config[^>]*Type="Port"[^>]*>/.exec(template)[0];
  const target = /Target="(\d+)"/.exec(port)[1];
  const host = /Default="(\d+)"/.exec(port)[1];
  assert.equal(target, '80');
  assert.equal(host, '8700');
  assert.equal(webui, `http://[IP]:[PORT:${target}]`);
});

test('config and icon storage are both mapped, or an update wipes them', () => {
  for (const target of ['/data', '/icons']) {
    assert.ok(
      new RegExp(`<Config[^>]*Target="${target}"[^>]*Type="Path"`).test(template),
      `${target} must be a Path config`,
    );
  }
});

test('every referenced asset exists in the repo', () => {
  const assets = {
    [tag(template, 'Icon')]: 'templates/icon.svg',
    [tag(template, 'Screenshot')]: 'docs/screenshot.png',
  };
  for (const [url, file] of Object.entries(assets)) {
    assert.equal(url, `${RAW}/${file}`, `${file} must be referenced by its raw URL`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is referenced but missing`);
  }
});

test('the legacy light and dark icons ship alongside the tile icon', () => {
  for (const f of ['templates/icon.svg', 'templates/icon-light.svg', 'templates/icon-dark.svg']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
  }
});

test('both documents use the repository path with its real capitalisation', () => {
  for (const [name, xml] of [
    ['stackyard.xml', template],
    ['ca_profile.xml', profile],
  ]) {
    const wrong = xml.match(/github(?:usercontent)?\.com\/(?!SandObserver\/Stackyard)[A-Za-z]+\/[Ss]tackyard/g);
    assert.equal(wrong, null, `${name} refers to the repo by a redirecting path: ${wrong}`);
  }
});

test('the donation link is the canonical form', () => {
  for (const xml of [template, profile]) {
    assert.equal(tag(xml, 'DonateLink'), 'https://buymeacoffee.com/sandobserver');
    assert.ok(tag(xml, 'DonateText'));
  }
});
