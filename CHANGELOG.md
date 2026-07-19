# Changelog

## [Unreleased]

## [1.3.0] - 2026-07-18

- Badge header and URL parameter rows: aligned the field spacing with the rest
  of the form, and marked credentials with a labelled "Secret" checkbox.

- Admin badge color picker: the last swatch could be clipped at the right edge
  on narrow screens. The swatch row now wraps instead of overflowing.

- Weather widget: the bottom of the rain and shower drops was clipped. The
  precipitation clip only needs to mask the top edge where it meets the cloud,
  so it now extends to the bottom of the icon.

- Internal: the uploaded-SVG sanitizer's event-handler blocklist matched only
  three-character attribute names, so `onload`/`onerror` and the like were never
  caught by it. The allowlist already stripped them, so this was not a live hole,
  but the blocklist now matches any `on*` attribute as intended.

- The SSRF guard now blocks IPv4-in-IPv6 forms of private targets that the
  previous range check missed: hex-tailed IPv4-mapped literals (e.g.
  `::ffff:7f00:1` for 127.0.0.1) and the NAT64 well-known prefix. These affect
  the URL-checking endpoints in the admin UI. IPv6 literal targets now connect
  correctly (the bracketed form was passed to the socket unstripped).

- Security headers (X-Content-Type-Options, Referrer-Policy, Permissions-Policy,
  X-Frame-Options, Content-Security-Policy) are now sent on every response.
  nginx does not inherit server-level headers into a location that sets its own,
  so locations that set a Cache-Control header (including /icons/, the only path
  serving uploaded content) were silently sending none. The shared set now lives
  in nginx/security-headers.conf and is included per location.

- Live activity badge headers and URL parameters can each be marked as a
  credential. Credential values are stored server-side, shown as "Configured"
  and never sent back to the browser or included in a config export. Existing
  headers and parameters are migrated to the new form and default to
  non-credential, so nothing changes until you mark them. Fixes a case where an
  API key typed into a badge header was returned in plaintext by the config API.

- The folder app picker and widget multi-select dropdowns can now be operated
  from the keyboard (arrows, Home/End, Enter/Space, Escape). They were
  mouse-only.
- Inline-edit rows now open from the value text, not just the pencil, and the
  pencil's tap target is larger.
- Internal: widget manifests are validated in CI against the same validator the
  server uses at startup, so a schema mistake fails the PR instead of silently
  disabling the widget at runtime. Added `docs/widget-template/`, a working
  widget to copy from, covered by that check and by lint.
- Dock icons now show the app name on hover. They never render a label, so
  without a `title` there was nothing to show.
- Internal: removed the unused custom dropdown helper and its CSS, left over
  from the admin form rewrite, and dropped `export` from five symbols only used
  inside their own module.
- Internal: completed the `setHtml`/`html` migration. `admin-widget-form.js`,
  the remaining `admin-app-form.js` forms, `_secretRow`, and the widget config
  form chevron are migrated, and the ratchet test now also counts
  `insertAdjacentHTML` with an empty budget, so no file can write markup outside
  `setHtml` again.
- Internal: added an escape-by-default `html` tagged template plus `setHtml()`,
  in a dependency-free `ui/js/html.js`. Interpolated values are escaped unless
  wrapped in `raw()`, and `setHtml()` rejects plain strings, so writing markup no
  longer depends on remembering `esc()` at every site. `esc` moved there and is
  re-exported from `utils.js`, so its importers are unaffected. `i18n.js` and
  `admin-color-control.js` are migrated; the rest follow, held by a test that
  caps remaining direct `innerHTML` writes per file and blocks new ones.
- Internal: the innerHTML ratchet now also counts `+=` appends, which it missed
  entirely. No behaviour change; it closes a gap that let unescaped markup be
  appended in a file the test reported as clean.
- Internal: migrated `admin.js` to `setHtml`/`html`, including seven `+=` pill
  appends that now build in one write.
