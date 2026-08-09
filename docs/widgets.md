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

## Contents

**Build a widget**  [Folder structure](#folder-structure) · [1. The manifest](#1-the-manifest-widgetjson) · [2. Providing data](#2-providing-data-datajs) · [3. The frontend](#3-the-frontend-indexhtml) · [Cache-busting](#cache-busting) · [Checklist](#checklist)

**Reference**  [Manifest](#reference-the-manifest) · [data.js](#reference-datajs) · [Frontend](#reference-the-frontend) · [Toolbox](#toolbox-optional)

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

Views, card backgrounds, every field type and the option pickers are in [the manifest reference](#reference-the-manifest).

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

The full `ctx` API, how to report a failure, and demo mode are in [the data.js reference](#reference-datajs).

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

The iframe's URL parameters, the widget CSP, text direction, the mobile active-state protocol and the canvas sizes are in [the frontend reference](#reference-the-frontend).

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

---

# Reference

Lookup material for a widget already under way. The walkthrough above is the
other half of this page.

## Reference: the manifest

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

`viewField` must name a field the manifest declares, and if that field lists
`options`, its values and the `views` keys must be the same set. A manifest that
breaks either rule is rejected, because both failures are otherwise silent: a
`viewField` matching no field reads as permanently unset, so the widget pins to
`defaultView` and the selector does nothing, and an option with no matching view
selects a view that does not exist. A field using `optionsFrom` is not checked
against the views, since its choices are fetched at runtime.

### Card background

The card behind the widget is glass by default: dark, semi-transparent, blurred,
so the wallpaper reads through. A widget that wants a different card names one of
three backgrounds:

| `card` | what it looks like |
| --- | --- |
| `dark` | Solid dark, `#1c1c1e`. Nothing shows through. |
| `light` | Solid white. Nothing shows through. |
| `translucent` | Darker than the default but more transparent, with a stronger blur. |

```json
{ "card": "dark" }
```

A `card` inside a `views` entry overrides the widget-level one for that view, so
one view can be solid while another stays translucent:

```json
{
  "views": {
    "map": { "src": "map.html", "card": "dark" },
    "vpn": { "src": "vpn.html", "card": "translucent" }
  }
}
```

Declaring nothing keeps the default glass, which is what a widget wants when it
paints its own interior. The weather widget does this: it fills its own body with
white by day and dark by night, following the weather region rather than the
dashboard, which no fixed choice here could express.

An unknown name is rejected and the widget is skipped, the same as any other
invalid manifest.

Under the operating system's increased-contrast setting, `translucent` becomes as
dense as the default card, since a contrast request outranks a transparency
preference. Solid backgrounds already meet it and keep their colour.

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
| `picklist` | A fixed number of dropdowns filled from one shared fetch. Saves an array of scalars, one per row, `null` where unset. Needs `count` or `countBySize`, plus `options` or `optionsFrom`. `rowLabel` names the rows, defaulting to `label`. |
| `object` | A single nested set of sub-fields in a `"fields"` array, saved one level deep (for example `network.password`). Rendered as its own card. Objects cannot be nested inside a group or another object. |

### Field options

These keys can go on any field:

| key | meaning |
|---|---|
| `label` | Shown to the user (required). |
| `placeholder` | Greyed hint shown in an empty `text`/`number`/`secret` row. |
| `default` | Value used when none is saved yet. |
| `hint` | Short help text. Shown under the field, except on a `group`, where it renders at the bottom of the whole section. |
| `optional` | If `true`, the field is not required to save. A required `secret` is only reported as missing when nothing is stored yet, since a blank input means "keep the stored value". |
| `transient` | If `true`, the field is rendered and sent to an `optionsFrom` fetch but is left out of the saved config. Use it for a search box whose text only feeds a picker. Top-level fields only. |
| `carries` | For `select` with `optionsFrom`: extra config keys this picker writes, supplied by the chosen option's `set` block. |
| `showIf` | Show the field only when another field matches: `{ "field": "provider", "equals": "adguard" }`, or match several with `{ "field": "provider", "in": ["adguard", "pihole"] }`. Inside a `group`, the named field is the one in the same row. Must be an object naming one of the field's own siblings, with `equals` or a non-empty `in`; anything else is rejected, since a condition that cannot resolve hides the field for good rather than reporting itself. |
| `optionsFrom` | For `select`: the name of a data endpoint that returns the option list at config time (see below). |
| `variant` | For `select`: `"pills"` renders a radio group instead of a dropdown. |
| `min` / `max` | For `group`: the fewest and most entries allowed. |
| `maxBySize` | For `group`: a per-size cap, e.g. `{ "small": 2, "medium": 5 }`. Overrides `max` for the selected widget size; falls back to `max` for sizes not listed. Extra entries are trimmed when switching to a smaller size. |
| `countBySize` | For `group`: a per-size fixed row count, e.g. `{ "small": 1, "medium": 3 }`. The section always shows exactly that many rows, with no Add or Remove. Overrides `min`, `max` and `maxBySize` for the sizes it names. |

### Varying a field by another field's value

Two sibling fields may share a `key`, so the same saved value can be asked for
differently depending on another field. Give each declaration a `showIf`:

```json
{ "key": "url", "type": "text", "label": "Metrics URL", "placeholder": "conduit:9090",
  "showIf": { "field": "type", "equals": "conduit" } },
{ "key": "url", "type": "text", "label": "Management API URL", "placeholder": "netbird:33073",
  "showIf": { "field": "type", "equals": "netbird" } }
```

Hidden fields are skipped when values are read back, so only the visible one is
saved. A repeated key without a `showIf` on every declaration is rejected by the
validator, because two visible fields writing one key would silently leave the
last one to win. The validator does not check that the conditions are mutually
exclusive; that is on you.

### Limiting sizes per view

A view can narrow the widget's own `sizes`, for a layout that only works at one
size:

```json
"views": {
  "map": { "label": "Map", "src": "connections-map.html", "sizes": ["medium"] },
  "vpn": { "label": "VPN", "src": "connections-vpn.html" }
}
```

Each entry must be a subset of the widget's top-level `sizes`. A view without
`sizes` offers all of them. The size tiles redraw when the `viewField` changes.

### A fixed list of picks (picklist)

For a widget that stores a plain array of ids, one per physical slot, and fills
them all from one call:

```json
{ "key": "bays", "type": "picklist", "label": "Bays", "rowLabel": "Bay",
  "optionsFrom": "devices", "countBySize": { "small": 4, "medium": 10 } }
```

One Fetch button loads the options once and every row shares them, rather than
each row fetching for itself. The saved value is `["sda-abc", null, ...]`, always
`count` entries long.

A `group` whose `min` equals its `max` is fixed-length too: it renders that many
rows with no Add or Remove.

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

## Reference: data.js

### ctx reference

| property | what it is |
|---|---|
| `ctx.config` | The widget's saved config, including any secrets (server-side only). |
| `ctx.settings` | A frozen copy of the dashboard settings shared with widgets. An allowlist, currently `stats` only (so `ctx.settings.stats?.diskMount`). Everything else, including `auth` and `server`, is withheld. To share another key, add it to `SHARED_KEYS` in `api/src/widget-settings.js` and document it here. |
| `ctx.endpoint` | The endpoint name, set when serving `optionsFrom` or a multi-view widget; otherwise the default. |
| `ctx.row` | For an `optionsFrom` fetch from a field inside a `group`, that row's values. `null` otherwise. |
| `ctx.params` | Extra query parameters from the request, as a `URLSearchParams`. |
| `ctx.fetchJSON(url, opts)` | Fetch a URL and parse the body. JSON is returned as-is; Prometheus text and XML are auto-parsed. Metrics are recognised from `application/openmetrics-text` or `text/plain; version=0.0.4`, or from a bare `text/plain` containing a `# TYPE` comment; anything else plain-text comes back as a string. Pass `{ raw: true }` to get the untouched text body instead, for a custom parser. Returns `{ status, data }` or throws. Respects the app's TLS-skip setting. |
| `ctx.parsePrometheus(text)` | Parse a Prometheus metrics body into an object. Non-string input gives an empty object rather than throwing, as `ctx.fetchJSON`'s XML parsing does, so handing it an already-parsed body is not fatal. Uncapped: the response size limit already bounds it. |
| `ctx.normalizeBase(raw)` | Tidy a user-entered base URL (add scheme, drop trailing slash). |
| `ctx.metrics` | Host metrics for stats-style widgets: `{ cpuSample, ramPercent, cpuTemp, diskStats, procCount, uptimeSeconds }`. Each is a function. `cpuSample()` is async and returns `{ cpu, iowait }` (both percentages) from a single sampling window; the rest return directly. `cpuTemp(zone)` defaults to zone 0, `diskStats(mountPoint)` takes a mount path. These read the host's `/proc` and `/sys`, so they report host-wide usage, not the container's cgroup limits. |
| `ctx.dispatchProvider(handlers, opts)` | Run the handler for the provider the user picked, for a widget that supports several backends. `handlers` is `{ providerKey: async (ctx) => result }`. `opts.field` is the config field holding the key (default `provider`), `opts.default` the key to fall back to. `opts.onError(err, ctx)` can turn a thrown handler error into a result, but rarely should: letting it propagate is what puts the failure through the poll lifecycle. |
| `ctx.fail(message, opts)` | Report a failure. Throws, so it never returns. `message` is shown to the user as written; `opts.kind` is one of `ctx.KIND.*` (default `UPSTREAM`). See "Reporting a failure" below. |
| `ctx.KIND` | The error kinds, for `ctx.fail`: `AUTH`, `INVALID`, `UPSTREAM`, `NETWORK`, `TIMEOUT`, `BLOCKED`, `INTERNAL`. See [api-errors.md](./api-errors.md). |
| `ctx.log` | The structured logger. |

For XML responses, `ctx.fetchJSON` returns `data` keyed by the root tag:
attributes and child elements both become keys, a repeated tag becomes an array,
and a text-only element becomes that text. Numbers are converted only when they
round-trip exactly, so `007` and `1.10` stay strings.

Parsed XML and Prometheus objects have a null prototype, because their keys are
names taken verbatim from the response. Read them with property access,
`Object.keys`, spread and `JSON.stringify` as usual, but call `Object.hasOwn(o,
k)` rather than `o.hasOwnProperty(k)`, which they do not inherit. The gain is
that a feed emitting a field called `__proto__`, `constructor` or `toString`
yields an ordinary key holding the real value instead of silently vanishing or
resolving to something from `Object.prototype`.

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

### Reporting a failure

Throw. Never return an error as data.

```js
if (!config.apiKey) ctx.fail('API key not configured', { kind: ctx.KIND.INVALID });
if (r.status === 401) ctx.fail('Auth failed — check the API key', { kind: ctx.KIND.AUTH });
if (r.status >= 400) ctx.fail('Service HTTP ' + r.status);
```

A thrown failure becomes a 502, so `fetchData` rejects and the frontend's
`poll()` treats it as a failure: it counts toward `staleAfter`, keeps the last
good render in place and reports how long ago the data was fresh. A returned
`{ error: ... }` arrives as HTTP 200, which `poll()` records as a success, so
the retry and staleness handling never runs and the widget has to detect the
error itself.

There is no need to catch what `ctx.fetchJSON` throws. Letting it propagate is
what classifies it: a refused connection is reported as a network failure, a
deadline as a timeout, and the outbound guard as blocked, each with the right
`kind`.

`ctx.fail` rather than `throw new Error` because a thrown message is normally
replaced with a generic one before it reaches the browser, since an arbitrary
message may carry a hostname, a path or an upstream response body. `ctx.fail`
says the message contains only words you chose, so it is sent as written. Do not
build one by interpolating an upstream response or a caught error; a status code
is fine.

An error field *inside* a successful result is a different thing and is still
correct. A widget reporting several services, or several disk bays, marks the
one that failed and returns the rest:

```js
return { services: [{ name: 'VPN', error: 'Auth required' }, { name: 'Proxy', connected: true }] };
```

### Demo mode (demo.js)

The public demo has no reachable services, so a widget can ship a `demo.js`
beside its `data.js` returning an invented body. It is optional, and it is only
required when the dashboard runs with `DEMO_MODE=true`, so it costs a normal
install nothing.

```js
module.exports = function (ctx) {
  const { wave, round } = ctx.demo;
  return { items: [{ name: 'Example' }], total: Math.round(wave(600, 8, 20)) };
};
```

It receives the same `ctx` as `data.js`, plus `ctx.demo` holding `wave` and
`round`. `wave(periodSec, min, max, phase)` is a clock-driven oscillation, so
numbers built with it drift between polls and every widget on the demo moves
together. Structural data that should not reshuffle, like a calendar grid, is
better built once and cached in a module-level variable.

A widget with no `demo.js` runs its real `data.js` on the demo. That is the right
choice when the data does not come from an unreachable service: the stats widget
has none, because `ctx.metrics` already returns invented host figures and the
real code path then gets exercised.

Only the widget's own polling gets a demo body. A config-time `optionsFrom`
fetch always runs the real code, so a visitor pressing Fetch in the settings sees
it fail rather than a list of options that do not exist.

## Reference: the frontend

### What the iframe is given

The dashboard builds the iframe URL, and it carries more than the id:

| parameter | what it is |
|---|---|
| `id` | The dashboard item's id. Pass it to `/api/widget-data/<id>` and `/api/widget-config/<id>`. |
| `size` | The size the user placed this widget at, one of the `sizes` in the manifest. Read it to draw a denser or sparser layout; the canvas is a fixed size per family, so nothing has to be measured. |
| `mobile` | `1` on the mobile layout, absent otherwise. |
| `lang` | The selected language code. The toolbox uses it for its own status text and for `wt()`, which reads the widget's own catalog at `i18n/<code>.json`. See [i18n.md](./i18n.md). |
| `v` | The cache version, stamped at release. Nothing to read. |

### What a widget page may load

The widget iframe has a stricter Content-Security-Policy than the dashboard.
Scripts and styles must be inline or same-origin, `connect-src` is `'self'`, so
the only host a widget can call is Stackyard itself, and images may come from
the icon CDN or a `data:` URI. Reach an external service through `data.js`, which
has the SSRF guard and the app's TLS settings; a widget page cannot reach one
directly and should not try.

### Text direction

The dashboard gives the frame its own direction and language when it mounts the
widget, so a widget folder needs no code for this and must not set `dir` on its
own `<html>`. In Persian the frame becomes right-to-left and text, flex rows and
grid columns reverse with it.

Write spacing that sits next to text with the logical properties, so it reverses
too:

```css
.flag  { margin-inline-end: 5px }   /* not margin-right */
.meta  { padding-inline-start: 13px }
.left  { border-inline-end: 1px solid ... }
```

`left: 0; right: 0` on an absolutely positioned box is symmetric and needs no
change, `left: 50%` with a translate is centring, and artwork is artwork:
mirroring a drawing is usually wrong. The rule is enforced for the properties
that carry text, in `ui/test/rtl-logical-properties.test.mjs`.

Content that reads the same in every language, such as an IP address, a log
tail, a chart axis or a keyboard shortcut, can and should pin its own direction.
Do that on the element, never on the document:

```html
<div dir="ltr">10.0.0.1</div>
```
```css
.log { direction: ltr }        /* a container, not html or body */
```

A widget that is direction-independent throughout wraps its content and pins
the wrapper. `dir` on `<html>` or `<body>`, and `direction` on `html`, `body` or
`:root`, are refused by the test: those are the document's direction, the
dashboard sets it, and a widget that overrides it stops following the app.

### Mobile active state

A widget with an interior state a tap turns on, such as a selected row, has to
take part in one small protocol, or two widgets end up active at once and a tap
on the background leaves the state stuck on.

Post a message when the widget becomes active, and expose a function the
dashboard calls to reset it:

```js
/* Addressed to our own origin: the parent is always the dashboard. */
parent.postMessage({ type: 'widget-active' }, window.location.origin);

window.__clearActive = () => { /* drop the active state, hide any tooltip */ };
```

The dashboard resets every other widget when it receives that message, and calls
`__clearActive` directly when a tap lands outside any widget. Resetting is a
call rather than a message, since the frames are same-origin, so a widget needs
no `message` listener of its own. If you add one anyway, check `e.origin`
against `window.location.origin` first.

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
