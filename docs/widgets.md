# Adding a widget

A widget is a self-contained folder under `ui/widgets/<name>/`. The backend
discovers it automatically and the admin config form is generated from the
manifest. The only edit outside your folder is one entry in the widget type
registry (step 1).

The manifest drives the config form; `data.js` runs server-side and talks to the
outside service; `index.html` runs in a sandboxed iframe and only ever fetches
your own API.

Copy [widget-template/](widget-template/) to `ui/widgets/<name>/` for a working
starting point.

## Folder structure

```
ui/widgets/mywidget/
  widget.json    manifest: the config form, label, and sizes
  data.js        backend function that fetches/produces the widget's data
  index.html     frontend page that renders it
```

## 1. Register the widget type

This is the one edit outside your folder. Add an entry to `WIDGET_TYPES` in
`ui/js/widget-types.js`:

```js
mywidget: {
  label: 'My Widget',
  sizes: ['small', 'medium'],
  src: (id, item) => `/widgets/mywidget/index.html?v=1&id=${encodeURIComponent(id)}`,
},
```

- `label` is the single source of truth for the name shown in the admin list,
  the type picker, and as the default widget name if the user saves without
  entering one.
- `sizes` is the set of card sizes the widget offers, and must be a subset of
  the `sizes` in your manifest.
- `src` returns the iframe URL. It must pass `id` through (your frontend reads
  it) and carries a `?v=N` cache tag you bump yourself when you change the
  widget's frontend files. See Cache-busting at the end.

## 2. The manifest (widget.json)

Describes the config form the admin renders.

```json
{
  "name": "mywidget",
  "label": "My Widget",
  "sizes": ["small", "medium"],
  "fields": [
    { "key": "url",    "type": "text",   "label": "Service URL", "placeholder": "http://host:port" },
    { "key": "apiKey", "type": "secret", "label": "API key" },
    { "key": "source", "type": "select", "label": "Show",
      "options": [
        { "value": "recent", "label": "Recent" },
        { "value": "all",    "label": "All" }
      ]
    }
  ]
}
```

`name` must match the folder name. An invalid manifest is skipped at startup with
a logged reason rather than crashing the server, so a typo disables just that
widget.

### Field types

| type | control the user sees |
|---|---|
| `text` | Inline-edit row (tap the pencil to edit). |
| `number` | Inline-edit row that stores a number. |
| `secret` | Inline-edit row for a masked value. Shows `Configured` once set. The saved value is kept server-side and never sent back to the browser, so to change it the user re-enters it; leaving it blank keeps the existing value. |
| `toggle` | On/off switch, stored as a boolean. |
| `select` | A dropdown by default. Add `"variant": "pills"` to render the options as a radio group instead. With `optionsFrom` it also shows a Fetch button (see below). |
| `multiselect` | A checklist dropdown; the value is an array of the chosen values. |
| `group` | A repeatable set of sub-fields, each entry rendered as its own card with Add / Remove. Put the sub-fields in a nested `"fields"` array. Groups cannot be nested inside a group or object. |
| `object` | A single nested object holding sub-fields in a `"fields"` array. Not rendered by the auto-form; it exists so a `customEditor` widget can still declare secrets that live one level deep (for example `network.password`) so they are scrubbed and preserved like any other secret. |

### Field options

These keys can go on any field:

| key | meaning |
|---|---|
| `label` | Shown to the user (required). |
| `placeholder` | Greyed hint shown in an empty `text`/`number`/`secret` row. |
| `default` | Value used when none is saved yet. |
| `hint` | Short help text. Shown under the field, except on a `group`, where it renders at the bottom of the whole section. |
| `optional` | If `true`, the field is not required to save. |
| `showIf` | Show the field only when another field matches: `{ "field": "provider", "equals": "adguard" }`, or match several with `{ "field": "provider", "in": ["adguard", "pihole"] }`. |
| `optionsFrom` | For `select`: the name of a data endpoint that returns the option list at config time (see below). |
| `variant` | For `select`: `"pills"` renders a radio group instead of a dropdown. |
| `min` / `max` | For `group`: the fewest and most entries allowed. |
| `maxBySize` | For `group`: a per-size cap, e.g. `{ "small": 2, "medium": 5 }`. Overrides `max` for the selected widget size; falls back to `max` for sizes not listed. Extra entries are trimmed when switching to a smaller size. |

### Loading options from the service (optionsFrom)

When a `select` can only be filled in after the user enters a URL and key, give
it `"optionsFrom": "<endpoint>"` instead of static `options`. The form shows a
**Fetch** button, which calls your `data.js` with `ctx.endpoint` set to that
name; return `{ options: [ { value, label }, ... ] }`.

## 3. Providing data (data.js)

Runs on the backend (Node, CommonJS). Export a single async function taking
`ctx`; the saved config is on `ctx.config`.

```js
module.exports = async function (ctx) {
  const { url, apiKey } = ctx.config;
  const r = await ctx.fetchJSON(`${url}/api/items`, {
    headers: { 'X-Api-Key': apiKey },
    timeout: 8000,
  });
  return { items: r.data.slice(0, 10) };
};
```

What you return is served as-is at `/api/widget-data/<id>`. Keep upstream calls
behind `ctx.fetchJSON` so they inherit the SSRF guard, IP pinning, size limit,
and the app's TLS-skip setting.

### ctx reference

