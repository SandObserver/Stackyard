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

## The release app

Every write in the release runs as a GitHub App. The built-in `GITHUB_TOKEN`
cannot push to the protected default branch, and a tag or a release it creates
starts no workflow run, so the image would never build and the Community
Applications template would never update.

Create it once, under **Settings > Developer settings > GitHub Apps > New GitHub
App** on the account that owns the repository:

1. Name it `stackyard-release`. Homepage URL can be the repository URL.
2. Clear **Webhook > Active**. The app receives nothing.
3. Repository permissions: **Contents: Read and write**, **Pull requests: Read
   and write**. Nothing else. Metadata read-only is added automatically.
4. Create the app, then **Generate a private key** and keep the downloaded
   `.pem`.
5. **Install App** on this repository only.
6. In the repository, add two secrets under **Settings > Secrets and variables >
   Actions**: `RELEASE_APP_CLIENT_ID` is the app's Client ID, not its App ID,
   and `RELEASE_APP_PRIVATE_KEY` is the whole `.pem` file including the
   `-----BEGIN` and `-----END` lines.

The app needs no ruleset bypass. It opens pull requests rather than pushing to
the default branch, and the ruleset covers branches, not tags.

## The documentation site

The site at https://stackyard.sandobserver.com builds its changelog, its
development page and its release badge from this repository. Its host builds
only on a push to its own repository, so a release here does not update it on
its own.

The `docs-rebuild` job asks the host to build after a stable release. It reads
one secret, `DOCS_DEPLOY_HOOK_URL`, added under **Settings > Secrets and
variables > Actions**. Create the hook in the Cloudflare Pages project under
**Settings > Builds and deployments > Deploy hooks**, pointed at `main`.

The URL is the credential. Anyone holding it can trigger a build. It is never
printed in a log.

Without the secret the job reports that nothing was requested and the release
still succeeds. An rc tag never triggers a rebuild.

## When a release build fails

The tag stays and nothing publishes. Fix `main`, delete the tag locally and on
the remote, then push it again.
