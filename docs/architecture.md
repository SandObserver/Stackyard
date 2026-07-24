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
4. Wraps the handler call in an error boundary: anything a handler throws or rejects with becomes a logged 500 for that one request instead of taking the whole process down.

`router.js` also exports the shared helpers handlers rely on: `json`, `readBody`, `checkOrigin`, and `getIp` (honors `X-Forwarded-For` only when `TRUST_PROXY` is set).

Route handlers live in `src/routes/`: auth, config, health, badges, system, icons, and version. The widget data route is registered separately by `widget-data.js`.

## Config

State is a single JSON file loaded and saved through `src/config.js`. On read, secret fields (password hash, stored widget credentials) are scrubbed before the config is sent to the browser. On write, those same fields are re-merged from disk unconditionally, so the client is never trusted to send secrets back and cannot blank them by omission.

## Widget data lifecycle

Each widget iframe fetches its own data from `GET /api/widget-data/:id`. The handler in `src/widget-data.js`:

1. Looks up the configured item by id and its type in the widget registry.
2. Runs the widget's data handler, giving it the item's server-side config including the secret values scrubbed from the browser's copy. Widgets that support more than one backend provider select the handler through `dispatchProvider` in `src/provider-dispatch.js`, keyed off a config field, with a default handler when the field is empty or unknown.
3. The handler fetches upstream through `fetchJSON` and returns a normalized result, which is sent back to the iframe as JSON.

The registry and the toolbox handed to each handler are documented in [widgets.md](./widgets.md).

## Outbound safety (the proxy)

`src/proxy.js` is the only place the server makes outbound requests, and it is the SSRF boundary.

It exposes exactly two ways out, and every caller picks one by asking where the URL came from:

- `fetchChecked` / `pingChecked`: **the URL arrived in the HTTP request** (a body field or a `?url=` param, as in `/api/ping`, `/api/badge-proxy`, `/api/truenas-proxy`, `/api/scrutiny-proxy`). Untrusted, so it is SSRF-guarded.
- `fetchUnchecked` / `pingUnchecked`: **the URL came from saved config or is a hardcoded constant** (badge and activity sources, widget data, the Unsplash/jsdelivr/GitHub endpoints). Not guarded. Anyone who can write those URLs already has config-write access, so the guard would not stop anything it could not already do. It would only block the legitimate private-IP homelab targets that are the normal case.

Do not "fix" the second group by adding the guard: that breaks normal installs. Do not drop it from the first. The blunt name is the point: `fetchUnchecked` in a new route should make a reviewer ask why.

`fetchJSON`, `pingUrl` and `guardSsrf` are private to `proxy.js` (reachable as `_internals` for tests only), so there is no unclassified fetch to reach for by accident.

Each of the four owns the whole pipeline: **rewrite, then guard the rewritten URL, then connect to it.** A ping therefore reports on the same target the matching fetch would use. Callers never handle the intermediate URL, so the URL that is checked cannot drift away from the URL that is connected to. Keep the guard downstream of every URL transformation: if a rewrite step is ever added, it goes above the guard.

The guard resolves the target host and rejects private, loopback, and link-local addresses via `PRIVATE_IP_RE` (unless `ALLOW_PRIVATE_IPS` is set), then pins the resolved IP so the connection cannot be re-pointed after the check. A blocked request throws `SsrfBlockedError`, which carries `status: 403` so a route's `catch` can forward it. `fetchJSON` itself disables redirect following, enforces a 4 MB response cap, applies per-request timeouts, and decides TLS verification through `shouldSkipTls`. `rewriteUrl` maps the container host IP back to a container name so links that work in the browser also work from inside the network. The `parse-prometheus.js` and `parse-xml.js` modules let widget handlers consume non-JSON upstreams; they hold no network logic, so they live outside this boundary and are tested on their own.

## Summary

```
browser
  -> Nginx            static files, or proxy /api and /health
  -> router.dispatch  auth gate, route match, shared helpers
  -> route handler    e.g. /api/widget-data/:id
       -> dispatchProvider   pick the provider handler (multi-provider widgets)
       -> proxy.fetchJSON    SSRF guard, no redirects, size + time limits
  -> JSON back to the iframe, rendered at a fixed design size (see frontend.md)
```
