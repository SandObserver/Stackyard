# Frontend

Static files, no build step. Plain ES modules loaded with `?v=` cache tags. Two independent pages, sharing no state:

- **Dashboard**: `ui/index.html`, `ui/js/dashboard.js`
- **Admin**: `ui/admin/index.html`, `ui/js/admin.js`

The admin writes the whole config with `POST /api/config`; the dashboard reads it on load, polls it, and reloads on change.

## Widgets are iframes

Every widget tile is a sandboxed `<iframe>` whose URL comes from `WIDGET_TYPES` in `widget-types.js`. The dashboard passes only URL, size, and title; the widget fetches its own data from `/api/widget-data/<id>` and is rendered at a fixed design size scaled to the tile. So widgets are isolated and drop-in: a new one is a folder plus one registry entry, with no dashboard changes.
See [widgets.md](./widgets.md).

## Badges

`dashboard.js` polls `/api/badges` and `/api/health` and paints tiles through an id-to-elements registry. Appearance is one pure function, `computeBadgeVisual` in `badge-logic.js`.

Each of these is a single batch request: the server fetches every configured badge (or health target) concurrently, each bounded by `PING_MS`, and returns one combined object only after all of them settle. So a slow or unreachable upstream holds back the whole batch until it times out, delaying the refresh of the other tiles by up to `PING_MS`. This is bounded and fine at homelab scale; if a dashboard ever grows large enough that one dead upstream's delay is a problem, the batch would need to stream per-tile results instead.

## Cache busting

`?v=` on `/css/` and `/js/` URLs is a content hash rewritten at release by `scripts/bump-cache-busting.js`; do not edit it. `?v=` on `/widgets/` URLs in `widget-types.js` is manual: bump it when you change a widget's own files.
