# Widget template

A minimal working widget to copy from. It lives here rather than in
`ui/widgets/` so it is not registered, not served, and not shipped in the image.

To start a new widget called `mywidget`:

1. Copy this folder to `ui/widgets/mywidget/`.
2. In `widget.json`, set `name` to `mywidget` (it must match the folder name) and
   change `label`, `sizes`, and `fields`.
3. Add an entry to `WIDGET_TYPES` in `ui/js/widget-types.js`.
4. Rewrite `data.js` to fetch your service, and `index.html` to draw it.

`widget.json` here is validated in CI along with the shipped manifests, so this
template cannot drift out of date with the schema.

See [../widgets.md](../widgets.md) for the field types, the `ctx` reference, and
the toolbox.
