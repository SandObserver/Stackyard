# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Outbound requests are restricted to `http` and `https`. A URL with another
  scheme, or with no host, was previously accepted and sent as an HTTP request,
  which could reach the server's own localhost.
- A malformed stored password hash no longer crashes the API. It now fails the
  login and logs the reason.
- Authentication settings can no longer be written through a config save or an
  imported config. They are changed only from Admin, so a config upload cannot
  set or replace the password before one exists.
- Testing a badge or fetching widget options no longer reuses a stored
  credential when the configuration has been changed, so a stored secret cannot
  be sent to a different destination. Re-enter the credential to test edited
  settings.
- Widget frontends no longer build markup by concatenation, so a value from an
  upstream service or an imported config cannot inject markup into a widget
  iframe. Widget colours are validated and assigned as CSS properties rather
  than written into a style string.
- Unticking the Secret box on a badge or activity header no longer returns the
  stored credential to the browser. Unticking now clears the stored value, and
  the field shows that a new value is needed.
- SSRF filter now blocks IPv4-compatible IPv6 literals (`::/96`).

### Added

- API error responses now carry a machine-readable `kind` (and, where useful, a
  small `detail` object) alongside the existing `error` message. See
  [docs/api-errors.md](docs/api-errors.md).

### Fixed

- Authentication can no longer be switched on without a password, which locked
  the install with no way back in. An install already in that state now behaves
  as if authentication were off, so Admin is reachable and a password can be
  set.
- Testing a badge URL against a service that replies `401` or `403` is now
  reported as a failure and offers to enable authentication. It previously
  reported success with no values found.
- Testing a badge URL no longer tells you to add an API key when it was your own
  admin session that expired.
- Testing a badge URL against an address blocked by the outbound guard now shows
  the reason instead of a bare error.
- XML data sources no longer mis-read a single element named after a built-in
  object property (such as `toString`) as a repeated element.

## [1.4.0] - 2026-07-26

### Added

- Reorder items on touch devices by dragging the handle in the dashboard list;
  drop onto a folder to move an item into it.
- Widget settings can declare a `color` field, rendered with the same colour
  control used elsewhere in the admin interface.
- Widget settings can declare an `object` field, rendered as its own card of
  nested settings.
- Widget settings can declare the same key more than once with different labels,
  each shown by a `showIf` condition.
- A widget view can limit which sizes it offers.
- A widget can choose its card background: `dark`, `light` or `translucent`,
  set for the whole widget or per view.
- A widget can ship a `demo.js` supplying the body it shows in demo mode.
- Widget settings can declare a `picklist` field: a fixed number of dropdowns
  filled from a single fetch.
- Widget settings can declare a repeating section with a fixed number of rows
  per widget size.

### Changed

- System stats now sample CPU once per refresh instead of twice, removing about
  a second of delay when the IO wait row is shown.
- Books, Connections (Map), Dashboard Switch and Stats (System Summary) now use
  a solid dark card. Backup, Connections (VPN), DNS and GitHub use a translucent
  one.

- Stats widget now uses the standard widget settings form. Disk bays are filled
  from one Fetch Drives call, and the network row is its own settings card.

- Connections widget now uses the standard widget settings form. Each service
  is a settings card, and the fields shown follow the service type.

- Widget settings rows in a repeating section now show and hide independently,
  and a dropdown in one can load its options from the service that row points at.
- Weather widget now uses the standard widget settings form. Location is set by
  typing a city, pressing Fetch and picking a match; "feels like" is a toggle.
- Backup widget now uses the standard widget settings form. Each slot carries
  its own URL and password.
  A slot that previously reused another slot's connection keeps working, but a
  new slot for an instance already configured elsewhere needs its URL and
  password entered again.

- GitHub widget opts into GitHub's advanced issue search, now the default for
  the pull-request search API.

- Jellyfin and Emby now-playing authenticate with a request header instead of
  the `api_key` query parameter, which Jellyfin has deprecated.

- TrueNAS disk health reports a clear message on TrueNAS 26, which removed the
  REST API the widget uses; TrueNAS 25.x and earlier are unaffected.

- Settings app icon uses a blue background.

### Removed

- `GET /api/scrutiny-proxy` and `POST /api/truenas-proxy`. Drive and pool lists
  now come from the widget's own data function.

- `GET /api/backup-data`, `POST /api/duplicati-jobs` and `POST /api/kopia-sources`.
  Backup status and job lists now come from the widget's own data function.

- The `customEditor` manifest key, now that every widget uses the standard
  settings form.

- `GET /api/geocode-proxy`. City search now runs through the widget's own data
  function.

### Security

- TrueNAS API key is no longer sent in a URL query string when fetching pools.

- Reject cross-origin POSTs to `/api/auth/login`, `/api/auth/logout`,
  `/api/ping` and `/api/badge-proxy`, matching the other write routes.

### Fixed

- Folder rows now show the drop highlight while an app is dragged onto them.

- The System Summary, Disk Health and Connections (Map) widgets now show a
  loading and error state when their data source is unavailable, instead of
  appearing empty.

- Widgets no longer render outside their card in the top-left of the dashboard.

- Widget settings fields no longer appear when the field that controls them is
  itself hidden. Turning off the Stats network row now hides its provider and
  URL fields, and the disk-source fields no longer show under System Summary.

- Saving a widget with a required password or key left blank is now refused
  instead of saving an unusable widget.

- Fetching options in a widget's settings on the public demo no longer returns
  the demo's sample data instead of a real result.

- Widgets no longer show a stale cached version after an update. Each widget's
  frontend files are now cache-busted automatically from their content, the same
  way the rest of the interface already was.

- Dashboard grid no longer overflows and clips to the left on landscape phone
  and portrait tablet.

- Admin dashboard list no longer truncates item names to a single character on
  phones; status tags wrap below the name.

- Admin dashboard uses the sidebar layout on landscape phone instead of a
  stretched mobile column.

- Dashboard grid is no longer vertically compressed in Safari on iPhone; it now
  fills the screen the same as the installed app.

- Dashboard grid no longer runs behind the dock on short viewports such as iPad
  landscape; pages fit the available height.

- Admin dashboard drag handle is narrower on phones, leaving more room for item
  names.

- Folder preview icons are uniform squares on phones and tablets regardless of
  icon shape.

- Kavita reading-list picker works again; its list endpoint requires POST.

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

[Unreleased]: https://github.com/SandObserver/stackyard/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/SandObserver/stackyard/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/SandObserver/stackyard/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/SandObserver/stackyard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/SandObserver/stackyard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/SandObserver/stackyard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SandObserver/stackyard/releases/tag/v1.0.0
