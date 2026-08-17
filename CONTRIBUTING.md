# Contributing

Contributions are welcome within the constraints that keep Stackyard small and auditable. A change that breaks one of these will not be merged:

- **One container**: Nginx and the Node API run together under supervisord. No extra services, no database.
- **No runtime dependencies**: the API ships zero npm runtime packages; the frontend is vanilla HTML/CSS/JS with no framework and no build step.
- Server-side is CommonJS, the frontend is ES modules.

If a feature seems to need a dependency or a build step, open an issue first.

## Development

The frontend is static; edit files under `ui/` and reload. Unit tests use Node's
built-in runner and need nothing installed; coverage and the browser tests use
the dev tooling in the root `package.json`.

An export whose name starts with `_` exists for the tests and is not part of
what the module offers: `_internals` for functions reached directly, `_reset*`
for the hooks that clear state between tests. Anything else exported is API, and
is exported under the name it is defined with.

## Before opening a PR

These are the checks CI runs, in the order it runs them. They are defined once,
in `.github/actions/checks/action.yml`, so the list here is the whole of it:

```
npm ci
node scripts/changelog-check.js
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

CodeQL also runs on every pull request. A finding it reports has to be resolved
before merge.

- **`changelog-check.js`** verifies the structure of `CHANGELOG.md`: the Keep a
  Changelog header, the six section names, a real date on every released
  version, descending versions, and a compare link per version. Structure fails
  the check. Style problems in `[Unreleased]`, such as a rationale clause or a
  three-sentence entry, print as warnings on the pull request and do not fail
  it. Releasing is documented in [docs/releasing.md](docs/releasing.md).
- **`bump-cache-busting.js --check`** verifies that every `/css/` and `/js/`
  reference carries a `?v=` stamp. The release build recomputes the hashes, so
  write `?v=1` and never edit a stamp by hand.
- **`npm run typecheck:ui`** typechecks every module under `ui/js` from its
  JSDoc, with no build step and nothing emitted. It has to stay clean. A new
  module needs two entries in `tsconfig.frontend.json`, the plain path and the
  `?v=*` form, because TypeScript allows one wildcard per pattern.
- **Test code is linted and formatted** along with everything else, with a few
  rules relaxed for `api/test`, `api/test-support` and `ui/test` in `biome.json`:
  a stub whose signature has to match a real one keeps its unused parameter, a
  scanner keeps `while ((m = re.exec(s)))`, and `'use strict'` stays where a test
  depends on strict-mode semantics.

  They are **not** typechecked. `checkJs` over `api/test` reports 131 errors,
  almost all narrowing around Node's `server.address()` in test harnesses.
  Changing that is its own piece of work, not a side effect of something else.

- **`npm run lint`** is Biome, from `node_modules`. Run it through npm: a bare
  `npx biome` resolves to an unrelated package that exits 0 without checking
  anything.

## More

- Frontend layout: [docs/frontend.md](docs/frontend.md)
- Widgets: [docs/widgets.md](docs/widgets.md)
- Translations: [docs/i18n.md](docs/i18n.md)
- Security model / reporting: [docs/security.md](docs/security.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
