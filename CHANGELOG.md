# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.1] - 2026-07-20

### Security

- Backup job and source discovery (the "list jobs" and "list sources" buttons
  for Duplicati and Kopia) now routes the URL you enter through the SSRF guard,
  so it cannot be used to reach private or loopback addresses. Saved widgets are
  unaffected. If the guard is active and your backup server is on a private IP,
  set `ALLOW_PRIVATE_IPS=true` to discover its jobs.
- The widget config preview (the "Fetch" button on a widget's option pickers)
  now routes the URL you enter through the SSRF guard the same way. A URL typed
  into any widget's preview form can no longer reach private or loopback
  addresses.
- The SSRF guard now blocks `http://localhost` by name, matching how it already
  blocked the `127.0.0.1` and `::1` loopback literals. Dotless Docker service
  names stay allowed.
- Parallel login attempts are now rate-limited correctly. The limit was checked
  before password verification and only counted afterward, so a burst of
  concurrent attempts could all pass the check before any was counted.

### Fixed

- A config file that parses but has the wrong shape (for example `items` is not
  a list) no longer crashes the server. It is backed up to a timestamped file
  and replaced with a blank config, the same as an unparseable file.
- An unexpected error in a request handler now returns a 500 for that request
  instead of taking the whole server down.
- The speed test view now works with a MySpeed or Speedtest Tracker server on a
  private IP address.
- Corrected the Docker socket hint, which suggested entering
  `unix:///var/run/docker.sock` directly even though that is not supported. It
  now points to a socket proxy URL.

### Changed

- Internal: the Conduit map fetch goes through the shared fetcher, gaining its
  request deadline and size cap instead of using its own http/https code. Widget
  data functions can now pass `{ raw: true }` to `ctx.fetchJSON` to get the
  untouched response body for a custom parser.

## [1.3.0] - 2026-07-18

### Added

- The folder app picker and widget multi-select dropdowns can now be operated
  from the keyboard (arrows, Home/End, Enter/Space, Escape). They were
  mouse-only.
- Toggles show a focus ring when reached by keyboard, and an unavailable toggle
  is announced with its reason instead of being skipped.
- `docs/widget-template/`: a working widget to copy from, validated in CI and by
  lint.

### Changed

- Inline-edit rows open from the value text, not just the pencil, and the
  pencil's tap target is larger.
- Dock icons show the app name on hover.
- The per-app Health Check toggle is now clearly unavailable, and says why, when
  Docker Container Health Checks are off in General.
- Behaviour change (host-IP `portMap` only): a mapped target is now SSRF-checked.
  Mapping to a container name is unaffected; mapping to a private IP now needs
  `ALLOW_PRIVATE_IPS=true`. `portMap` has no UI and is hand-edited.
- Internal: completed the escape-by-default `setHtml`/`html` rendering migration
  across the admin and dashboard code, held by a ratchet test that blocks new
  direct `innerHTML`, `insertAdjacentHTML`, and `+=` markup writes.
- Internal: `proxy.js` now exposes a single outbound boundary,
  `fetchChecked`/`pingChecked` for request URLs and
  `fetchUnchecked`/`pingUnchecked` for config or hardcoded URLs;
  `fetchJSON`, `pingUrl`, and `guardSsrf` are no longer reachable from routes.
- Internal: widget manifests are validated in CI against the same validator the
  server uses at startup, so a schema mistake fails the PR.

### Removed

- Internal: the unused custom dropdown helper and its CSS, the unused `crypto`
  and `log` re-exports from `auth.js`, and `export` from five symbols used only
  within their own module.

### Fixed

- Uploading a custom app icon failed with an error and never applied the icon.
- Saving from two admin tabs at once silently discarded one save; the stale save
  now reports a conflict and asks you to reload.
- Show in Dock stayed usable when the dock was full, saving the app as docked and
  then dropping it; a config with more than four dock apps is now rejected
  instead of quietly dropping the extras.
- Test Connection and per-app health-check pings reported on a different target
  than the widget fetches; a ping now follows the same host-IP port mapping the
  fetch does.
- The admin badge color picker's last swatch could be clipped on narrow screens;
  the swatch row now wraps.
- The weather widget clipped the bottom of the rain and shower drops.
- IPv6 literal targets now connect correctly; the bracketed form was passed to
  the socket unstripped.

### Security

- The SSRF guard now blocks IPv4-in-IPv6 forms of private targets the previous
  range check missed: hex-tailed IPv4-mapped literals (e.g. `::ffff:7f00:1`) and
  the NAT64 well-known prefix.
- The SSRF guard now runs after host rewriting, so the URL that is checked is
  always the URL that is connected to.
- Security headers (X-Content-Type-Options, Referrer-Policy, Permissions-Policy,
  X-Frame-Options, Content-Security-Policy) are sent on every response, including
  `/icons/`, which previously sent none because it set its own Cache-Control.
- Live activity badge headers and URL parameters can be marked as credentials,
  stored server-side and never returned to the browser or exported. Fixes a case
  where an API key typed into a badge header was returned in plaintext by the
  config API.
- Badge values returned by a remote service are now escaped on render.
- Internal: the uploaded-SVG sanitizer's event-handler blocklist now matches any
  `on*` attribute, not just three-character names. The allowlist already
  stripped them, so this was defense in depth, not a live hole.

## [1.2.0] - 2026-07-15

### Added

- Demo mode: `DEMO_MODE=true` serves a read-only sample dashboard with fake
  widget activity, refuses every write, and makes no outbound requests. Off by
  default, so existing installs are unaffected.

### Changed

- Now Playing shows the player the session is running on.
- Admin list: folders and widgets show their own icons, and only apps can be
  dragged into a folder.

### Fixed

- The mobile search pill, activity badges, and results rendered at double size,
  and the pill overlapped the last row of widgets.
- The desktop search overlay showed an empty band above the first result, a
  close button stranded in the corner, and no Cancel button.
- The backup card placeholder shifted on hover, leaving a blank band above the
  last-run line and clipping the next-run line.
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
  browser and on export, matching every other widget. They were returned in
  plaintext.
- The Scrutiny and network-speed widget data routes now apply the same SSRF
  guard and IP pinning as the rest of the proxy, and the two Scrutiny routes
  share one code path. A widget pointed at a private IP literal needs
  `ALLOW_PRIVATE_IPS=true`.
- Sessions now expire after a configurable lifetime (default 30 days, set with
  `SESSION_MAX_AGE_DAYS`); tokens carry a signed issued-at enforced server-side,
  closing the non-expiring-session issue. Existing sessions are invalidated, so
  everyone logs in once more after updating.
- `esc()` now escapes single quotes, closing a latent gap for values placed in
  single-quoted HTML attributes.

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
