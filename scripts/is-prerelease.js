#!/usr/bin/env node
/* Does this tag name a stable release, or a candidate? The answer decides
   whether the build moves `latest`, which is what an unpinned pull gets.

   Anything that is not valid semver is reported as a prerelease, so a mistyped
   tag such as `v1.5` cannot move `latest`. Not api/src/semver.js: that one
   coerces malformed input rather than rejecting it. */

/* semver.org's own recommended pattern, with an optional leading v for git tag
   style. Note what it rejects: leading zeroes in the core, an empty prerelease
   identifier, a trailing dot. */
const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Parse a tag name. Returns null when it is not a valid version.

    @param {unknown} ref
    @returns {{ major: number, minor: number, patch: number, prerelease: string|null, build: string|null }|null} */
function parseTag(ref) {
  const m = SEMVER.exec(String(ref ?? '').trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
    build: m[5] ?? null,
  };
}

/** True when this tag must not move `latest`: a release candidate, or anything
    that is not a version at all.

    @param {unknown} ref @returns {boolean} */
function isPrerelease(ref) {
  const parsed = parseTag(ref);
  if (!parsed) return true; /* unparseable: never treat as stable */
  return parsed.prerelease !== null;
}

/** Why, in one line, for the build log. @param {unknown} ref @returns {string} */
function explain(ref) {
  const parsed = parseTag(ref);
  if (!parsed) return `${ref}: not a valid semver version, treated as a prerelease so latest is not moved`;
  if (parsed.prerelease) return `${ref}: prerelease "${parsed.prerelease}", latest is not moved`;
  return `${ref}: stable release, latest will be moved`;
}

module.exports = { parseTag, isPrerelease, explain };

/* CLI: writes a line in the shape GitHub Actions reads from $GITHUB_OUTPUT, so
   the workflow can redirect it there directly. The explanation goes to stderr
   to keep stdout parseable. */
if (require.main === module) {
  const ref = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '';
  if (!ref) {
    console.error('is-prerelease: no tag given, and GITHUB_REF_NAME is unset');
    process.exit(1);
  }
  console.error(`is-prerelease: ${explain(ref)}`);
  console.log(`prerelease=${isPrerelease(ref)}`);
}
