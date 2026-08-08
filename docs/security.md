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
  the app. If it is set while the app is reachable directly, a client can claim
  `X-Forwarded-Proto: https` and be issued a `Secure` cookie over plain HTTP.
  `TRUST_PROXY` affects nothing else: the client address is read separately, and
  `X-Forwarded-For` is not used anywhere.

## SSRF guard

The proxy blocks requests to the address ranges below and pins the
resolved IP to close DNS-rebind gaps. Dotless hostnames (such as Docker container names) are trusted and are not filtered. Only `http` and `https` URLs are fetched.

Two names are decided before that allowance: `localhost` is blocked, because it
is a loopback address rather than a service name, and the Docker host's own IP
(`settings.server.hostIp`, if you have set one) is trusted, because that is what
the host-IP port mapping exists to reach.

Two kinds of range are blocked, for the same reason: those that reach something
internal, and those that are not routable destinations at all.

| Range | Why |
|---|---|
| `0.0.0.0/8` | this network (RFC 1122) |
| `10.0.0.0/8` | private (RFC 1918) |
| `100.64.0.0/10` | carrier-grade NAT (RFC 6598) |
| `127.0.0.0/8` | loopback (RFC 1122) |
| `169.254.0.0/16` | link-local, includes cloud metadata (RFC 3927) |
| `172.16.0.0/12` | private (RFC 1918) |
| `192.0.0.0/24` | IETF protocol assignments (RFC 6890) |
| `192.168.0.0/16` | private (RFC 1918) |
| `198.18.0.0/15` | benchmarking (RFC 2544) |
| `224.0.0.0/4` | multicast (RFC 5771) |
| `240.0.0.0/4` | reserved, includes the `255.255.255.255` broadcast address (RFC 1112) |
| `::1`, `::` | IPv6 loopback and unspecified |
| `fc00::/7` | IPv6 unique local |
| `fe80::/10` | IPv6 link-local |
| `ff00::/8` | IPv6 multicast |

An IPv4 address wrapped in an IPv6 literal is decoded and checked against the
same table, covering the `::/96`, `::ffff:0:0/96` and `64:ff9b::/96` forms in
both hex and dotted spellings.

This guard limits what a compromised or malicious widget can access. It does not protect against an admin, who can already configure widgets to connect anywhere.

Setting `ALLOW_PRIVATE_IPS=true` disables this guard entirely, so private, loopback and link-local targets are no longer blocked. Most homelab installs need it on because the services they link to live on private IPs; it is opt-in for that reason.

## Authentication

- Passwords are hashed with scrypt and a per-password salt.
- Session tokens are HMAC-signed and verified with a constant-time comparison.
- Session tokens carry a signed issued-at and expire after a fixed lifetime
  (default 30 days). Override with `SESSION_MAX_AGE_DAYS`. Upgrading to this
  version invalidates any session issued before it, so existing users log in
  once more.
- Login is rate-limited to 5 attempts per IP per 15 minutes.
  Rate-limit counters are held in memory, so a restart clears them and they are
  not shared across replicas. Run a single instance behind any proxy.
- Changing the password rotates the session secret, which signs out every other
  browser and device.
- **Sign out all devices** in Admin → General → Security does the same without
  changing the password. Use it if a session may have been left open or
  compromised. It signs out the browser you are using too, then hands that
  browser a fresh session so you stay signed in where you clicked it.

Until a password is set, `/api/auth/set-password` accepts the first caller with
no authentication, so on a shared or untrusted network the first person to reach
a fresh install can claim the account. Set a password immediately after first
launch, or keep the install off untrusted networks until you have.

Authentication is only in force when a password is stored. Turning it on without
one is refused, and an install already in that state is treated as switched off,
because the alternative refuses every login while gating every other route,
which locks the install with no way back in over HTTP. This is not a bypass: a
session is verified against the password hash, so with none stored there is no
credential to present and no session to forge.

Rate limiting keys on the client IP, which the app reads from the `X-Real-IP`
header nginx sets. The header is believed only when the request arrived over
loopback, which in the shipped container means it came from Stackyard's own
nginx; nginx overwrites the header on every request, so a client cannot supply
its own. A request from anywhere else is identified by its socket address, so
running the API on its own, without the container's nginx in front, is safe by
default rather than trusting whatever a caller sends.

