# Changelog

## [Unreleased]

- Sessions now expire after a configurable lifetime (default 30 days, set with
  `SESSION_MAX_AGE_DAYS`). Tokens carry a signed issued-at enforced server-side.
  Existing sessions are invalidated on upgrade, so users log in once more.
- `esc()` now escapes single quotes, closing a latent gap for values placed in
  single-quoted HTML attributes.
- Removed a dead touch-cleanup variable in the dashboard, replaced em-dashes in
  six user-facing strings, and fixed two docs typos.

---

## [1.0.0] — First public release

Stackyard is a self-hosted homelab dashboard: a calm, launcher-style grid
of app tiles, folders, and a few useful widgets. Single container, no
runtime dependencies.

- Launcher grid of apps, folders, and widgets (mobile layout included)
- Widgets: Clock, Now Playing, Weather, DNS, GitHub, Books, System Stats,
  Disk Health, Backup, Connections, Dashboard Switch
- Live activity badges from any API, configured in the UI
- Admin UI with config import/export
- 6 languages, including RTL
- SSRF-guarded requests, DNS-rebind protection, non-root container,
  multi-arch images (amd64/arm64), optional password protection

Serves plain HTTP — built for a trusted LAN, not public exposure. See
[`docs/security.md`](docs/security.md) before exposing it further.

---

## Pre-1.0.0 (summary)

Everything before 1.0.0 was iterative development, condensed here:

- **Widgets**: built out all current widgets and their provider integrations
- **Architecture**: moved from one-off widget routes to a generic,
  declarative widget system (manifest + registry + shared data endpoint)
- **Resilience**: widgets hold last-good data through brief outages instead
  of blanking; outbound fetches have hard timeouts
- **Security**: SSRF guard with IP pinning, SVG upload sanitization,
  secret stripping on export, non-root container (required a one-time
  `chown -R 1000:1000` on data/icons volumes for existing installs),
  auth hardening
- **Admin UI**: modularized, added search/filter, accessibility fixes,
  import preview
- **i18n**: full localization added
- **Tooling**: linting, type-checking, test coverage, core docs added
