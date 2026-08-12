# Frontend

Static files, no build step. Plain ES modules loaded with `?v=` cache tags. Two independent pages, sharing no state:

- **Dashboard**: `ui/index.html`, `ui/js/dashboard.js`
- **Admin**: `ui/admin/index.html`, `ui/js/admin.js`

The admin writes the whole config with `POST /api/config`; the dashboard reads it on load, polls it, and reloads on change.

## Browser support

Safari and iOS Safari 16.2 and newer, and current Chrome, Edge and Firefox. 16.2 is where `color-mix()` lands, which the admin's category chips derive their tints from.

There is no build step and no autoprefixer, so every vendor prefix is written by hand. The support floor, the list of prefixes that are still needed and the reason each one stays are at the top of `ui/css/tokens.css`; `ui/test/vendor-prefix-ratchet.test.mjs` fails on any prefix outside that list. Note that "an unprefixed property sits beside it" is not a reason to remove one: `-webkit-backdrop-filter` is paired everywhere and still required.

## Colour

`ui/css/tokens.css` holds two layers. A palette names Apple's system colours by hue (`--sy-teal`, `--sy-red`), each with a `-hi` partner carrying Apple's increased-contrast value; the `prefers-contrast: more` block swaps the whole palette to the `-hi` set. On top, roles name what a colour is for (`--accent`, `--danger`, `--success`) and point at a hue, so changing the accent is one line.

Dark values only.

Rules should name a role. A colour written as a literal outside `tokens.css` fails `ui/test/css-tokens.test.mjs`, which also checks that every `var()` names a token that exists. Page-specific surfaces and greys are not part of the system palette and live in that page's own `:root`.

## Widgets are iframes

Every widget tile is a sandboxed `<iframe>` whose URL comes from `WIDGET_TYPES` in `widget-types.js`. The dashboard passes only URL, size, and title. The widget fetches its own data from `/api/widget-data/<id>` and is rendered at a fixed design size scaled to the tile. A new widget is a folder plus one registry entry, with no dashboard changes.
See [widgets.md](./widgets.md).

## Badges

`dashboard.js` polls `/api/badges` and `/api/health` and paints tiles through an id-to-elements registry. Appearance is one pure function, `computeBadgeVisual` in `badge-logic.js`.

Each of these is a single batch request. The server fetches every configured badge or health target concurrently, each bounded by `BATCH_MS`, and returns one combined object once all of them settle. A slow or unreachable upstream delays the refresh of the other tiles by up to `BATCH_MS`. `PING_MS` is longer and bounds a single connection test instead.

An item that failed is reported with an error beside its value. The tile keeps its last known value and is marked out of date, so a service that did not answer never reads as zero.

## Cache busting

`?v=` is a content hash rewritten at release by `scripts/bump-cache-busting.js`; do not edit one by hand. On `/css/` and `/js/` URLs the script rewrites the literal in the source. Widget iframe URLs are built from the manifest rather than written literally, so the script hashes each widget's entry files into `entryVersions` in its `widget.json`, and `widget-types.js` reads the hash from there when it builds the URL.
