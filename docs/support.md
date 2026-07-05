# Support

Thanks for using Stackyard. This page covers where to get help, how to file a
useful bug report, and fixes for the problems that come up most often.

## Where to get help

- **Bugs and feature requests:** open an issue at
  https://github.com/SandObserver/stackyard/issues
- **Questions and setup help:** start a discussion or open an issue with the
  `question` label.

Before opening a new issue, a quick search of existing issues often turns up an
answer or a report already in progress.

## Filing a useful bug report

A report is much faster to act on when it includes:

- **Version.** Open the Settings app, scroll to About; the installed version is
  shown there. If an update is available it is shown alongside.
- **How you deployed.** Docker run, Compose, Portainer, Kubernetes, or something
  else, and the image tag you are on.
- **What you expected and what happened.** Exact wording of any error shown in
  the UI or a widget helps.
- **Logs from around the time of the problem** (see below).
- **Browser and platform** for anything visual, plus a screenshot if you can.
- **Steps to reproduce**, ideally from a fresh state.

Please redact secrets (API keys, tokens, passwords, internal hostnames) before
pasting logs or config.

## Reading the logs

Both processes (Nginx and the API) log to the container's standard output, so
the container log is the single place to look:

```
docker logs <container-name>
```

With Compose:

```
docker compose logs -f
```

In Portainer, open the container and use the **Logs** view.

The API logs in a structured `key=value` format. Errors are logged with an
`error=` field; a failed upstream request (for example a widget that cannot
reach its service) is logged there.

## Common problems

### I can't log in, or I get bounced back to the login screen

The session cookie sets the `Secure` flag only on HTTPS connections. If you put
Stackyard behind a TLS-terminating reverse proxy but do not tell the app about
it, the browser is sent a cookie it then refuses to store, and login appears to
fail silently.

- Behind a reverse proxy that terminates TLS, set `TRUST_PROXY=true` and make
  the proxy send `X-Forwarded-Proto: https`.
- Only set `TRUST_PROXY=true` when a proxy you control is actually in front of
  the app. See [security.md](security.md) for why.

Logins are also rate-limited to 5 attempts per IP per 15 minutes. If you have
been guessing a password, wait for the window to reset.

### A widget shows "Blocked: ... is a private address"

The proxy blocks requests to private and loopback addresses by default as an
SSRF safeguard. Most homelab services live on private IPs, so most installs need
this relaxed:

- Set `ALLOW_PRIVATE_IPS=true` to allow widgets to reach private, loopback and
  link-local targets.

Docker service names (hostnames with no dot, such as `adguard`) are trusted and
are not blocked, so linking widgets to other containers on the same Docker
network works without this flag.

### A widget says "Not configured" or shows an error instead of data

- Re-open the widget in the Settings app and confirm the server URL and any
  credentials are filled in. Secret fields show as "set" without revealing the
  stored value; leaving them untouched keeps the saved secret.
- Confirm Stackyard can actually reach the service. From the host, the container
  must be able to open the URL you entered (right network, right port, no
  firewall in between).
- For HTTPS services with self-signed certificates, enable the per-widget or
  global TLS-skip option.

### A widget briefly shows "Unavailable" then recovers

Widgets keep the last good reading through a transient failure and only surface
an error after repeated failures. An occasional flash of "Unavailable" that
clears on its own usually means one upstream poll timed out; it is not a
persistent problem unless it stays.

### My dashboards disappeared after a restart

If the config file fails to parse on startup, Stackyard copies it to
`apps.json.corrupt` and starts with an empty config rather than overwriting the
broken file. Before making changes, check the data volume for
`apps.json.corrupt`; your previous config is preserved there.

### An icon I re-uploaded still shows the old image

Icons are served with revalidation, so a re-upload under the same name should
appear on the next load. If it does not, do a hard refresh to clear the cached
copy in your browser.

### I updated the image but the UI looks the same

UI changes ship inside the image. Pull the new image and recreate the container
(in Portainer, redeploy the stack) so the new files are served. A browser
refresh alone will not pull files that were changed in a newer image.

### Container health check is failing

The health check runs through Nginx to the API, so it covers both processes. If
it fails, check the logs for either process failing to start. A common cause is
the data volume not being writable by the container's `node` user; the API needs
to write `apps.json` and uploaded icons.

## Security issues

Please do not post suspected security vulnerabilities in public issues. Report
them privately to the maintainer instead. See [security.md](security.md) for
guidance on deploying Stackyard safely, including TLS, the SSRF guard, and how
secrets are stored.
