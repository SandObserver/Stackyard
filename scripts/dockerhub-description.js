#!/usr/bin/env node
/* Rewrites README.md into the text Docker Hub shows on the repository page.

   Docker Hub renders the file on its own, away from the repo: a relative link
   resolves against hub.docker.com and 404s, the screenshot never loads, and the
   centered HTML the GitHub header uses is passed through as literal markup. The
   pull commands also name the wrong registry for the page they are sitting on.

   Everything above the first `##` is the hand-written HTML header, so it is
   replaced wholesale rather than translated; the rest is rewritten by rule and
   needs no upkeep when the README changes. */

const fs = require('node:fs');
const path = require('node:path');

const REPO = 'SandObserver/stackyard';
const BRANCH = 'main';
const BLOB = `https://github.com/${REPO}/blob/${BRANCH}`;
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const README_URL = `https://github.com/${REPO}#`;

/* Docker Hub truncates silently past this, mid-sentence, with no error from the
   API. Failing the build is the only way to notice. */
const MAX_LENGTH = 25000;

const GHCR_IMAGE = 'ghcr.io/sandobserver/stackyard';
const HUB_IMAGE = 'sandobserver/stackyard';

/* The GitHub header is centered HTML: a title, badges, a screenshot and the
   demo link. This is the same content in the markdown subset Docker Hub
   renders. */
const HEADER = `# Stackyard

**A self-hosted homelab dashboard you actually want to look at.**

[![ghcr.io](https://img.shields.io/badge/ghcr.io-stackyard-2496ED?logo=github&logoColor=white)](https://github.com/${REPO}/pkgs/container/stackyard)
[![Docker Hub](https://img.shields.io/badge/docker%20hub-stackyard-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/${HUB_IMAGE})
[![Latest release](https://img.shields.io/github/v/release/${REPO})](https://github.com/${REPO}/releases)

![Stackyard dashboard](${RAW}/docs/screenshot.png)

Try it: **[stackyard-demo.onrender.com](https://stackyard-demo.onrender.com)**
The first demo visit may take up to a minute due to Render's free-tier cold start.

Source, issues and full documentation: **[github.com/${REPO}](https://github.com/${REPO})**
`;

/** Everything before the first `##` heading, replaced by the markdown header.
    @param {string} md @returns {string} */
function replaceHeader(md) {
  const first = md.indexOf('\n## ');
  if (first === -1) throw new Error('dockerhub-description: no `##` heading found in README.md');
  return `${HEADER}${md.slice(first)}`;
}

/** Drops a whole `## <title>` section, heading included. Used for the table of
    contents, which is navigation for a long GitHub page and whose anchors
    Docker Hub does not generate.

    @param {string} md @param {string} title @returns {string} */
function dropSection(md, title) {
  const start = md.indexOf(`\n## ${title}\n`);
  if (start === -1) return md;
  const next = md.indexOf('\n## ', start + 1);
  return md.slice(0, start) + (next === -1 ? '\n' : md.slice(next));
}

/** Rewrites every markdown link and image target that Docker Hub cannot
    resolve: a repo-relative path becomes a github.com URL (raw for images, so
    they render rather than link), and a bare `#anchor` becomes the same anchor
    on the GitHub README.

    @param {string} md @returns {string} */
function absolutiseLinks(md) {
  return md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, bang, text, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return whole;
    if (target.startsWith('#')) return `${bang}[${text}](${README_URL}${target.slice(1)})`;
    const [file, fragment] = target.split('#');
    const base = bang ? RAW : BLOB;
    return `${bang}[${text}](${base}/${file}${fragment ? `#${fragment}` : ''})`;
  });
}

/** Inside fenced code blocks only, names the registry the reader is already on.
    Prose keeps saying ghcr.io, which is where the release signature points.

    @param {string} md @returns {string} */
function useHubImage(md) {
  return md.replace(/```[\s\S]*?```/g, block => block.split(GHCR_IMAGE).join(HUB_IMAGE));
}

/** @param {string} readme @returns {string} */
function toDockerHubDescription(readme) {
  let md = replaceHeader(readme);
  md = dropSection(md, 'Contents');
  md = absolutiseLinks(md);
  md = useHubImage(md);
  md = `${md.trimEnd()}\n`;
  if (md.length > MAX_LENGTH) {
    throw new Error(
      `dockerhub-description: ${md.length} characters, over Docker Hub's ${MAX_LENGTH} limit; shorten README.md`,
    );
  }
  return md;
}

module.exports = { toDockerHubDescription, MAX_LENGTH };

/* CLI: README.md in, description on stdout, for the workflow to redirect to a
   file the description action reads. */
if (require.main === module) {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  process.stdout.write(toDockerHubDescription(readme));
}
