# Adding a widget

A widget is a self-contained folder under `ui/widgets/<name>/`. The backend
discovers it automatically and the admin config form is generated from a
manifest, so adding one is mostly a matter of dropping in a folder. The only
file you touch outside your folder is a single entry in the widget type
registry (step 1).

## How it fits together

Before the individual files, here is the whole loop, so the pieces have names:

1. You create a folder with three files: a manifest, a data function, and a
   frontend page.
2. The admin UI reads your **manifest** (`widget.json`) and renders a config
   form from it. When the user fills it in and saves, their answers become the
   widget's stored **config**.
3. When the widget is placed on a dashboard, the backend runs your **data
   function** (`data.js`) with that config and serves whatever it returns as
   JSON at `/api/widget-data/<id>`.
4. Your **frontend** (`index.html`) runs in a sandboxed iframe. It fetches that
   JSON itself and draws the widget.

So the manifest drives configuration, `data.js` runs server-side and talks to
the outside service, and `index.html` runs in the browser and only ever talks
to your own API.

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

Describes the config form the admin renders automatically.

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

`name` must match the folder name. The form is rendered as grouped settings
cards with the label on the left and the control on the right. An invalid
manifest is skipped at startup with a logged reason rather than crashing the
server, so a typo disables just that widget.

### Field types

| type | control the user sees |
|---|---|
| `text` | Inline-edit row (tap the pencil to edit). |
| `number` | Inline-edit row that stores a number. |
| `secret` | Inline-edit row for a masked value. Shows `Configured` once set. The saved value is kept server-side and never sent back to the browser, so to change it the user re-enters it; leaving it blank keeps the existing value. |
| `toggle` | On/off switch, stored as a boolean. |
| `select` | A dropdown by default. Add `"variant": "pills"` to render the options as a radio group instead. With `optionsFrom` it also shows a Fetch button (see below). |
| `multiselect` | A checklist dropdown; the value is an array of the chosen values. |
| `group` | A repeatable set of sub-fields, each entry rendered as its own card with Add / Remove. Put the sub-fields in a nested `"fields"` array. Groups cannot be nested. |

### Field options

These keys can go on any field:

| key | meaning |
|---|---|
| `label` | Shown to the user (required). |
| `placeholder` | Greyed hint shown in an empty `text`/`number`/`secret` row. |
| `default` | Value used when none is saved yet. |
| `hint` | Short help text shown under the field. |
| `optional` | If `true`, the field is not required to save. |
| `showIf` | Show the field only when another field matches: `{ "field": "provider", "equals": "adguard" }`, or match several with `{ "field": "provider", "in": ["adguard", "pihole"] }`. |
| `optionsFrom` | For `select`: the name of a data endpoint that returns the option list at config time (see below). |
| `variant` | For `select`: `"pills"` renders a radio group instead of a dropdown. |
| `min` / `max` | For `group`: the fewest and most entries allowed. |

### Loading options from the service (optionsFrom)

When a `select` can only be filled in after the user enters a URL and key (for
example, "pick one of your lists"), give it `"optionsFrom": "<endpoint>"`
instead of static `options`. The form then shows a **Fetch** button. Pressing
it calls your `data.js` with `ctx.endpoint` set to that name, and your function
returns `{ options: [ { value, label }, ... ] }`.

## 3. Providing data (data.js)

`data.js` runs on the backend (Node, CommonJS). Export a single async function.
It receives one `ctx` argument; the saved config is on `ctx.config`.

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

Whatever object you return is served as-is at `/api/widget-data/<id>` for your
frontend to fetch. Keep upstream calls behind `ctx.fetchJSON` so they inherit
the SSRF guard, IP pinning, size limit, and the app's TLS-skip setting.

### ctx reference

| property | what it is |
|---|---|
| `ctx.config` | The widget's saved config, including any secrets (server-side only). |
| `ctx.settings` | Global non-secret dashboard settings. |
| `ctx.endpoint` | The endpoint name, set when serving `optionsFrom` or a multi-view widget; otherwise the default. |
| `ctx.params` | Extra query parameters from the request, as a `URLSearchParams`. |
| `ctx.fetchJSON(url, opts)` | Fetch a URL and parse the body. JSON is returned as-is; Prometheus text and XML are auto-parsed. Returns `{ status, data }` or throws. Respects the app's TLS-skip setting. |
| `ctx.parsePrometheus(text)` | Parse a Prometheus metrics body into an object. |
| `ctx.normalizeBase(raw)` | Tidy a user-entered base URL (add scheme, drop trailing slash). |
| `ctx.buildAuth(decl, config)` | Build auth headers/params from a declared auth block. |
| `ctx.metrics` | Host metrics for stats-style widgets: `{ cpuPercent, ramPercent, cpuTemp, diskStats }`. |
| `ctx.log` | The structured logger. |

For XML responses, `ctx.fetchJSON` returns `data` as a nested object keyed by
the root tag: attributes and child elements both become keys, a repeated tag
becomes an array, a tag that appears once stays a single object, and a
text-only element becomes that text. Numeric values are converted only when
they round-trip exactly, so IDs like `007` and versions like `1.10` stay
strings. For example, Plex `/status/sessions` parses to
`{ MediaContainer: { size: 2, Metadata: [ { title, duration, Player: { state } } ] } }`,
the same shape its JSON response has.

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

For simple services, a widget can instead declare a `data` block (base URL key,
auth type, and named endpoints) in the manifest and skip `data.js` entirely.
None of the built-in widgets use this yet, so `data.js` is the documented path.

## 4. The frontend (index.html)

A self-contained page that runs in a sandboxed iframe scaled to the widget's
design resolution. It reads its `id` from the query string, fetches its own
data, and draws it. Keep everything inline; there is no shared widget
stylesheet, and the frontend must not make external network calls (all data
comes through your own API).

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

Widgets always render at these fixed pixel sizes and are scaled uniformly to
fit their card, so a size looks identical on every device.

| size | canvas |
|---|---|
| small | 170 × 170 |
| medium | 360 × 170 |
| large | 360 × 360 |
| xlarge | 360 × 540 |

Match the existing look: transparent background, the system font stack, and a
dark palette.

## Cache-busting

When you change your widget's frontend files, bump the `?v=N` in that widget's
`src` in `widget-types.js` so browsers fetch the new version instead of a cached
one. This bump is manual: the release cache-buster rewrites `?v=` tags on
`/css/` and `/js/` imports automatically, but not on `/widgets/` entry URLs.

## Checklist

- [ ] `ui/widgets/<name>/widget.json` with `name` (matching the folder), `label`, `sizes`, and `fields`
- [ ] `ui/widgets/<name>/data.js` exporting `module.exports = async (ctx) => ...`
- [ ] `ui/widgets/<name>/index.html` that reads `?id=` and fetches `/api/widget-data/<id>`
- [ ] One entry added to `WIDGET_TYPES` in `ui/js/widget-types.js`
- [ ] Bumped the `?v=N` in your widget's `src` when its frontend files change