If you put Stackyard behind another reverse proxy (Nginx Proxy Manager, Caddy,
Traefik), set `TRUSTED_PROXY` to where that proxy is:

```
TRUSTED_PROXY=172.18.0.0/16
TRUSTED_PROXY="172.18.0.0/16 10.0.0.5"    # several, space or comma separated
```

Without it, Stackyard's own nginx sees the front proxy as the client, so every
request through it counts as the same client and rate limiting becomes one
shared bucket. With it, nginx resolves the real client from the forwarding
headers your proxy already sends, so no extra configuration is needed on the
proxy side.

`TRUSTED_PROXY` and `TRUST_PROXY` are separate: the first is about which client
an address belongs to, the second about whether to believe a request that claims
it arrived over HTTPS.

## Secrets

Stored secrets (API keys, passwords) are stripped from config before it is sent
to the browser. A populated field is reported as set without returning its
value. Secrets are preserved on save when the browser submits the config
without them. A value stored as a secret is never sent back, in the config
response or in an export.

Two consequences of that guarantee:

- Unticking **Secret** on a header or credential row clears the stored value on
  the next save, and the credential has to be retyped. Refilling the row would
  move the stored value into a row that is sent to the browser in full.
- A widget whose manifest is not loaded has its whole stored config withheld,
  since without the manifest the server cannot tell which of its fields are
  secret. The stored config is put back on save, so nothing is lost, but the
  widget's settings cannot be edited until its manifest loads again.

### Password hashing

Passwords are hashed with scrypt and stored in the modular PHC string format, so
each hash records the parameters it was made with:

```
$scrypt$ln=14,r=8,p=5$<salt>$<key>
```

The default is the 16 MiB row from OWASP's scrypt table: `N=2^14`, `r=8`, `p=5`.
Memory is the constraint that matters on small hardware, so the row chosen keeps
the same 16 MiB footprint as earlier versions while raising the work factor.

`PASSWORD_HASH_MEMORY` selects a different row if your hardware can afford more:
`8mib`, `16mib` (default), `32mib`, `64mib` or `128mib`. Only whole rows, so the
parameters cannot be set to an unbalanced combination. Changing it is safe at any
time: every hash records what produced it, so existing passwords keep working, and
one made with a lower work factor is rewritten the next time it is used to log in.

Secrets are stored in `apps.json` in plain text on the data volume. Protect the data volume with appropriate filesystem permissions and backups.

## Container

The provided Compose file drops all capabilities, adds back only what is
needed, sets `no-new-privileges`, and bounds memory, process count and log size.

Inside the container, supervisord runs as root so it can bind port 80 and spawn
the two processes. It drops the API to the unprivileged `node` user, and nginx
drops its workers to the `nginx` user. The API, which is the part that parses
untrusted input, never runs as root.

## Verifying a release image

Every released image is signed with [cosign](https://docs.sigstore.dev/) using
keyless signing: the signature is bound to the GitHub Actions workflow that
built it and recorded in Sigstore's public transparency log. There is no key for
this project to hold, or to lose.

Check an image before running it:

```
cosign verify ghcr.io/sandobserver/stackyard:1.5.0 \
  --certificate-identity-regexp '^https://github.com/SandObserver/stackyard/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Both flags matter. Without them cosign accepts a signature from any identity,
which proves only that something signed the image.

Each release build also scans the image with Trivy and fails on a HIGH or
CRITICAL finding that has a fix available, and produces an SPDX SBOM listing
what is inside it. The SBOM is attached to the build as an artifact, downloadable
from the run's summary page on GitHub.

Images are published to `ghcr.io/sandobserver/stackyard`. A Docker Hub mirror is
published alongside it when the project has credentials configured; ghcr.io is
the one to prefer, and the one the signature above covers.

## Config file

A config file that fails to parse, or that parses but has the wrong shape (for
example `items` is missing or is not a list), is copied to a timestamped
`apps.json.corrupt-<timestamp>` file and the app starts with an empty config
rather than overwriting the broken file. Each distinct breakage keeps its own
backup, so an earlier one is never overwritten. If your dashboards disappear
after startup, check for an `apps.json.corrupt-*` file before making changes.
