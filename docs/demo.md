# Public demo

`DEMO_MODE=true` turns an instance into a read-only public showcase. It is off by
default and has no effect on a normal install.

## What demo mode changes

- **Config**: served from the bundled `api/demo/demo-config.json`. Nothing is read
  from or written to disk, so no visitor can change what anyone else sees.
- **Writes**: every persisting endpoint (config save, Unsplash key, icon upload,
  set-password, auth toggle, dismiss-setup) returns 403 with a short message,
  which the admin UI shows as a toast.
- **Outbound**: `fetchJSON` and `pingUrl` short-circuit, so the server makes no
  outbound requests at all. Widget activity comes from `api/src/demo-data.js`.

Auth is disabled in the demo config and `set-password` is blocked, so the
instance cannot be claimed.

## Sample data

`api/src/demo-data.js` generates fake system metrics, DNS counts, now-playing
sessions, a reading list, weather, a GitHub contribution calendar, backup status,
activity badges, and one deliberately unhealthy app, so the dashboard looks alive
across polls.

Each body must match the shape its widget renders, which is documented at the top
of that widget's `data.js`. `api/test/demo-data.test.js` pins the ones that are
easy to get wrong: now-playing `progress` is 0..1, not a percentage.

## Wallpaper

The demo ships `ui/demo-wallpaper.jpg`, served same-origin from the nginx root at
`/demo-wallpaper.jpg`. Keeping it local avoids an outbound request and stays
within the `img-src` CSP, which does not allow arbitrary remote image hosts.

Image by [StockSnap](https://pixabay.com/users/stocksnap-894430/) from
[Pixabay](https://pixabay.com/), used under the Pixabay Content License.

## Safety

`api/test/demo.test.js` fails the build if the demo config contains a host outside
a small public allowlist, a private IP address, or any secret-shaped value. Keep
demo apps on placeholder hosts and use icon shorthand names (resolved by the
public icon CDN) rather than full URLs. Shorthands resolve against
`homarr-labs/dashboard-icons` only; anything from `selfhst/icons` needs a full
jsdelivr URL.

The same test pins the item counts and the tile colors, so adding a widget or an
app to the demo means updating it deliberately rather than by accident.

## Deploying on Render

`render.yaml` runs a published release image with `DEMO_MODE=true`. Pin
`image.url` to a release tag so the demo only moves when you update it.

Set `PORT=80`. Render routes traffic to whatever `PORT` says, and nginx is the
process serving the dashboard on 80. The API is unaffected: `supervisord.conf`
pins `PORT=3000` for the API process, and nginx proxies to `127.0.0.1:3000`.
Pointing `PORT` at 3000 sends visitors to the API instead of nginx, which answers
every page with `{"error":"Not found"}`.

To put it on a subdomain, add the domain in Render, then create a CNAME at your
DNS provider pointing to the service's `onrender.com` hostname. On the free plan
the service sleeps when idle, so the first request after a pause is slow.
