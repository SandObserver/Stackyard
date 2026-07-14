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
- **UI**: the dashboard shows a "Live demo with sample data" notice.

Auth is disabled in the demo config and `set-password` is blocked, so the
instance cannot be claimed.

## Sample data

`api/src/demo-data.js` generates fake system metrics, DNS counts, a now-playing
session, weather, a GitHub contribution calendar, backup status, activity badges,
and one deliberately unhealthy app, so the dashboard looks alive across polls.

## Safety

`api/test/demo.test.js` fails the build if the demo config contains a host outside
a small public allowlist, a private IP address, or any secret-shaped value. Keep
demo apps on placeholder hosts and use icon shorthand names (resolved by the
public icon CDN) rather than full URLs.

## Deploying on Render

`render.yaml` runs a published release image with `DEMO_MODE=true`. Pin
`image.url` to a release tag so the demo only moves when you update it.

Note the pinned `PORT=3000`: Render injects `PORT=10000`, the API reads `PORT`,
and nginx proxies to `127.0.0.1:3000`, so the value must be overridden. Nginx
serves on 80, which Render detects.

To put it on a subdomain, add the domain in Render, then create a CNAME at your
DNS provider pointing to the service's `onrender.com` hostname. On the free plan
the service sleeps when idle, so the first request after a pause is slow.
