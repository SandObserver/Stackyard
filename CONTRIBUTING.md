# Contributing

Contributions are welcome within the constraints that keep Stackyard small and auditable. A change that breaks one of these won't be merged, however useful:

- **One container**: Nginx and the Node API run together under supervisord. No extra services, no database.
- **No runtime dependencies**: the API ships zero npm runtime packages; the frontend is vanilla HTML/CSS/JS with no framework and no build step.
- Server-side is CommonJS, the frontend is ES modules.

If a feature seems to need a dependency or a build step, open an issue first.

## Development

The frontend is static; edit files under `ui/` and reload. Tests use Node's
built-in runner, with no test dependencies.

An export whose name starts with `_` exists for the tests and is not part of
what the module offers: `_internals` for functions reached directly, `_reset*`
for the hooks that clear state between tests. Anything else exported is API, and
is exported under the name it is defined with.

## Before opening a PR

These are the checks CI runs, in the order it runs them. They are defined once,
in `.github/actions/checks/action.yml`, so the list here is the whole of it:

```
npm ci
node scripts/bump-cache-busting.js --check
npm run paths:check
cd api && npm test
cd api && npx c8 check-coverage --lines 92
cd ui/test && node --test
npm run lint
npm run format:check
npm run typecheck
npm run typecheck:ui
docker build -t stackyard:ci .
```

The docker build is the slow one and is the least likely to break; the rest take
seconds. CodeQL also runs on every pull request, and a finding it reports has to
be resolved before merge.

A few of these are worth knowing about before they fail:

- **`bump-cache-busting.js --check`** verifies that every `/css/` and `/js/`
  reference carries a `?v=` stamp. Add a stylesheet or a module and reference it
  without one, and this is what fails. The hashes themselves are recomputed by
  the release build, so write `?v=1` and leave the real value alone; never edit
  a stamp by hand.
- **`npm run typecheck:ui`** typechecks every module under `ui/js` from its
  JSDoc, with no build step and nothing emitted. It has to stay clean. A new
  module needs two entries in `tsconfig.frontend.json`, the plain path and the
  `?v=*` form, because TypeScript allows one wildcard per pattern.
- **`npm run lint`** is Biome, from `node_modules`. Run it through npm: a bare
  `npx biome` resolves to an unrelated package that exits 0 without checking
  anything.

## More

- Frontend layout: [docs/frontend.md](docs/frontend.md)
- Widgets: [docs/widgets.md](docs/widgets.md)
- Translations: [docs/i18n.md](docs/i18n.md)
- Security model / reporting: [docs/security.md](docs/security.md)
