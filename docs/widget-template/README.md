# Widget template

A minimal working widget to copy from. It lives here rather than in
`ui/widgets/` so it is not registered, not served, and not shipped in the image.

To start a new widget called `mywidget`:

1. Copy this folder to `ui/widgets/mywidget/`.
2. In `widget.json`, set `name` to `mywidget` (it must match the folder name) and
   change `sizes`, `glyph` and `fields`.
3. Put the text in `i18n/en.json`. The manifest's `label`, `description`,
   `hint` and `placeholder` values are keys in that file. The description is
   one line in the widget picker. Start it with a verb.
4. Rewrite `data.js` to fetch your service, and `index.html` to draw it.
5. Optionally edit `demo.js`, which is used only when `DEMO_MODE=true`, or delete
   it if you do not need one.

`i18n/` holds one catalogue per dashboard language. Translations are optional.
Delete the other languages' files, or the whole folder, if you do not translate.
A folder you keep must hold every language with the same keys as `en.json`.
Without a catalogue, the manifest shows its values as written, so put the
text in `widget.json` in place of the keys.

The `href` field is the Link URL. `data.js` returns it as `link`, and the page
passes that to `linkTo`. When it is blank, the widget links to the server URL
if a browser can reach it.

`poll()` waits at least 3 seconds between fetches, whatever `interval` says.

The `ctx` that `data.js` receives is typed as `WidgetCtx` in
`api/src/widget-data.js`.

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
