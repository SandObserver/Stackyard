# Security Policy

## Supported versions

Stackyard is released from `main`. Security fixes land there and ship in the next tagged release. Please run a recent release before reporting.

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability reporting](https://github.com/SandObserver/stackyard/security/advisories/new). Please do not open a public issue for a suspected vulnerability.

Include the affected version or commit, a description of the issue, and steps to reproduce where possible. You can expect an initial response within a few days.

## How a report is handled

1. You get an initial response within a few days, confirming the report was
   received.
2. The report is reproduced and its impact assessed. You are told what was
   concluded, including when the conclusion is that it is not a vulnerability.
3. A fix lands on `main` and ships in the next tagged release. A fix for a
   critical issue is released on its own, without waiting for other work.
4. A GitHub Security Advisory is published naming the affected versions and the
   release that fixes them, and the CHANGELOG entry records it. The reporter is
   credited unless they ask not to be.

The target is a released fix within 60 days of confirming a report. Nothing is
disclosed publicly before the fix is available, unless the issue is already
public.

## Secrets and credentials used by the project

This section is about the project's own credentials. For how the application
stores the secrets you enter into it, see
[docs/security.md](docs/security.md#secrets).

- CI credentials are GitHub Actions secrets. Only a maintainer can read or
  change them. The list of who that is, and what else they hold, is in
  [GOVERNANCE.md](GOVERNANCE.md).
- Writes made during a release run as a GitHub App with a short-lived token,
  minted per run. No long-lived personal token is stored.
- Release images are signed with keyless cosign, so there is no signing key to
  store, rotate or lose.
- Secret scanning and push protection are enabled on the repository. A commit
  carrying a recognised credential is rejected at push time.
- A credential is rotated when a maintainer leaves the project, and immediately
  if it may have been exposed.

## Dependency and image scanning

Trivy scans the container image on every pull request, again during the release
build for both published platforms, and weekly against the image on `ghcr.io`.

The threshold is the same in all three places: a HIGH or CRITICAL finding with a
fix available fails the run. On a pull request that blocks the merge, and during
a release it blocks publication. Findings with no fix available do not block,
because there is nothing to upgrade to; they are handled by the weekly scan once
a fix exists.

Dependabot proposes minor and patch updates weekly for the development tooling,
the pinned base image and the pinned GitHub Actions. Major updates are taken by
hand.

The API ships no runtime npm dependencies, so a dependency added there is a
decision, not a routine bump. Anything added must be under an OSI-approved
license compatible with Apache-2.0.

## Scope and threat model

Stackyard serves plain HTTP and is designed to run on a trusted LAN, not on the public internet. Its authentication is not an internet-facing security boundary. Some features trade safety for convenience and are opt-in with warnings.

The outbound-request guard protects against a compromised or malicious widget reaching internal addresses, not against a malicious administrator: anyone who can edit the config already has full config-write access.

See [docs/security.md](docs/security.md) for the detailed security model.