- Internal: migrated the widget config form rows to `setHtml`/`html`.
- Internal: migrated `dashboard.js` and the badge value list in `admin-app-form.js`
  to `setHtml`/`html`. Badge values returned by a remote service are now escaped
  on render rather than relying on the API only ever emitting numbers.
- Fixed Test Connection, and per-app health check pings, reporting on a
  different target than the widget actually fetches. When a host-IP port map is
  configured, a ping now follows the same mapping the fetch does, so it can no
  longer pass while the widget fails, or the reverse.
- Internal: `proxy.js` now exposes a single outbound boundary.
  `fetchChecked`/`pingChecked` for URLs that arrive in a request, and
  `fetchUnchecked`/`pingUnchecked` for URLs from config or hardcoded constants.
  `fetchJSON`, `pingUrl` and `guardSsrf` are no longer reachable from routes.
  The SSRF guard now runs after host rewriting rather than before, so the URL
  that gets checked is always the URL that gets connected to.
- Behaviour change, host-IP `portMap` only: a mapped target is now SSRF-checked.
  Mapping to a container name (the intended use) is unaffected; mapping to a
  private IP now needs `ALLOW_PRIVATE_IPS=true`. `portMap` has no UI and is
  hand-edited, so this is expected to affect nobody.
- Removed unused `crypto` and `log` re-exports from `auth.js`.
- Fixed uploading a custom app icon failing with an error and never applying
  the icon. The file was saved but the form never picked it up.
- Icon uploads now check that a .png or .ico really is an image, and reject an
  upload carrying more than one file instead of silently keeping the last.
- Saving from two admin tabs at once no longer silently discards one of the
  saves. The stale save now reports a conflict and asks you to reload.
- Fixed Show in Dock staying usable when the dock was already full, which saved
  the app as docked and then silently dropped it from the dashboard.
- The per-app Health Check toggle is now clearly unavailable, and says why, when
  Docker Container Health Checks are off in General.
- Toggles now show a focus ring when reached by keyboard, and an unavailable
  toggle is announced with its reason instead of being skipped.
- Saving a config with more than four dock apps is now rejected instead of
  quietly dropping the extras.

## [1.2.0] - 2026-07-15

- New: demo mode. Setting `DEMO_MODE=true` serves a read-only sample dashboard
  with fake widget activity, refuses every write, and makes no outbound
  requests. Off by default, so existing installs are unaffected.
- Admin list folders and widgets now show their own icons, and only apps can be
  dragged into a folder.
- Now Playing shows the player the session is running on.
- Dock icons now have a name for screen readers, and icons show their name on
  hover when their label is hidden.
- Fixed the backup card placeholder shifting on hover, leaving a blank band
  above the last-run line, and clipping the next-run line.
- Fixed the now-playing strand appearing detached from the tape spool.
- Fixed the desktop search overlay: an empty band above the first result, a close
  button stranded in the corner, and no Cancel button.
- Fixed the mobile search pill and activity badges rendering at double size, and
  the pill overlapping the last row of widgets.
- Fixed mobile search results rendering at double size.
- Hardened `esc()` and the SVG sanitizer.

## [1.1.0] - 2026-07-13

- The Scrutiny and network-speed widget data routes now apply the same SSRF
  guard and IP pinning as the rest of the proxy, and the two Scrutiny routes
  share one code path. If you point either widget at a private IP literal,
  set `ALLOW_PRIVATE_IPS=true` (Docker service names are unaffected).
- Backup widget instance passwords are now stripped from the config sent to the
  browser and on export, matching every other widget.
- Widget secret handling is unified on the manifest-driven path. Widgets now
  declare their secrets in `widget.json`.
- Sessions now expire after a configurable lifetime (default 30 days, set with
  `SESSION_MAX_AGE_DAYS`). Tokens carry a signed issued-at enforced server-side.
- `esc()` now escapes single quotes, closing a latent gap for values placed in
  single-quoted HTML attributes.
- Removed a dead touch-cleanup variable in the dashboard, fixed two docs typos.

---

## [1.0.0] - First public release - 2026-07-12

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

Serves plain HTTP, built for a trusted LAN, not public exposure. See
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
