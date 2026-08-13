# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] - 2026-08-13

### Added

- Import links and folders from a gethomepage or Dashy YAML config.

- The Docker Hub repository description is published from `README.md` on each
  stable release.

- The support documentation describes the log format, the level abbreviations
  and how to read the logs.

### Changed

- Dashboard tiles scale down with the window, so six columns stay square on a
  tablet. Sizes above the design width are unchanged.

- Settings keeps its sidebar on a tablet, narrowed.

- Widgets spread their polling, so several on one dashboard no longer fetch from
  your services on the same tick.

- Importing from another dashboard reads a list written level with its key, a
  value folded across lines, and an empty `[]` or `{}`, each of which used to
  refuse the whole file.

- Confirming an import and naming a new folder use in-page dialogs instead of
  the browser's own.

- The container prints six lines when it starts, instead of twenty-three.

- Nginx request errors now appear in `docker logs`, and Nginx no longer writes
  an access log to a file inside the container that nothing rotated.

- A misconfigured `TRUST_PROXY` produces one short warning instead of two long
  ones.

### Fixed

- Resizing a browser window across the mobile breakpoint now switches the
  dashboard layout, instead of keeping the old one until a reload.

- Dragging a Settings row to reorder it now works by touch on a tablet.

- Controls in Settings reach the 44px minimum on a touch device.

- Settings respects the notch and home indicator when installed as a PWA.

- One unreachable service no longer delays every other tile's refresh by six
  seconds.

- A badge whose service did not answer keeps its last value and is marked out of
  date, instead of showing nothing.

- Icons from the community set are fetched once through Stackyard and kept in
  memory, instead of being loaded from a public CDN on every page load.

- A badge blocked for pointing at a private address now names
  `ALLOW_PRIVATE_IPS=true` as the setting that allows it.

- An Admin save no longer changes the Unsplash wallpaper on every open
  dashboard. The photo is kept for a day.

- The dashboard reopens on the page you were last on instead of the first one.

- The Docker socket proxy address is checked when it is saved, and a wrong one
  is refused with the reason and what to change about it, instead of being
  stored.

- The icon preview in the app editor keeps its inset and no longer reverts to
  the initial letter while an icon name is being typed.

- Exporting the config now reports a failure instead of saving an error response
  as `stackyard-config.json`.

- A session that expires while you are working in Admin now raises the sign-in
  box over the page, and the interrupted save completes once you are back in,
  instead of failing as "Unauthorised" until the page is reloaded.

- Saving an app or widget no longer reports "Updated" when the write failed; the
  editor stays open with the form intact.

- A failed save no longer leaves the admin list showing a delete, reorder,
  drag-drop or folder change the server never received.

- Importing a config reports "Imported" only once the write has landed.

- A failed label-visibility toggle now reports the error instead of failing
  silently with the switch left in its new position.

- A settings save that is refused for a missing or weak password no longer saves
  the rest of the screen first.

- The Password Protection switch is read back from the server after a save, so it
  no longer shows a state the server rejected.

- The Books, Now Playing and Backup widgets now show why they failed, such as a
  missing API key or a rejected password, instead of a generic error.

- The last visible row in a Settings group no longer draws a separator under
  itself, which showed under Password Protection whenever protection was off.

- The startup banner no longer prints a Web UI address that pointed at the
  internal API port and worked for nobody.

- The Connections map spreads a country's highlighted dots across it, clustered
  around the capital, instead of bunching them at the country's centre.

- Badges no longer lose their rounded shape in Safari after a long session.

- Turning Password Protection off now deletes the stored password.
  While protection is off, anyone who can reach the dashboard can set a new one.

- A password typed in the same save that turns Password Protection off is no
  longer stored and then immediately deleted, which signed out every other
  device for nothing.

- The sign-out row no longer stays on screen after Password Protection is
  turned off, where pressing it returned an error.

- The password and Unsplash key status labels are translated instead of always
  reading in English.

- Escape and the Tab trap keep working in a folder or prompt overlay after
  clicking text inside it.

### Security

- Pages no longer permit stylesheets or fonts from Google Fonts, which nothing
  requests.

- The `linux/arm64` release image is scanned for vulnerabilities before it is
  published, the same as `linux/amd64`.

