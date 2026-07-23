# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Widget settings can declare a `color` field, rendered with the same colour
  control used elsewhere in the admin interface.
- Widget settings can declare an `object` field, rendered as its own card of
  nested settings.
- Widget settings can declare the same key more than once with different labels,
  each shown by a `showIf` condition.
- A widget view can limit which sizes it offers.

### Changed

- Connections widget now uses the standard widget settings form. Each service
  is a settings card, and the fields shown follow the service type.

- Widget settings rows in a repeating section now show and hide independently,
  and a dropdown in one can load its options from the service that row points at.
- Weather widget now uses the standard widget settings form. Location is set by
  typing a city, pressing Fetch and picking a match; "feels like" is a toggle.

### Removed

- `GET /api/geocode-proxy`. City search now runs through the widget's own data
  function.

### Security

- TrueNAS API key is no longer sent in a URL query string when fetching pools.

### Fixed

- Saving a widget with a required password or key left blank is now refused
  instead of saving an unusable widget.

- Widgets no longer show a stale cached version after an update. Each widget's
  frontend files are now cache-busted automatically from their content, the same
  way the rest of the interface already was.

## [1.3.1] - 2026-07-20

### Security

- Backup job and source discovery now routes the entered URL through the SSRF
  guard. If your backup server is on a private IP, set `ALLOW_PRIVATE_IPS=true`.
- Widget config preview now routes the entered URL through the SSRF guard.
- SSRF guard now blocks `http://localhost` by name.
- Parallel login attempts are now rate-limited correctly.

### Fixed

- A config file that parses but has the wrong shape no longer crashes the
  server.
- An error in a request handler now returns a 500 instead of stopping the
  server.
- Speed test view now works with a MySpeed or Speedtest Tracker server on a
  private IP.
- Corrected the Docker socket hint to point to a socket proxy URL.

## [1.3.0] - 2026-07-18

### Added

- Folder app picker and widget multi-select dropdowns can now be operated from
  the keyboard.
- Toggles show a focus ring when reached by keyboard, and an unavailable toggle
  is announced with its reason.
- `docs/widget-template/`: a working widget to copy from.

### Changed

- Inline-edit rows open from the value text, not just the pencil, and the
  pencil's tap target is larger.
- Dock icons show the app name on hover.
- The per-app Health Check toggle now shows as unavailable, with the reason,
  when Docker Container Health Checks are off.
- Host-IP `portMap` targets are now SSRF-checked. Mapping to a private IP now
  needs `ALLOW_PRIVATE_IPS=true`; container-name mapping is unaffected.

### Fixed

- Uploading a custom app icon failed and never applied the icon.
- Saving from two admin tabs at once silently discarded one save; it now reports
  a conflict.
- Show in Dock stayed usable when the dock was full and then dropped the app;
  more than four dock apps is now rejected.
- Test Connection and health-check pings hit a different target than the widget
  fetch; they now follow the same port mapping.
- The badge color picker's last swatch could be clipped on narrow screens.
- The weather widget clipped the bottom of the rain and shower drops.
- IPv6 literal targets now connect correctly.

### Security

- SSRF guard now blocks IPv4-in-IPv6 forms of private targets it previously
  missed.
- SSRF guard now runs after host rewriting, so the checked URL is the one
  connected to.
- Security headers are now sent on every response, including `/icons/`.
- Badge headers and URL parameters can be marked as credentials, stored
  server-side and never returned to the browser or exported.
- Badge values returned by a remote service are now escaped on render.

## [1.2.0] - 2026-07-15

### Added

- Demo mode: `DEMO_MODE=true` serves a read-only sample dashboard, refuses
  writes, and makes no outbound requests. Off by default.

### Changed

- Now Playing shows the player the session is running on.
- Admin list: folders and widgets show their own icons, and only apps can be
  dragged into a folder.

### Fixed

- The mobile search pill, activity badges, and results rendered at double size
  and overlapped the last widget row.
- The desktop search overlay had an empty band above the first result and a
  stranded close button with no Cancel.
- The backup card placeholder shifted on hover, leaving a blank band and
  clipping the next-run line.
- The now-playing strand appeared detached from the tape spool.

### Security

- Hardened `esc()` and the uploaded-SVG sanitizer.

## [1.1.0] - 2026-07-13

### Changed

- Widget secret handling is unified on the manifest-driven path; widgets declare
  their secrets in `widget.json`.

### Removed

- A dead touch-cleanup variable in the dashboard.

### Fixed

- Two docs typos.

### Security

- Backup widget instance passwords are now stripped from the config sent to the
  browser and on export.
- Scrutiny and network-speed widget data routes now apply the same SSRF guard
  and IP pinning as the rest of the proxy. A widget pointed at a private IP
  literal needs `ALLOW_PRIVATE_IPS=true`.
- Sessions now expire after a configurable lifetime (default 30 days, set with
  `SESSION_MAX_AGE_DAYS`). Existing sessions are invalidated, so everyone logs
  in once more after updating.
- `esc()` now escapes single quotes.

## [1.0.0] - 2026-07-12

First public release. Stackyard serves plain HTTP and is built for a trusted
LAN, not direct public exposure; see [`docs/security.md`](docs/security.md)
before exposing it further.

### Added

- Launcher grid of apps, folders, and widgets, with a mobile layout.
- Widgets: Clock, Now Playing, Weather, DNS, GitHub, Books, System Stats, Disk
  Health, Backup, Connections, Dashboard Switch.
- Live activity badges from any API, configured in the UI.
- Admin UI with config import/export.
- Six languages, including RTL.
- SSRF-guarded requests with DNS-rebind protection, a non-root container,
  multi-arch images (amd64/arm64), and optional password protection.

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

[Unreleased]: https://github.com/SandObserver/stackyard/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/SandObserver/stackyard/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/SandObserver/stackyard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/SandObserver/stackyard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/SandObserver/stackyard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SandObserver/stackyard/releases/tag/v1.0.0
