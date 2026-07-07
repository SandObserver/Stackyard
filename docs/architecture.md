# Architecture

Stackyard ships as one container running two processes under supervisord: Nginx (the public entrypoint on port 80) and a dependency-free Node HTTP server on 127.0.0.1:3000. Nginx serves the static UI and reverse-proxies the API.

For the browser side (pages, widget iframes, badges, cache busting) see [frontend.md](./frontend.md); for adding a widget see [widgets.md](./widgets.md).

## Request routing (Nginx)

`nginx/dashboard.conf` splits traffic two ways:

- **Static**: the dashboard, admin, widget iframes, icons, CSS, JS, and i18n catalogs are served straight from disk out of `/usr/share/nginx/html`.
- **API**: `/api/` and `/health` are proxied to the Node server. The `/api/` location sets `no-store` and a 15s read timeout, so a slow upstream fails fast rather than hanging the browser.

## The API process

Boot order is set in `src/server.js`: it requires `routes`, `widgets`, and `widget-data` (which registers the widget data route), then starts the HTTP server with the `dispatch` handler.

Every request goes through `dispatch` in `src/router.js`, which:

1. Parses the URL and sets CORS preflight headers.
2. Enforces auth. Every path except `/health`, `/api/auth/login`, and `/api/auth/check` requires a valid session; otherwise it returns 401.
3. Matches the method and path against the route table, extracts any `:param` values, and calls the handler.

`router.js` also exports the shared helpers handlers rely on: `json`, `readBody`, `checkOrigin`, and `getIp` (honors `X-Forwarded-For` only when `TRUST_PROXY` is set).

Route handlers live in `src/routes/`: auth, config, health, badges, system, icons, backup, and version. The widget data route is registered separately by `widget-data.js`.

## Config

State is a single JSON file loaded and saved through `src/config.js`. On read, secret fields (password hash, stored widget credentials) are scrubbed before the config is sent to the browser. On write, those same fields are re-merged from disk unconditionally, so the client is never trusted to send secrets back and cannot blank them by omission.

## Widget data lifecycle

Each widget iframe fetches its own data from `GET /api/widget-data/:id`. The handler in `src/widget-data.js`:

1. Looks up the configured item by id and its type in the widget registry.
2. Builds request auth with `buildAuth`, combining the widget declaration's auth block with the secret values held in the item's server-side config.
3. Runs the widget's data handler. Widgets that support more than one backend provider select the handler through `dispatchProvider` in `src/provider-dispatch.js`, keyed off a config field, with a default handler when the field is empty or unknown.
4. The handler fetches upstream through `fetchJSON` and returns a normalized result, which is sent back to the iframe as JSON.

The registry and the toolbox handed to each handler are documented in [widgets.md](./widgets.md).

## Outbound safety (the proxy)

`src/proxy.js` is the only place the server makes outbound requests, and it is the SSRF boundary. `fetchJSON` resolve the target host and reject private, loopback, and link-local addresses via `PRIVATE_IP_RE`, unless `ALLOW_PRIVATE_IPS` is set. Beyond address checks it disables redirect following , enforces a 4 MB response cap, applies per-request timeouts, and decides TLS verification through `shouldSkipTls`. `rewriteUrl` maps the container host IP back to a container name so links that work in the browser also work from inside the network. Helpers `parsePrometheus` and `parseXml` let widget handlers consume non-JSON upstreams.

## Summary

```
browser
  -> Nginx            static files, or proxy /api and /health
  -> router.dispatch  auth gate, route match, shared helpers
  -> route handler    e.g. /api/widget-data/:id
       -> buildAuth          declaration + stored secrets
       -> dispatchProvider   pick the provider handler (multi-provider widgets)
       -> proxy.fetchJSON    SSRF guard, no redirects, size + time limits
  -> JSON back to the iframe, rendered at a fixed design size (see frontend.md)
```
