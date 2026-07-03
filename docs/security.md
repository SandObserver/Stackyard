# Security

## Network exposure

Stackyard does not terminate TLS and serves traffic over plain HTTP only. While login attempts are rate-limited, the application is **not** designed or hardened for direct exposure to the public internet. Authentication exists primarily to simplify management of multiple local dashboards and should not be relied on as an internet-facing security boundary.

Deploy Stackyard only on a trusted network, or behind a reverse proxy that terminates TLS and provides its own authentication and access controls. Do **not** expose it directly to the internet or make it accessible via port forwarding.


## HTTPS and the session cookie

The session cookie sets the `Secure` flag only when the request is HTTPS. It is
treated as HTTPS when the connection is TLS, or when `TRUST_PROXY=true` and the
request carries `X-Forwarded-Proto: https`.

- Behind a TLS-terminating reverse proxy, set `TRUST_PROXY=true` and make the
  proxy send `X-Forwarded-Proto`. Without this the cookie is sent without
  `Secure`.
- Only set `TRUST_PROXY=true` when a proxy you control is actually in front of
  the app. If it is set while the app is reachable directly, a client can spoof
  `X-Forwarded-Proto` and `X-Forwarded-For`.

## SSRF guard

The proxy blocks requests to private and loopback addresses and pins the
resolved IP to close DNS-rebind gaps. Dotless hostnames (such as Docker container names) are trusted and are not filtered.

This guard limits what a compromised or malicious widget can access. It does not protect against an admin, who can already configure widgets to connect anywhere.

## Authentication

- Passwords are hashed with scrypt and a per-password salt.
- Session tokens are HMAC-signed and verified with a constant-time comparison.
- Login is rate-limited to 5 attempts per IP per 15 minutes.
- Changing the password rotates the session secret.

Rate limiting keys on the client IP. Behind a proxy this is only meaningful if
the proxy passes a real client IP and `TRUST_PROXY` is configured; otherwise all
requests share one IP.

## Secrets

Stored secrets (API keys, passwords) are stripped from config before it is sent
to the browser. A populated field is reported as set without returning its
value. Secrets are preserved on save when the browser submits the config
without them.

Secrets are stored in `apps.json` in plain text on the data volume. Protect the data volume with appropriate filesystem permissions and backups.

## Container

The provided Compose file drops all capabilities, adds back only what is
needed, sets `no-new-privileges`, and runs the API as a non-root user.

## Config file

A config file that fails to parse is copied to `apps.json.corrupt` and the app
starts with an empty config rather than overwriting the broken file. If your dashboards disappear after startup, check for `apps.json.corrupt` before making changes.
