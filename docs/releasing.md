# Releasing

A release is two merges and no local commands.

## Cutting a release

1. Run the **Release prep** workflow from the Actions tab. Give the version
   without the leading `v`, for example `1.8.0`.
2. It dates the `[Unreleased]` section, adds the compare link, bumps
   `api/package.json`, pins the demo image in `render.yaml`, and opens a
   `Release: X.Y.Z` pull request.
3. Review the dated section. Merge when the checks pass.
4. The merge tags `vX.Y.Z`. The tag builds, scans, signs and pushes the image,
   then publishes the release page from that changelog section.
5. The published release opens a second pull request with the Community
   Applications template. Merge it.

Nothing else is manual. A `Release X.Y.Z` commit made by hand is no longer part
of the process.

## What decides the version

`[Unreleased]` holds the entries. The version is yours to choose: an addition
that only touches tooling or documentation is a patch, not a minor. The
changelog gate prints the bump its entries imply and does not enforce it.

## Pre-releases

Tag `vX.Y.Z-beta.N` for a public pre-release. Any semver prerelease identifier
keeps `latest`, the Docker Hub description and the demo on the last stable
release, and marks the release page as a pre-release. See
`scripts/is-prerelease.js`.

## Requirements

The prep, tagging and release-page steps authenticate as a GitHub App, through
the `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets. The app needs
Contents and Pull requests write access. Without it the release cannot proceed:
the built-in token cannot push to the protected default branch, and a tag or a
release it creates starts no workflow run, so nothing would build.

## When a release build fails

The tag stays and nothing publishes. Fix `main`, delete the tag locally and on
the remote, then push it again.
