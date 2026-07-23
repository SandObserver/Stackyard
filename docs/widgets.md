# Adding a widget

A widget is a self-contained folder under `ui/widgets/<name>/`. Everything the
dashboard needs lives in that folder, so adding a widget touches no file outside
it. The backend discovers the folder automatically, builds the admin config form
from the manifest, and serves the manifest to the dashboard, which builds the
widget's iframe URL from it.

The manifest drives the config form and the view routing; `data.js` runs
server-side and talks to the outside service; `index.html` runs in a sandboxed
iframe and only ever fetches your own API.

Copy [widget-template/](widget-template/) to `ui/widgets/<name>/` for a working
starting point.

## Folder structure

```
ui/widgets/mywidget/
  widget.json    manifest: the config form, label, and sizes
  data.js        backend function that fetches/produces the widget's data
                 (omit it if the widget renders entirely in the browser)
  index.html     frontend page that renders it
```

## 1. The manifest (widget.json)

Describes the widget: its `label`, the card `sizes` it offers, the config form,
and, for a multi-view widget, its views. `label` is the name shown in the admin
list and the type picker, and the default widget name when the user saves
without entering one. `sizes` is the set of card sizes offered.

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

### Views (multiple looks)

A widget can ship more than one frontend file and let the user pick between them
(the GitHub widget's Pull Requests and Contributions, the clock's Digital and
Analog). Declare each view and its entry file, the config field that holds the
choice, and the default:

```json
{
  "viewField": "clockStyle",
  "defaultView": "digital",
  "views": {
    "digital": { "label": "Digital", "src": "digital.html" },
    "analog":  { "label": "Analog",  "src": "analog.html" }
  }
}
```

`viewField` names a field the user sets (commonly a `select`), whose value is
matched against the `views` keys to choose the entry file. With no `views` block
the entry file is `index.html`. A single-view widget whose file is not
`index.html` still declares it as one view, with no `viewField`.

### Field types

| type | control the user sees |
|---|---|
| `text` | Inline-edit row (tap the pencil to edit). |
| `number` | Inline-edit row that stores a number. |
| `secret` | Inline-edit row for a masked value. Shows `Configured` once set. The saved value is kept server-side and never sent back to the browser, so to change it the user re-enters it; leaving it blank keeps the existing value. |
| `toggle` | On/off switch, stored as a boolean. |
| `color` | The swatch and hue/saturation/brightness control used elsewhere in the admin UI. Saves a `#rrggbb` string. |
| `select` | A dropdown by default. Add `"variant": "pills"` to render the options as a radio group instead. With `optionsFrom` it also shows a Fetch button (see below). |
| `multiselect` | A checklist dropdown; the value is an array of the chosen values. |
| `group` | A repeatable set of sub-fields, each entry rendered as its own card with Add / Remove. Put the sub-fields in a nested `"fields"` array. Groups cannot be nested inside a group or object. |
| `object` | A single nested set of sub-fields in a `"fields"` array, saved one level deep (for example `network.password`). Rendered as its own card. Objects cannot be nested inside a group or another object. |

### Field options

These keys can go on any field:

| key | meaning |
|---|---|
| `label` | Shown to the user (required). |
| `placeholder` | Greyed hint shown in an empty `text`/`number`/`secret` row. |
| `default` | Value used when none is saved yet. |
| `hint` | Short help text. Shown under the field, except on a `group`, where it renders at the bottom of the whole section. |
| `optional` | If `true`, the field is not required to save. |
| `transient` | If `true`, the field is rendered and sent to an `optionsFrom` fetch but is left out of the saved config. Use it for a search box whose text only feeds a picker. Top-level fields only. |
| `carries` | For `select` with `optionsFrom`: extra config keys this picker writes, supplied by the chosen option's `set` block. |
| `showIf` | Show the field only when another field matches: `{ "field": "provider", "equals": "adguard" }`, or match several with `{ "field": "provider", "in": ["adguard", "pihole"] }`. Inside a `group`, the named field is the one in the same row. |
| `optionsFrom` | For `select`: the name of a data endpoint that returns the option list at config time (see below). |
| `variant` | For `select`: `"pills"` renders a radio group instead of a dropdown. |
| `min` / `max` | For `group`: the fewest and most entries allowed. |
| `maxBySize` | For `group`: a per-size cap, e.g. `{ "small": 2, "medium": 5 }`. Overrides `max` for the selected widget size; falls back to `max` for sizes not listed. Extra entries are trimmed when switching to a smaller size. |

### Nested settings (object)

Use `object` when a widget already stores part of its config one level deep and
you do not want to flatten it:

```json
{ "key": "vpn", "type": "object", "label": "Connection", "fields": [
  { "key": "url", "type": "text", "label": "Control server URL" },
  { "key": "apiKey", "type": "secret", "label": "API key", "optional": true }
] }
```

That saves `{ "vpn": { "url": "...", "apiKey": "..." } }`. A sub-field's `showIf`
names a sibling inside the same object, and its secrets are scrubbed and
preserved exactly like top-level ones.

### Loading options from the service (optionsFrom)

