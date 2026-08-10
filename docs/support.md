# Support

## Where to get help

- Bugs and feature requests: https://github.com/SandObserver/stackyard/issues
- Questions and setup help: open an issue with the `question` label.

Search existing issues first.

## Filing a bug report

Include the version (Settings app, About), how you deployed and the image tag,
what you expected and what happened, logs from around the problem, and steps to
reproduce. For anything visual, add your browser and a screenshot.

Redact secrets before pasting logs or config.

## Reading the logs

The API logs to the container's stdout. Nginx logs request errors to stderr and
keeps no access log, so both reach the same place:

```
docker logs <container-name>
```

With Compose:

```
docker compose logs -f
```

In Portainer, open the container and use the **Logs** view.

### What a log line looks like

Every API record is one line:

```
<ISO-8601 UTC timestamp> <LVL> msg=<message> key=value
```

`LVL` is one of `DBG`, `INF`, `WRN`, `ERR` or `AUD`. `AUD` marks a
security-relevant event and is never filtered by the level setting.

A few things worth knowing when reading them:

- Warnings are emitted at both `warn` and `error`, so choosing Errors in
  Settings still shows them.
- The startup banner is not a record. It has no timestamp and no level, and it
  always prints.
- Secrets are never logged. Values that could carry one, such as the address of
  a service that failed a connection test, are reduced to the host.
- Lines from supervisord and Nginx have their own shapes and are not Stackyard
  records.

The format is logfmt, so anything shipping to Loki or Grafana parses it with
`| logfmt` and no custom rules.

To change how much is logged, see the `LOG_LEVEL` row in
[architecture.md](architecture.md#environment).

## Common problems

### I can't log in, or I get bounced back to the login screen

The session cookie sets `Secure` only on HTTPS. Behind a TLS-terminating reverse
proxy, the browser is sent a cookie it refuses to store and login fails
silently. Set `TRUST_PROXY=true` and make the proxy send
`X-Forwarded-Proto: https`. Only set it when a proxy you control is actually in
front of the app; see [security.md](security.md).

Logins are rate-limited to 5 attempts per IP per 15 minutes.

### One person's failed logins lock everyone out

Behind another reverse proxy, Stackyard's nginx sees that proxy as the client, so
every request through it shares one rate-limit bucket. Set `TRUSTED_PROXY` to
where the proxy is, for example `TRUSTED_PROXY=172.18.0.0/16`; see
[security.md](security.md).

### An upload or a save is rejected as too large

Stackyard limits request sizes so a single request cannot consume the memory of
a small machine:

| What | Limit | Why |
|---|---|---|
| Icon upload | 2 MB | every icon shipped with Stackyard is under 34 KB |
| Config save | 2 MB | a 300-app dashboard is about 155 KB |

nginx allows 3 MB, deliberately above both, so the API is always the component
that refuses an oversized request and can say what the limit is.

### A widget shows "Blocked: ... is a private address"

The proxy blocks private and loopback addresses by default as an SSRF safeguard.
Most homelab services live on private IPs, so set `ALLOW_PRIVATE_IPS=true`.

Docker service names (hostnames with no dot, such as `adguard`) are trusted and
are not blocked, so linking to containers on the same network works without it.

### A widget says "Not configured" or shows an error instead of data

- Confirm the server URL and credentials in the Settings app. Secret fields show
  as "set" without revealing the value; leaving them untouched keeps the secret.
- Confirm the container can reach the URL you entered (right network, right
  port, no firewall in between).
- For HTTPS services with self-signed certificates, enable the per-widget or
  global TLS-skip option.

### A widget briefly shows "Unavailable" then recovers

Widgets keep the last good reading through a transient failure and only surface
an error after repeated failures. A flash that clears on its own means one poll
timed out.

### My dashboards disappeared after a restart

If the config fails to parse on startup, Stackyard copies it to
`apps.json.corrupt` and starts empty rather than overwriting the broken file.
Your previous config is preserved there, in the data volume.

### An icon I re-uploaded still shows the old image

Icons are served with revalidation, so a re-upload should appear on the next
load. If it does not, hard refresh.

### I updated the image but the UI looks the same

UI files ship inside the image. Pull the new image and recreate the container
(in Portainer, redeploy the stack). A browser refresh alone will not do it.

### Container health check is failing

The health check runs through Nginx to the API, so it covers both processes.
Check the logs for either failing to start. A common cause is the data volume
not being writable by the container's `node` user.

## Security issues

Do not post suspected vulnerabilities in public issues. Report them privately to
the maintainer. See [security.md](security.md).
