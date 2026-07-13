# Security Policy

## Supported versions

Stackyard is released from `main`. Security fixes land there and ship in the next tagged release. Please run a recent release before reporting.

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability reporting](https://github.com/SandObserver/stackyard/security/advisories/new). Please do not open a public issue for a suspected vulnerability.

Include the affected version or commit, a description of the issue, and steps to reproduce where possible. You can expect an initial response within a few days.

## Scope and threat model

Stackyard serves plain HTTP and is designed to run on a trusted LAN, not on the public internet. Its authentication simplifies managing local dashboards and is not an internet-facing security boundary. Some features trade safety for convenience and are opt-in with warnings.

The outbound-request guard protects against a compromised or malicious widget reaching internal addresses, not against a malicious administrator: anyone who can edit the config already has full config-write access.

See [docs/security.md](docs/security.md) for the detailed security model.