When a `select` can only be filled in after the user enters a URL and key, give
it `"optionsFrom": "<endpoint>"` instead of static `options`. The form shows a
**Fetch** button, which calls your `data.js` with `ctx.endpoint` set to that
name; return `{ options: [ { value, label }, ... ] }`.

The fetch is sent the form's current values, including any field marked
`transient`, so a search box can supply the query without being saved.

An option can also write keys other than the field's own. List them in the
field's `carries` and return them in the option's `set`:

```json
{ "key": "city", "type": "select", "optionsFrom": "geocode", "carries": ["lat", "lon"] }
```

```js
return { options: [{ value: 'Ottawa, Ontario, Canada', label: 'Ottawa, Ontario, Canada', set: { lat: 45.42, lon: -75.7 } }] };
```

Saving picks up `city`, `lat` and `lon`. Values already saved under the carried
keys are kept when the widget is edited without touching the picker, so the
coordinates survive a change to an unrelated field.

A `select` inside a `group` can use `optionsFrom` too. Each row fetches on its
own, and `ctx.row` holds that row's values so the picker reads the URL and key
the row was filled in with:

```js
if (ctx.endpoint === 'jobs') {
  const slot = ctx.row || {};
  const r = await ctx.fetchJSON(`${ctx.normalizeBase(slot.url)}/api/jobs`, { /* ... */ });
  return { options: r.data.map(j => ({ value: j.id, label: j.name })) };
}
```

`ctx.config` still holds the whole widget config, so secrets in the row are
preserved the same way they are for a top-level field.

### customEditor (deprecated)

Three of the shipped widgets set `"customEditor": true` in their manifest, which
tells the admin UI to skip the auto-form and use a hand-written editor kept in
`ui/js/admin-widget-form.js` instead. It dates from before the auto-form covered
groups, conditional fields and fetched options.

Do not use it in a new widget. Those four are being converted to the auto-form,
and the key is removed once the last one lands. If the auto-form cannot express
what your widget needs, that is a gap worth filling in the form itself; open an
issue rather than reaching for this.

## 2. Providing data (data.js)

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
| `ctx.row` | For an `optionsFrom` fetch from a field inside a `group`, that row's values. `null` otherwise. |
| `ctx.params` | Extra query parameters from the request, as a `URLSearchParams`. |
| `ctx.fetchJSON(url, opts)` | Fetch a URL and parse the body. JSON is returned as-is; Prometheus text and XML are auto-parsed. Pass `{ raw: true }` to get the untouched text body instead, for a custom parser. Returns `{ status, data }` or throws. Respects the app's TLS-skip setting. |
| `ctx.parsePrometheus(text)` | Parse a Prometheus metrics body into an object. |
| `ctx.normalizeBase(raw)` | Tidy a user-entered base URL (add scheme, drop trailing slash). |
| `ctx.metrics` | Host metrics for stats-style widgets: `{ cpuPercent, cpuIoWait, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds }`. Each is a function. `cpuPercent()` and `cpuIoWait()` are async; the rest return directly. `cpuTemp(zone)` defaults to zone 0, `diskStats(mountPoint)` takes a mount path. |
| `ctx.dispatchProvider(handlers, opts)` | Run the handler for the provider the user picked, for a widget that supports several backends. `handlers` is `{ providerKey: async (ctx) => result }`. `opts.field` is the config field holding the key (default `provider`), `opts.default` the key to fall back to, `opts.onError(err, ctx)` an optional wrapper turning a thrown handler error into the widget's own error shape. |
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

## 3. The frontend (index.html)

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

**Links**

- `openUrl(href)` opens a link in a new tab. Use this rather than `window.open`,
  which the widget sandbox can block; it clicks a real anchor and only falls back
  to `window.open` if that throws.

**Markup**

- `esc(value)` HTML-escapes a value for `innerHTML`. Use it for anything that
  came from config or from upstream, rather than writing an escape helper per
  widget.

**Visuals** (self-contained inline SVG/DOM, no extra CSS)

- `sparkline(values, opts?)` returns an `<svg>` area+line chart element.
- `barFill(percent, opts?)` returns a track+fill bar element.
- `smoothPath(points)` returns a smoothed SVG path string through `[[x,y], ...]`.

Check the toolbox before building a new visual by hand.

## Cache-busting

Nothing to do by hand. The release build hashes each widget entry file by content
and stamps the cache version into the manifest, the same way it version-stamps
`/css/` and `/js/` imports.

## Checklist

Manifests are validated in CI, so a schema mistake fails the PR rather than
silently disabling the widget at runtime. Run the same check locally with
`cd api && node --test`.

- [ ] `ui/widgets/<name>/widget.json` with `name` (matching the folder), `label`, `sizes`, and `fields`
- [ ] `ui/widgets/<name>/data.js` exporting `module.exports = async (ctx) => ...`, for a widget that fetches. A widget that renders entirely in the browser (the clock, the dashboard switch) ships no `data.js` and never calls `/api/widget-data/`.
- [ ] `ui/widgets/<name>/index.html` that reads `?id=` and fetches `/api/widget-data/<id>`
- [ ] For a multi-view widget: a `views` block with `viewField` and `defaultView`