- A stored credential is only reused for the request it was saved for.
  Changing where a badge or a widget sends it now requires entering it again.

- A tile colour that is not a colour no longer reaches a stylesheet, so a
  stored value cannot name a host for the browser to fetch from.

- An embedded widget is granted only presentation features, never camera,
  microphone or location, whatever its stored settings ask for.

- A badge no longer sends a header whose value is empty.

- The Password Protection switch refuses a request that does not plainly say on
  or off, instead of reading it as off and deleting the stored password.

- A Connections tile that cannot reach a service now says so in plain words
  instead of printing the address it tried, which put an internal host and port
  on the dashboard.

- A failed connection test no longer writes the request path to the log, where
  a service that carries its API key in the path would have left it.

- Allowing a self-signed certificate now applies only to addresses on your own
  network, wherever the request came from.
  A badge or health check pointed at a public address is verified again, so an
  app relying on this for one must use a trusted certificate.

- Importing from another dashboard asks before allowing self-signed
  certificates, instead of taking the setting from the file.

- Sessions now expire after 12 hours idle instead of 30 days, and a session in
  use is extended. Override with `SESSION_MAX_AGE_DAYS`.

- Requests that change something must state their origin.
  A script calling the API directly now has to send an `Origin` header naming
  the address it is calling.

- The API listens on loopback only, so it can no longer be reached around Nginx.

- The pre-login status reply no longer says whether a password has been set.

## [1.5.2] - 2026-08-09

### Changed

- Finishing first-run setup on an install with nothing on the dashboard now
  opens Settings, where the first app or widget is added, instead of an empty
  dashboard.

### Fixed

- Disk Health, System Stats, Backup, Now Playing and the two Connections views
  now show why a widget failed instead of an HTTP status or a generic message.
- The admin save toast now carries its success or failure as a coloured fill
  that meets WCAG AA, instead of a thin accent bar on one edge.

### Security

- The image no longer ships Python setuptools, which arrived as a packaging
  dependency of supervisor and nothing in the container used.

## [1.5.1] - 2026-08-08

### Fixed

- Saving settings, logging in and every other write now work when Stackyard is
  reached directly on a mapped port, such as `http://server:8700`.
- Admin now translates the Dock, Health and Badge pills, the Edit button, the
  Secret checkbox, the colour and poll-interval labels, the widget Name and
  Widget Type labels, and the editor's section title.
- Persian now translates API URL, Ping, Poll and Add to Header, which were left
  as English text in the catalogue.
- The poll interval reads as one sentence in every language instead of wrapping
  the field in English words.
- App and widget names in the Settings list now sit beside their icon in
  Persian instead of aligning to the far side of the row.
- German, Spanish, French, Persian and Chinese now translate a further 34
  strings that were left as English text in their catalogues.
- The icon preview in the app editor no longer draws the artwork edge to edge.
- Colour swatches that wrap onto a second row now line up under the row above
  instead of splitting to opposite edges.

## [1.5.0] - 2026-08-08

### Added

- The widget type list in Admin now says when a widget's definition was
  refused, and why, instead of leaving it silently absent.
- **Sign out all devices** in Admin → General → Security signs out every
  browser and device without changing your password.
- `TRUSTED_PROXY` names where a front reverse proxy is (Nginx Proxy Manager,
  Caddy, Traefik), so Stackyard sees real client addresses through it.
- API error responses now carry a machine-readable `kind` (and, where useful, a
  small `detail` object) alongside the existing `error` message.

### Changed

- Widgets now follow the interface text direction, so they mirror in Persian
  along with the rest of the app.
- Admin secondary text, placeholders and control borders now meet WCAG contrast
  minimums in the default theme.
- Correct the security documentation: `TRUST_PROXY` affects only the session
  cookie, the client address is trusted only over loopback, and the container's
  process users are set by the image rather than by Compose.
- The accent colour is now teal, and the interface uses Apple's system colours
  throughout.
- Browser support is now stated: Safari and iOS Safari 16.2 and newer, and
  current Chrome, Edge and Firefox.
- Widget manifests are checked more strictly: a `showIf` must name one of the
  field's own siblings and carry a condition, and `viewField` must name a
  declared field whose options match the declared views.
