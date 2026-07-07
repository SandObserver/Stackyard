# Contributing

Contributions are welcome within the constraints that keep Stackyard small and auditable. A change that breaks one of these won't be merged, however useful:

- **One container**: Nginx and the Node API run together under supervisord. No extra services, no database.
- **No runtime dependencies**: the API ships zero npm runtime packages; the frontend is vanilla HTML/CSS/JS with no framework and no build step.
- Server-side is CommonJS, the frontend is ES modules.

If a feature seems to need a dependency or a build step, open an issue first.

## Development

The frontend is static; edit files under `ui/` and reload. The API has tests (Node's built-in runner, no test deps). Run them before opening a PR:

```
cd api && node --test
```

`?v=` cache-busting hashes are recomputed at build time; don't edit them by hand.

## More

- Frontend layout: [docs/frontend.md](docs/frontend.md)
- Widgets: [docs/widgets.md](docs/widgets.md)
- Translations: [docs/i18n.md](docs/i18n.md)
- Security model / reporting: [docs/security.md](docs/security.md)
