# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The widget type list in Admin now says when a widget's definition was refused,
  and why, instead of leaving it silently absent.

- **Sign out all devices** in Admin → General → Security signs out every browser
  and device without changing your password. Previously the only way to do this
  was to change the password, which rotates the same session secret as a side
  effect.
- `TRUSTED_PROXY` names where a front reverse proxy is (Nginx Proxy Manager,
  Caddy, Traefik), so Stackyard sees real client addresses through it. Without
  it, every request arriving through such a proxy counts as one client for rate
  limiting. See [docs/security.md](docs/security.md).
- API error responses now carry a machine-readable `kind` (and, where useful, a
  small `detail` object) alongside the existing `error` message. See
  [docs/api-errors.md](docs/api-errors.md).

### Changed

- Widgets now follow the interface text direction, so they mirror in Persian
  along with the rest of the app.
- Admin secondary text, placeholders and control borders now meet WCAG contrast
  minimums in the default theme.
- Correct the security documentation: `TRUST_PROXY` affects only the session
  cookie, the client address is trusted only over loopback, and the container's
  process users are set by the image rather than by Compose.
- The accent colour is now teal, and the interface uses Apple's system colours
  throughout. Increased-contrast mode moves the whole palette to Apple's
  higher-contrast values rather than only a few pieces of it.
- Browser support is now stated: Safari and iOS Safari 16.2 and newer, and
  current Chrome, Edge and Firefox. See
  [docs/frontend.md](docs/frontend.md).
- Widget manifests are checked more strictly: a `showIf` must name one of the
  field's own siblings and carry a condition, and `viewField` must name a
  declared field whose options match the declared views.
  A third-party widget breaking either rule no longer loads; the container log
  names the problem. All bundled widgets already comply.
- The layout now follows the text direction by itself, so Persian mirrors
  correctly without a list of per-element exceptions that had to be kept up to
  date by hand.
- The largest accepted config save is now 2 MB rather than 4 MB. A dashboard with
  300 apps is about 155 KB, so this is ample, and a request body is held in memory
  while it is read.
- Passwords are hashed with a five times higher work factor, and the stored hash
  now records the parameters it was made with, so the cost can be raised in
  future without invalidating existing passwords. Memory use per hash is
  unchanged at 16 MiB. An existing password is upgraded the next time it is used
  to log in. `PASSWORD_HASH_MEMORY` selects a heavier setting on hardware that
  can afford it; see [docs/security.md](docs/security.md).
- API responses and the PWA manifest are now compressed, which they were not
  before, and compressed responses carry `Vary: Accept-Encoding` so a cache in
  front cannot serve a compressed body to a client that did not ask for one.
- The container now mirrors the repository layout, with the API at `/app/api`
  instead of `/app`. Rules the browser and the server both enforce can then live
  in one file rather than being duplicated.

### Removed

- Badge polling no longer sends a copy of each service's full response to the
  browser alongside the extracted number, so the dashboard's most frequent
  request stays small whatever the service returns.
- The API no longer sends CORS preflight headers or answers `OPTIONS`. It has
  always been same-origin only, and the headers it sent could never permit a
  cross-origin request.

### Fixed

- Widgets are now translated: every settings form and every string inside a
  widget, in all six languages. A widget carries its own translations in its
  folder, so a third-party widget can ship its own.
- The clock's day and month names now follow the selected language.
- App and folder names now keep their own text direction, so an English name in
  a Persian dashboard no longer truncates from the wrong end.
- Setting a dashboard password now asks for it twice and can be shown while
  typing, instead of locking the install out on an unnoticed typo.
- A Docker socket URL stored as `tcp://` is corrected to `http://` on upgrade,
  instead of every app backed by a container reporting unhealthy.
- When a widget's definition cannot be loaded, Settings now says why, listing
  what is wrong with its `widget.json` instead of pointing at the container log.
- Widgets stop polling while the dashboard tab is in the background, and refresh
  as soon as you return. A backgrounded dashboard was still calling every
  service behind it, some as often as every ten seconds.
- Widgets now keep showing their last reading through a brief outage instead of
  blanking, and say how long ago it was fresh. Half of them reported failures in
  a way that bypassed that handling.
- A widget reporting a problem with its configuration, such as a missing API key
  or a rejected password, now says so instead of "Something went wrong."
- The mobile back button and the drag preview in Settings now draw their
  background instead of appearing transparent.
- The password strength meter no longer reads "undefined" for the strongest
  passwords.