- The layout now follows the text direction by itself, so Persian mirrors
  correctly without a list of per-element exceptions that had to be kept up to
  date by hand.
- The largest accepted config save is now 2 MB rather than 4 MB.
- Passwords are hashed with a five times higher work factor, and the stored
  hash now records the parameters it was made with, so the cost can be raised
  in future without invalidating existing passwords.
- API responses and the PWA manifest are now compressed, which they were not
  before, and compressed responses carry `Vary: Accept-Encoding` so a cache in
  front cannot serve a compressed body to a client that did not ask for one.
- The container now mirrors the repository layout, with the API at `/app/api`
  instead of `/app`.

### Removed

- Badge polling no longer sends a copy of each service's full response to the
  browser alongside the extracted number, so the dashboard's most frequent
  request stays small whatever the service returns.
- The API no longer sends CORS preflight headers or answers `OPTIONS`.

### Fixed

- Widgets are now translated: every settings form and every string inside a
  widget, in all six languages.
- The clock's day and month names now follow the selected language.
- The System Summary widget keeps its layout left to right in every language,
  so its charts and figures read the same way everywhere.
- App and folder names now keep their own text direction, so an English name in
  a Persian dashboard no longer truncates from the wrong end.
- The first-run password prompt now asks for the password twice and can show
  what you typed, instead of locking the install out on an unnoticed typo.
- The divider between the Settings navigation and the section beside it now
  runs the full length of the section instead of stopping one screen down.
- A Docker socket URL stored as `tcp://` is corrected to `http://` on upgrade,
  instead of every app backed by a container reporting unhealthy.
- When a widget's definition cannot be loaded, Settings now says why, listing
  what is wrong with its `widget.json` instead of pointing at the container
  log.
- Widgets stop polling while the dashboard tab is in the background, and
  refresh as soon as you return.
- Widgets now keep showing their last reading through a brief outage instead of
  blanking, and say how long ago it was fresh.
- A widget reporting a problem with its configuration, such as a missing API
  key or a rejected password, now says so instead of "Something went wrong."
- The mobile back button and the drag preview in Settings now draw their
  background instead of appearing transparent.
- The password strength meter no longer reads "undefined" for the strongest
  passwords.
- Password strength labels are now translated.
- Prometheus exporters that declare `application/openmetrics-text` or
  `text/plain; version=0.0.4` but emit no `# TYPE` comments are now parsed
  instead of arriving as unusable raw text.
- A service whose container is named `constructor`, `toString` or another
  built-in property name no longer reports healthy when that container does not
  exist.
- A widget whose type is a built-in property name now reports as unknown
  instead of "declares no data source".
- XML and Prometheus responses no longer drop a field named `__proto__`, and a
  field named after a built-in property name reads back its real value.
- Widget status text is now translated.
- Dashboard text that was always English is now translated: the status a screen
  reader announces, the reason a tile is red, the "could not connect" screen
  and the first-run password prompt.
- Changing dashboard page is now announced to a screen reader, so pressing a
  page dot, swiping or using the arrow keys says which page you moved to.
- The Settings page now honours the system's reduced motion, reduced
  transparency and increased contrast settings.
- The page dots at the bottom of the dashboard can now be reached with Tab and
  activated with Enter or Space, and a screen reader announces which page each
  one goes to and which is showing.
- Keyboard focus now stays inside an open folder or the first-run password
  prompt.
- Saving settings now waits for the data to reach the disk, so pulling the
  power shortly afterwards can no longer leave an empty or truncated
  configuration.
- A save that fails no longer leaves the dashboard showing changes that were
  never written.
- Installing Stackyard to a home screen now uses a properly padded icon, so
  Android no longer crops the edges off it, and the browser's status bar
  matches the dashboard instead of showing a teal band above it.
- The container now exits and restarts when the API cannot be started, instead
  of staying up with a dead API inside it.
- Uploading an icon with a name already in use no longer replaces the existing
  file, which changed the picture on any app still using it.
- The polling endpoints are now rate limited, so a dashboard stuck reloading
  cannot flood the services it monitors.
- A health check against a service that is reachable but hung now gives up on
  time.
- Uploading an icon between 1 and 2 MB no longer fails with a generic error
  page.