| property | what it is |
|---|---|
| `ctx.config` | The widget's saved config, including any secrets (server-side only). |
| `ctx.settings` | Global non-secret dashboard settings. |
| `ctx.endpoint` | The endpoint name, set when serving `optionsFrom` or a multi-view widget; otherwise the default. |
| `ctx.params` | Extra query parameters from the request, as a `URLSearchParams`. |
| `ctx.fetchJSON(url, opts)` | Fetch a URL and parse the body. JSON is returned as-is; Prometheus text and XML are auto-parsed. Pass `{ raw: true }` to get the untouched text body instead, for a custom parser. Returns `{ status, data }` or throws. Respects the app's TLS-skip setting. |
| `ctx.parsePrometheus(text)` | Parse a Prometheus metrics body into an object. |
| `ctx.normalizeBase(raw)` | Tidy a user-entered base URL (add scheme, drop trailing slash). |
| `ctx.buildAuth(decl, config)` | Build auth headers/params from a declared auth block. |
| `ctx.metrics` | Host metrics for stats-style widgets: `{ cpuPercent, ramPercent, cpuTemp, diskStats }`. |
| `ctx.log` | The structured logger. |

For XML responses, `ctx.fetchJSON` returns `data` keyed by the root tag:
attributes and child elements both become keys, a repeated tag becomes an array,
and a text-only element becomes that text. Numbers are converted only when they
round-trip exactly, so `007` and `1.10` stay strings.

If your `select` uses `optionsFrom`, handle that path in the same function:

```js
module.exports = async function (ctx) {
  if (ctx.endpoint === 'lists') {
    const r = await ctx.fetchJSON(`${ctx.config.url}/api/lists`, { /* ... */ });
    return { options: r.data.map(l => ({ value: l.id, label: l.name })) };
  }
  // normal poll path
  return { items: [] };
};
```

## 4. The frontend (index.html)

Runs in a sandboxed iframe scaled to the widget's design resolution. Reads its
`id` from the query string, fetches its own data, and draws it. Keep everything
inline; there is no shared widget stylesheet, and the frontend must not make
external network calls.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    *,*::before,*::after { margin:0; padding:0; box-sizing:border-box }
    html,body { width:100%; height:100%; overflow:hidden; background:transparent;
      font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif; color:#e8e8ea }
    #root { width:100%; height:100%; display:flex; align-items:center; justify-content:center }
  </style>
</head>
<body>
  <div id="root">Loading</div>
  <script>
    const id = new URLSearchParams(location.search).get('id') || '';
    const root = document.getElementById('root');
    async function tick() {
      try {
        const r = await fetch(`/api/widget-data/${encodeURIComponent(id)}`);
        const data = await r.json();
        root.textContent = `${data.items.length} items`;
      } catch (e) {
        /* leave the last good render in place on a failed poll */
      }
    }
    tick();
    setInterval(tick, 30000);
  </script>
</body>
</html>
```

The widget's saved config, if the frontend needs it, is available the same way
at `/api/widget-config/<id>`.

### Design canvas sizes

Widgets render at these fixed sizes and are scaled uniformly to fit their card.

| size | canvas |
|---|---|
| small | 170 × 170 |
| medium | 360 × 170 |
| large | 360 × 360 |
| xlarge | 360 × 540 |

Match the existing look: transparent background, system font stack, dark palette.

## Toolbox (optional)

Never required, but it bundles the repeatedly-useful frontend pieces. Import
what you need from `/js/widget-toolbox.js`:

```js
import { poll, fetchData, sparkline } from '/js/widget-toolbox.js?v=1';
```

Keep the `?v=1`; the release cache-buster maintains it, like other `/js/` imports.

**Data**

- `widgetId()` returns this widget's id (read from the iframe URL).
- `fetchData(endpoint?)` GETs `/api/widget-data/<id>` (optionally `?endpoint=`) and returns the parsed JSON, throwing on a non-OK response.
- `getConfig()` GETs this widget's secret-free config.

**State / lifecycle**

`poll(opts)` runs the fetch-and-render loop and handles loading, empty, stale,
and error states, so a single failed poll never blanks a working widget. It
replaces the hand-written loop in the example above:

```js
poll({
  render: data => { root.textContent = `${data.items.length} items`; },
  isEmpty: data => data.items.length === 0,
  interval: 30000,
});
```

A failure keeps the last good render in place; only after `staleAfter` (default
2) consecutive failures does it surface `errorText` with how long ago the last
success was. `sinceLabel(ts)` gives that "3m ago" label on its own.

**Visuals** (self-contained inline SVG/DOM, no extra CSS)

- `sparkline(values, opts?)` returns an `<svg>` area+line chart element.
- `barFill(percent, opts?)` returns a track+fill bar element.
- `smoothPath(points)` returns a smoothed SVG path string through `[[x,y], ...]`.

Check the toolbox before building a new visual by hand.

## Cache-busting

When you change your widget's frontend files, bump the `?v=N` in that widget's
`src` in `widget-types.js`. This one is manual: the release cache-buster rewrites
`?v=` on `/css/` and `/js/` imports, but not on `/widgets/` entry URLs.

## Checklist

Manifests are validated in CI, so a schema mistake fails the PR rather than
silently disabling the widget at runtime. Run the same check locally with
`cd api && node --test`.

- [ ] `ui/widgets/<name>/widget.json` with `name` (matching the folder), `label`, `sizes`, and `fields`
- [ ] `ui/widgets/<name>/data.js` exporting `module.exports = async (ctx) => ...`
- [ ] `ui/widgets/<name>/index.html` that reads `?id=` and fetches `/api/widget-data/<id>`
- [ ] One entry added to `WIDGET_TYPES` in `ui/js/widget-types.js`
- [ ] Bumped the `?v=N` in your widget's `src` when its frontend files change