- Password strength labels are now translated. They were always English, so a
  translated dashboard showed an English word in the first-run prompt and inside
  the "password too weak" message.
- Prometheus exporters that declare `application/openmetrics-text` or
  `text/plain; version=0.0.4` but emit no `# TYPE` comments are now parsed
  instead of arriving as unusable raw text.
- A service whose container is named `constructor`, `toString` or another
  built-in property name no longer reports healthy when that container does not
  exist.
- A widget whose type is a built-in property name now reports as unknown instead
  of "declares no data source".
- XML and Prometheus responses no longer drop a field named `__proto__`, and a
  field named after a built-in property name reads back its real value.
- Widget status text is now translated. "Loading", "Unavailable", "No data" and
  the "5m ago" timestamps were always English, so a translated dashboard still
  showed English inside every widget.
- Dashboard text that was always English is now translated: the status a screen
  reader announces, the reason a tile is red, the "could not connect" screen and
  the first-run password prompt.
- Changing dashboard page is now announced to a screen reader, so pressing a
  page dot, swiping or using the arrow keys says which page you moved to.
- The Settings page now honours the system's reduced motion, reduced
  transparency and increased contrast settings. Only the dashboard did, so
  turning one on appeared to work until you opened Settings.
- The page dots at the bottom of the dashboard can now be reached with Tab and
  activated with Enter or Space, and a screen reader announces which page each
  one goes to and which is showing. Paging previously worked by pointer only.
- Keyboard focus now stays inside an open folder or the first-run password
  prompt. Pressing Tab moved out of them into the dashboard behind, which is
  hidden but still reachable. Escape closes a folder on mobile, and closing any
  of them returns focus to whatever opened it.
- Saving settings now waits for the data to reach the disk, so pulling the power
  shortly afterwards can no longer leave an empty or truncated configuration.
- A save that fails no longer leaves the dashboard showing changes that were
  never written.
- Installing Stackyard to a home screen now uses a properly padded icon, so
  Android no longer crops the edges off it, and the browser's status bar matches
  the dashboard instead of showing a teal band above it.
- The container now exits and restarts when the API cannot be started, instead of
  staying up with a dead API inside it. Docker marked it unhealthy, but an
  unhealthy container is not restarted, so the dashboard stayed down until
  someone noticed.
- Uploading an icon with a name already in use no longer replaces the existing
  file, which changed the picture on any app still using it. The upload is saved
  under a free name and the form shows which name was used.
- The polling endpoints are now rate limited, so a dashboard stuck reloading
  cannot flood the services it monitors. The limits are far above normal use: a
  single open tab uses about a twentieth of the allowance.
- A health check against a service that is reachable but hung now gives up on
  time. It took twice its allowed time, which delayed the whole health response
  because those checks run together.
- Uploading an icon between 1 and 2 MB no longer fails with a generic error page.
  nginx was applying its own 1 MB default, below the 2 MB the upload form offers,
  so it refused the request before Stackyard could say why.
- A Connections service with no address configured now says so, instead of
  failing with a DNS error for a host called "undefined".
- Typing an icon name in any capitalisation now finds it. `MySpeed` and
  `Home Assistant` previously showed nothing, because the icon catalogue names
  every file in lowercase with hyphens. The suggestion shows the corrected name
  before you pick it.
- An uploaded icon whose file has an uppercase extension, such as `LOGO.SVG`, now
  appears. Its name is also escaped properly, so characters like `+` and `&` no
  longer break the link.
- The Retry button on the "could not connect" screen now works. It did nothing
  when clicked, because the page's security policy refuses handlers written into
  the markup. The same applied to the Retry button on the Admin page.
- An open dashboard now picks up every settings change. It previously noticed
  only a renamed or relinked app, so changing an icon, colour, dock pin, hidden
  flag or badge left other open dashboards showing the old version until they
  were reloaded by hand.
- Widgets no longer keep polling their services after the dashboard rebuilds. On
  a phone the dashboard also rebuilt whenever the keyboard opened, so a session
  could accumulate dozens of hidden widgets all still fetching. It now rebuilds
  only when the orientation actually changes.
- The Admin page no longer opens blank when the browser remembers a section from
  an older version. It falls back to the first section instead.
- Adding an app to a folder while editing that folder now removes it from any
  folder it was already in, so it no longer appears in two places at once.
- Editing an item that has since moved no longer fails the save with an
  unhelpful error.
- Two items can no longer end up sharing an id, which made the second one
  unreachable: its badge, settings and folder membership all resolved to the
  first. New ids cannot collide, and a config containing duplicates is refused
  with the id named.