- A Connections service with no address configured now says so, instead of
  failing with a DNS error for a host called "undefined".
- Typing an icon name in any capitalisation now finds it.
- An uploaded icon whose file has an uppercase extension, such as `LOGO.SVG`,
  now appears.
- The Retry button on the "could not connect" screen now works.
- An open dashboard now picks up every settings change.
- Widgets no longer keep polling their services after the dashboard rebuilds.
- The Admin page no longer opens blank when the browser remembers a section
  from an older version.
- Adding an app to a folder while editing that folder now removes it from any
  folder it was already in, so it no longer appears in two places at once.
- Editing an item that has since moved no longer fails the save with an
  unhelpful error.
- Two items can no longer end up sharing an id, which made the second one
  unreachable: its badge, settings and folder membership all resolved to the
  first.
- An install running a release candidate is now told when the matching stable
  release is out.
- A failed update check is no longer repeated on every request, which could use
  up the hourly GitHub allowance on installs that cannot reach it.
- Network speed in the system widget was reported from the wrong columns of
  `/proc/net/dev` once an interface had carried about 10 MB, showing packets
  per second in place of bytes.
- Memory use no longer reports 100% on kernels and container setups that do not
  provide `MemAvailable`.
- CPU use no longer reports a blank or nonsensical figure when `/proc/stat`
  cannot be read as expected.
- Hovering an app tile with a red status badge now shows why, such as `Exited
  (1) 2 hours ago` or `Ping failed: connect ECONNREFUSED`.
- A badge whose stored headers contain one damaged entry now keeps the rest,
  including its credential.
- XML data sources no longer mis-read an element when one of its attributes
  contains a `>`, which is valid and appears in feeds, typically in episode
  titles.
- A cookie containing a stray `%` no longer breaks the dashboard.
- A malformed URL now returns a bad-request response instead of a server error.
- Rate limiting is now per client rather than shared.
- Authentication can no longer be switched on without a password, which locked
  the install with no way back in.
- Testing a badge URL against a service that replies `401` or `403` is now
  reported as a failure and offers to enable authentication.
- Testing a badge URL no longer tells you to add an API key when it was your
  own admin session that expired.
- Testing a badge URL against an address blocked by the outbound guard now
  shows the reason instead of a bare error.
- XML data sources no longer mis-read a single element named after a built-in
  object property (such as `toString`) as a repeated element.

### Security

- The container image no longer ships npm, corepack or yarn.
- A widget can no longer forward a raw error message from a service it
  contacted straight to the browser.
- TLS verification is no longer skipped for a public IPv6 address when "skip
  TLS verification" is on.
- A widget's data function is now given only the dashboard settings shared with
  widgets, as a frozen copy, instead of the whole settings object.
- Error messages shown in the browser no longer include internal addresses,
  hostnames or server file paths.
- nginx no longer reports its version in the `Server` header or on error pages.
- Translated strings that are allowed to contain markup are now limited to
  `<strong>`, `<em>`, `<code>` and `<br>` with no attributes, instead of being
  inserted unrestricted.
- App and widget links using a script-bearing scheme (`javascript:`, `data:`,
  `vbscript:`, `blob:`, `filesystem:`) are refused when saving and ignored when
  rendering, so such a link cannot run in the dashboard.
- Messages between the dashboard and its widgets are checked against the page
  origin, and are addressed to it rather than to any parent.
- Log values are quoted and escaped, so a value containing a newline can no
  longer forge a second log line, and values containing spaces or `=` no longer
  split into several fields.
- Uploaded SVG icons are sanitized by rebuilding them from an allowlist rather
  than by removing known-bad patterns, so markup the sanitizer cannot parse is
  dropped instead of passed through.
- The outbound guard now blocks carrier-grade NAT, multicast, reserved and
  broadcast addresses, IETF protocol assignment and benchmarking ranges, and
  IPv6 multicast.
- Widget pages can no longer be framed by other sites.
- A widget whose definition cannot be loaded no longer has its settings sent to
  the browser or written to a config export.
- Outbound requests are restricted to `http` and `https`.
- A malformed stored password hash no longer crashes the API.
- Authentication settings can no longer be written through a config save or an
  imported config.
