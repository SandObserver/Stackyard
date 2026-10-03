# Widget template

A minimal working widget to copy from. It lives here rather than in
`ui/widgets/` so it is not registered, not served, and not shipped in the image.

To start a new widget called `mywidget`:

1. Copy this folder to `ui/widgets/mywidget/`.
2. In `widget.json`, set `name` to `mywidget` (it must match the folder name) and
   change `label`, `sizes`, and `fields`.
3. Rewrite `data.js` to fetch your service, and `index.html` to draw it.
4. Optionally edit `demo.js`, which is used only when `DEMO_MODE=true`, or delete
   it if you do not need one.

Keep the `widget-theme.js` script in `<head>`, before the styles. Without it no
`html[data-theme="light"]` rule applies, and light text is unreadable on the
light theme's white card.

A widget of your own needs nothing outside its folder. It is picked up from its
manifest at startup.

A widget shipped with Stackyard needs two more changes. Its manifest names a
`glyph` that no other widget uses; add one to `ui/js/widget-glyphs.js` when none
is free. The main README lists it under Widgets.

`widget.json` here is validated in CI along with the shipped manifests, so this
template cannot drift out of date with the schema.

See [Build your first widget](https://stackyard.sandobserver.com/docs/create-a-widget/)
for the field types, the `ctx` reference, and the toolbox.
