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

Both Nginx and the API log to the container's stdout:

```
docker logs <container-name>
```

With Compose:

```
docker compose logs -f
```

In Portainer, open the container and use the **Logs** view.

The API logs `key=value` pairs; errors carry an `error=` field.

## Common problems

### I can't log in, or I get bounced back to the login screen

The session cookie sets `Secure` only on HTTPS. Behind a TLS-terminating reverse
proxy, the browser is sent a cookie it refuses to store and login fails
silently. Set `TRUST_PROXY=true` and make the proxy send
`X-Forwarded-Proto: https`. Only set it when a proxy you control is actually in
front of the app; see [security.md](security.md).

Logins are rate-limited to 5 attempts per IP per 15 minutes.

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
