# Frontend

Static files, no build step. Plain ES modules loaded with `?v=` cache tags. Two independent pages, sharing no state:

- **Dashboard**: `ui/index.html`, `ui/js/dashboard.js`
- **Admin**: `ui/admin/index.html`, `ui/js/admin.js`

The admin writes the whole config with `POST /api/config`; the dashboard reads it on load, polls it, and reloads on change.

## Browser support

Two floors, with two different rules.

**Desktop: Safari 17.6 and newer, and current Chrome, Edge and Firefox.** The floor is the newest Safari the maintainer's test machine runs. It moves when that machine moves, not on a date. A desktop user below the floor can switch to Chrome or Firefox.

**iOS: Safari 17.0 and newer.** On iOS every browser is Safari underneath, so a user below the floor has no other browser to switch to. The floor is the lowest iOS Safari that supports every platform feature this codebase uses. The Popover API sets it, at 17.0. Raise it only when the code needs a feature the floor does not have.

`color-mix()` set the previous floor of WebKit 16.2. It is inside both floors now and constrains nothing.

There is no build step and no autoprefixer, so every vendor prefix is written by hand. The support floor, the list of prefixes that are still needed and the reason each one stays are at the top of `ui/css/tokens.css`; `ui/test/vendor-prefix-ratchet.test.mjs` fails on any prefix outside that list. It reads the stylesheets, the style blocks in widget pages, and the style strings written from `ui/js`. Note that "an unprefixed property sits beside it" is not a reason to remove one: `-webkit-backdrop-filter` is paired everywhere and still required.

### Platform identifiers

Some vendor names appear in the source as identifiers, not as references. `-apple-system` and `BlinkMacSystemFont` are font-family keywords. `apple-touch-icon` and the `apple-mobile-web-app-*` meta names are web platform names read at add-to-homescreen time. `showLabels.ios` is a stored config key. User-agent patterns match device strings. None of these can be renamed. Prose describes behaviour in neutral terms instead.

## Colour

`ui/css/tokens.css` holds the palette, the roles and the semantic sets. See [docs/design-system.md](design-system.md).

## Widgets are iframes

Every widget tile is an `<iframe>` whose URL comes from `WIDGET_TYPES` in `widget-types.js`. A bundled widget is served from this server and is not sandboxed: a sandbox would have to grant it `allow-same-origin` and would withhold nothing. A custom widget frames a URL the user supplied, and that frame is sandboxed. It keeps scripts, its own origin, forms, dialogs, pop-ups and downloads, so a real service still works; it is denied top-level navigation, so it cannot redirect the dashboard. The dashboard passes only URL, size, and title. The widget fetches its own data from `/api/widget-data/<id>` and is rendered at a fixed design size scaled to the tile. A new widget is a folder plus one registry entry, with no dashboard changes.
See [widgets.md](./widgets.md).

## Layout

One rule decides the mobile layout for both pages, in `ui/js/layout.js`.

It asks two questions. The width test is a media query rather than a stored
width, so it answers the same question the stylesheets ask. The user-agent test
covers phones that report a CSS viewport wider than 768px, which a width test
alone leaves on the desktop layout. That test is qualified by portrait, so a
phone held sideways gets the wider layout it has room for.

The module has no imports. Both entry points load it before anything else runs.

## Theme

The appearance choice is per device, not per dashboard. It is read from
`localStorage` and never written to the config, so two people opening Settings
on two machines each keep their own, and a machine keeps its own through a
config import.

"system" is resolved in JavaScript rather than by a media query. The stylesheets
carry one light block, selected by `data-theme`. A `prefers-color-scheme` copy of
it would be a second place to change every colour.

`ui/js/admin-theme.js` repeats what `theme.js` decides, so the attribute is on
`<html>` before the first paint. A parity test holds the two together.

## Badges

`dashboard.js` polls `/api/badges` and `/api/health` and paints tiles through an id-to-elements registry. Appearance is one pure function, `computeBadgeVisual` in `badge-logic.js`.

An activity source can carry a `labels` array: each entry names one value path plus its own text, unit, colour and minimum, and array order is priority order. The badge route returns a positional `values` array beside the existing `value`, so index `n` is the number for `labels[n]`; a malformed entry keeps its slot rather than shifting the rest. `computeBadgeVisual` picks the first label that reaches its minimum and returns the badges it could not draw as `rows`, which `badge-popover.js` renders in one shared element for the whole dashboard. `combine` on the source keeps the older behaviour of summing every selected value into one number.

Each of these is a single batch request. The server fetches every configured badge or health target concurrently, each bounded by `BATCH_MS`, and returns one combined object once all of them settle. A slow or unreachable upstream delays the refresh of the other tiles by up to `BATCH_MS`. `PING_MS` is longer and bounds a single connection test instead.

A target that fails three times in a row is left alone for a growing wait, up to two minutes, and its last reported failure is reused meanwhile. Only an unreachable target backs off; one that answers with an error status stays on the normal cycle. A success or a config save clears the wait. See `api/src/poll-backoff.js`.

An item that failed is reported with an error beside its value. The tile keeps its last known value and is marked out of date, so a service that did not answer never reads as zero.

A batched poll fans out to every configured target on every cycle. A target
unreachable for months costs a full timeout each time, and the batch answers
only once everything settles, so it delays the tiles that did answer. After a
few consecutive failures a target is left alone until its next attempt time and
the caller reuses the failure it already reported.

## Cache busting

`?v=` is a content hash rewritten by `scripts/bump-cache-busting.js`; do not edit one by hand. The image build runs the script, so every image carries current hashes.

nginx serves `/js/` and `/css/` with a one-year `immutable` lifetime, which is only correct because those URLs change whenever their content does. `index.html`, `/admin`, `/i18n/` and `/widgets/` stay `no-cache`.
 On `/css/` and `/js/` URLs the script rewrites the literal in the source. Widget iframe URLs are built from the manifest rather than written literally, so the script hashes each widget's entry files into `entryVersions` in its `widget.json`, and `widget-types.js` reads the hash from there when it builds the URL.
