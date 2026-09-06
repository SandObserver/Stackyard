# Governance

## Maintainers

Stackyard has one maintainer, [@SandObserver](https://github.com/SandObserver).

The maintainer holds every permission that matters: administrator access to this
repository, the GitHub Actions secrets, the GitHub App used by the release
workflow, the `ghcr.io` and Docker Hub accounts the image is published to, and
the domain and deployment for the documentation site. No other account holds any
of these.

Reach the maintainer at sandobserver@proton.me. Use the
[private reporting route](SECURITY.md) for anything security related.

## Roles

**Maintainer.** Reviews and merges pull requests, decides what the project
accepts, cuts releases, and responds to vulnerability reports.

**Contributor.** Anyone who opens an issue or a pull request. Contributors hold
no permissions on the repository.

## How decisions are made

The maintainer decides. Direction, scope and release timing are not put to a
vote.

Disagreement is settled in public, in the issue or pull request it concerns.
[CONTRIBUTING.md](CONTRIBUTING.md) lists the constraints a change has to keep;
a change that breaks one of them is refused there, with the reason.

A feature that would add a runtime dependency or a build step is discussed in an
issue before any code is written.

## Granting access

Write access is granted only by the maintainer, and only to someone with a
record of merged contributions to this repository. Reviewing that record is the
whole of the vetting.

Access is granted in stages, not at once. Repository write comes first.
Access to secrets, to the registry accounts and to the release path is a
separate decision, made later.

Access is removed when someone stops maintaining the project.

## Continuity

The project depends on one person. If that person stops, issues, merges and
releases stop with them, and nothing published so far keeps moving on its own.

The Apache-2.0 license means the work can be forked and continued by anyone at
any time, without permission. A fork must use its own name, as
[NOTICE](NOTICE) explains.