- An install running a release candidate is now told when the matching stable
  release is out. The comparison read `1.5.0-rc.1` as newer than `1.5.0`, so such
  installs reported themselves up to date indefinitely.
- A failed update check is no longer repeated on every request, which could use up
  the hourly GitHub allowance on installs that cannot reach it.
- Network speed in the system widget was reported from the wrong columns of
  `/proc/net/dev` once an interface had carried about 10 MB, showing packets per
  second in place of bytes. It also picked the wrong interface when the
  configured name was a prefix of another, and showed a large negative figure for
  one sample after an interface restarted.
- Memory use no longer reports 100% on kernels and container setups that do not
  provide `MemAvailable`.
- CPU use no longer reports a blank or nonsensical figure when `/proc/stat`
  cannot be read as expected.
- Hovering an app tile with a red status badge now shows why, such as
  `Exited (1) 2 hours ago` or `Ping failed: connect ECONNREFUSED`. An app
  configured with both a container name and a URL check also previously lost its
  container detail, so only the URL check could be reported.
- A badge whose stored headers contain one damaged entry now keeps the rest,
  including its credential. The whole set was previously discarded and the
  request went out unauthenticated, which reported as an authentication problem
  and pointed at a credential that was stored correctly.
- XML data sources no longer mis-read an element when one of its attributes
  contains a `>`, which is valid and appears in feeds, typically in episode
  titles. The element previously lost its attributes and absorbed the element
  after it.
- A cookie containing a stray `%` no longer breaks the dashboard. Any such cookie
  on the domain, not only Stackyard's own, previously caused every request to fail
  with a server error.
- A malformed URL now returns a bad-request response instead of a server error.
- Rate limiting is now per client rather than shared. The app read a header nginx
  never set, so every request looked like it came from the same address and five
  failed logins from anyone locked out everyone. With `TRUST_PROXY=true` the
  header was also client-supplied, so the limit could be bypassed entirely.
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

### Security

- A widget can no longer forward a raw error message from a service it contacted
  straight to the browser. Such a message can name an internal address or path,
  and 17 places did it.
- TLS verification is no longer skipped for a public IPv6 address when "skip TLS
  verification" is on. Only private addresses, loopback and Docker service names
  bypass it, as documented.
- A widget's data function is now given only the dashboard settings shared with
  widgets, as a frozen copy, instead of the whole settings object. It previously
  received the session signing key and the password hash, and could modify them.
- Error messages shown in the browser no longer include internal addresses,
  hostnames or server file paths. The full message is written to the container
  log instead.
- nginx no longer reports its version in the `Server` header or on error pages.
- Translated strings that are allowed to contain markup are now limited to
  `<strong>`, `<em>`, `<code>` and `<br>` with no attributes, instead of being
  inserted unrestricted. Three other translated strings no longer bypass escaping
  at all.
- App and widget links using a script-bearing scheme (`javascript:`, `data:`,
  `vbscript:`, `blob:`, `filesystem:`) are refused when saving and ignored when
  rendering, so such a link cannot run in the dashboard. Protocol handlers like
  `ssh://`, `vnc://` and `rdp://` keep working. A link already stored, or one
  arriving in an imported config, is left blank rather than repaired.
- Messages between the dashboard and its widgets are checked against the page
  origin, and are addressed to it rather than to any parent.
- Log values are quoted and escaped, so a value containing a newline can no
  longer forge a second log line, and values containing spaces or `=` no longer
  split into several fields. Values that need no quoting print as before.
- Uploaded SVG icons are sanitized by rebuilding them from an allowlist rather
  than by removing known-bad patterns, so markup the sanitizer cannot parse is
  dropped instead of passed through. An event handler written with a `/`
  separator, such as `<path/onload=...>`, previously survived.
- The outbound guard now blocks carrier-grade NAT, multicast, reserved and
  broadcast addresses, IETF protocol assignment and benchmarking ranges, and
  IPv6 multicast. The full list of covered ranges is in
  [docs/security.md](docs/security.md).
- Widget pages can no longer be framed by other sites. `X-Frame-Options` is
  cleared on them so the dashboard can embed them, and nothing had replaced it.
  Every page now states its framing policy in the Content-Security-Policy header.
- A widget whose definition cannot be loaded no longer has its settings sent to
  the browser or written to a config export. Without the definition there is no
  way to tell which fields hold credentials, so nothing is sent. The settings
  are kept on the server and are restored untouched when the dashboard is saved,
  and Admin explains why they cannot be shown.
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
