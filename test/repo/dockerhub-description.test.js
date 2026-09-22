const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { toDockerHubDescription, MAX_LENGTH } = require('../../scripts/dockerhub-description');

const README = fs.readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8');

/* The Docker Hub page is generated from README.md at release time. Nothing on
   that page is checked by a human before it is public, and the failures are
   silent ones: a relative link 404s, the screenshot never loads, and text past
   the length limit is cut off mid-sentence with a 200 from the API. */

test('every link target is absolute', () => {
  const out = toDockerHubDescription(README);
  for (const [, target] of out.matchAll(/\]\(([^)\s]+)\)/g)) {
    assert.ok(/^https:\/\//.test(target), `relative link would 404 on Docker Hub: ${target}`);
  }
});

test('images are raw URLs, so they render rather than link to a page', () => {
  const out = toDockerHubDescription(README);
  for (const [, target] of out.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    assert.ok(
      target.startsWith('https://raw.githubusercontent.com/') || target.startsWith('https://img.shields.io/'),
      `image would not render on Docker Hub: ${target}`,
    );
  }
});

test('the centered HTML header does not survive', () => {
  const out = toDockerHubDescription(README);
  assert.doesNotMatch(out, /<\/?(?:h1|p|img|sub|b|i|a)\b/i, 'raw HTML is shown literally by Docker Hub');
});

test('pull commands name Docker Hub, and prose still points at ghcr.io', () => {
  const out = toDockerHubDescription(README);
  for (const [block] of out.matchAll(/```[\s\S]*?```/g)) {
    assert.ok(
      !block.includes('ghcr.io/sandobserver'),
      'a code sample tells the reader to pull from the other registry',
    );
  }
  assert.ok(out.includes('`ghcr.io`'), 'the signed registry is no longer mentioned');
  assert.ok(out.includes('sandobserver/stackyard:latest'), 'no Docker Hub pull example');
});

test('the table of contents is dropped, and no section is lost with it', () => {
  const out = toDockerHubDescription(README);
  assert.ok(!out.includes('## Contents'), 'anchor-only navigation Docker Hub cannot resolve');
  for (const heading of ['## Why Stackyard', '## Getting started', '## License']) {
    assert.ok(out.includes(heading), `${heading} was removed with the table of contents`);
  }
});

test('the result fits inside the Docker Hub length limit', () => {
  assert.ok(toDockerHubDescription(README).length <= MAX_LENGTH);
});

test('a README over the limit fails the build rather than being truncated', () => {
  const huge = README + 'x'.repeat(MAX_LENGTH);
  assert.throws(() => toDockerHubDescription(huge), /over Docker Hub's/);
});

test('a README with no sections fails rather than publishing the header alone', () => {
  assert.throws(() => toDockerHubDescription('# Stackyard\n\nJust a paragraph.\n'), /no `##` heading/);
});
