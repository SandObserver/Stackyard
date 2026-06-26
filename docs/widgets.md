# Adding a widget

A widget is a self-contained folder under `ui/widgets/<name>/`. The backend discovers it automatically; the admin config form is generated from a manifest.

## Folder structure

```
ui/widgets/mywidget/
  widget.json   — manifest (config form, label, sizes)
  data.js       — backend data function
  index.html    — frontend render canvas
```

## 1. Register the widget type

Add one entry to `WIDGET_TYPES` in `ui/js/widget-types.js`:

```js
mywidget: {
  label: 'My Widget',
  sizes: ['small', 'medium'],
  src: (id, item) => `/widgets/mywidget/index.html?v=1&id=${encodeURIComponent(id)}`
},
```

`label` is the single source of truth. It appears in the admin list, the type picker, and as the default widget name when the user saves without entering one.

That's the only file outside your widget folder you need to edit.

## 2. widget.json

Describes the config form the admin UI renders automatically.

```json
{
  "name": "mywidget",
  "label": "My Widget",
  "sizes": ["small", "medium"],
  "fields": [
    { "key": "url",      "type": "text",   "label": "Service URL", "placeholder": "http://host:port" },
    { "key": "apiKey",   "type": "secret", "label": "API key" },
    { "key": "source",   "type": "select", "label": "Show",
      "options": [
        { "value": "recent", "label": "Recent" },
        { "value": "all",    "label": "All" }
      ]
    }
  ]
}
```

### Field types

| type | description |
|---|---|
| `text` | Plain text input |
| `secret` | Masked input, stored encrypted at rest |
| `select` | Dropdown or pill picker (`"variant": "pills"`) |
| `toggle` | Boolean on/off |
| `number` | Numeric input |

### Field options

| key | description |
|---|---|
| `hint` | Short help text shown below the field |
| `optional` | If `true`, skips required validation |
| `showIf` | Conditionally show: `{ "field": "key", "equals": "value" }` or `{ "field": "key", "in": ["a","b"] }` |
| `optionsFrom` | For `select` fields: fetches options at config time by calling `data.js` with `?endpoint=<value>` |

## 3. data.js

The backend calls your exported function once per poll. It receives a `ctx` object and the widget's saved config.

```js
export default async function(ctx, config) {
  const data = await ctx.fetchJSON(config.url + '/api/items', {
    headers: { 'X-Api-Key': config.apiKey },
    timeout: 8000,
  });
  return { items: data.slice(0, 10) };
}
```

### ctx methods

| method | description |
|---|---|
| `ctx.fetchJSON(url, opts)` | Fetch and parse JSON. Returns `{ status, data }` on success or throws. Respects the app's TLS skip setting. |
| `ctx.fetch(url, opts)` | Raw fetch, same TLS handling. |
| `ctx.config` | The widget's saved config object (same as the `config` argument). |

If `widget.json` uses `optionsFrom`, your function also handles config-time list fetching:

```js
export default async function(ctx, config) {
  if (ctx.endpoint === 'lists') {
    const r = await ctx.fetchJSON(config.url + '/api/lists', { ... });
    return { options: r.map(l => ({ value: l.id, label: l.name })) };
  }
  // normal poll path
  return { items: [...] };
}
```

## 4. index.html

It runs inside a sandboxed iframe scaled to the widget's design resolution. Poll data arrives via `postMessage`.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/css/widget-base.css">
</head>
<body>
  <div id="root"></div>
  <script>
    window.addEventListener('message', e => {
      if (e.data?.type !== 'data') return;
      const { items } = e.data.payload;
      document.getElementById('root').textContent = items.length + ' items';
    });
  </script>
</body>
</html>
```

Design canvas sizes (pixels, before scaling):

| size | canvas |
|---|---|
| small | 170 × 170 |
| medium | 360 × 170 |
| large | 360 × 360 |
| xlarge | 360 × 540 |

Use `widget-base.css` for the base reset and font. Match the existing widget aesthetic: dark background (`#1c1c1e`), system font stack, no external network calls from the frontend.

## Checklist

- [ ] `ui/widgets/<name>/widget.json` — manifest with `name`, `label`, `sizes`, `fields`
- [ ] `ui/widgets/<name>/data.js` — default export async function
- [ ] `ui/widgets/<name>/index.html` — render canvas
- [ ] One entry added to `WIDGET_TYPES` in `ui/js/widget-types.js`
- [ ] Bump the `?v=` query string on `widget-types.js` in `ui/js/dashboard.js` and any other importer if you changed that file