- Testing a badge or fetching widget options no longer reuses a stored
  credential when the configuration has been changed, so a stored secret cannot
  be sent to a different destination. Re-enter the credential to test edited
  settings.
- Widget frontends no longer build markup by concatenation, so a value from an
  upstream service or an imported config cannot inject markup into a widget
  iframe.
- Unticking the Secret box on a badge or activity header no longer returns the
  stored credential to the browser.
- SSRF filter now blocks IPv4-compatible IPv6 literals (`::/96`).

## [1.4.0] - 2026-07-26

### Added

- Reorder items on touch devices by dragging the handle in the dashboard list;
  drop onto a folder to move an item into it.
- Widget settings can declare a `color` field, rendered with the same colour
  control used elsewhere in the admin interface.
- Widget settings can declare an `object` field, rendered as its own card of
  nested settings.
- Widget settings can declare the same key more than once with different
  labels, each shown by a `showIf` condition.
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
  a solid dark card.
- Stats widget now uses the standard widget settings form.
- Connections widget now uses the standard widget settings form.
- Widget settings rows in a repeating section now show and hide independently,
  and a dropdown in one can load its options from the service that row points
  at.
- Weather widget now uses the standard widget settings form.
- Backup widget now uses the standard widget settings form.
- GitHub widget opts into GitHub's advanced issue search, now the default for
  the pull-request search API.
- Jellyfin and Emby now-playing authenticate with a request header instead of
  the `api_key` query parameter, which Jellyfin has deprecated.
- TrueNAS disk health reports a clear message on TrueNAS 26, which removed the
  REST API the widget uses; TrueNAS 25.x and earlier are unaffected.
- Settings app icon uses a blue background.

### Removed

- `GET /api/scrutiny-proxy` and `POST /api/truenas-proxy`.
- `GET /api/backup-data`, `POST /api/duplicati-jobs` and `POST
  /api/kopia-sources`.
- The `customEditor` manifest key, now that every widget uses the standard
  settings form.
- `GET /api/geocode-proxy`.

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
  itself hidden.
- Saving a widget with a required password or key left blank is now refused
  instead of saving an unusable widget.
- Fetching options in a widget's settings on the public demo no longer returns
  the demo's sample data instead of a real result.
- Widgets no longer show a stale cached version after an update.
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
  guard. If your backup server is on a private IP, set
  `ALLOW_PRIVATE_IPS=true`.
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
- Host-IP `portMap` targets are now SSRF-checked.

### Fixed

- Uploading a custom app icon failed and never applied the icon.
- Saving from two admin tabs at once silently discarded one save; it now
  reports a conflict.
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
  writes, and makes no outbound requests.

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

- Widget secret handling is unified on the manifest-driven path; widgets
  declare their secrets in `widget.json`.

### Removed

- A dead touch-cleanup variable in the dashboard.

### Fixed

- Two docs typos.

### Security

- Backup widget instance passwords are now stripped from the config sent to the
  browser and on export.
- Scrutiny and network-speed widget data routes now apply the same SSRF guard
  and IP pinning as the rest of the proxy.
- Sessions now expire after a configurable lifetime (default 30 days, set with
  `SESSION_MAX_AGE_DAYS`).
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
- **Architecture**: moved from one-off widget routes to a generic, declarative
  widget system (manifest + registry + shared data endpoint)
- **Resilience**: widgets hold last-good data through brief outages instead of
  blanking; outbound fetches have hard timeouts
- **Security**: SSRF guard with IP pinning, SVG upload sanitization, secret
  stripping on export, non-root container (required a one-time `chown -R
  1000:1000` on data/icons volumes for existing installs), auth hardening
- **Admin UI**: modularized, added search/filter, accessibility fixes, import
  preview
- **i18n**: full localization added
- **Tooling**: linting, type-checking, test coverage, core docs added

[Unreleased]: https://github.com/SandObserver/stackyard/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/SandObserver/stackyard/compare/v1.5.2...v1.6.0
[1.5.2]: https://github.com/SandObserver/stackyard/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/SandObserver/stackyard/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/SandObserver/stackyard/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/SandObserver/stackyard/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/SandObserver/stackyard/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/SandObserver/stackyard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/SandObserver/stackyard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/SandObserver/stackyard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SandObserver/stackyard/releases/tag/v1.0.0
