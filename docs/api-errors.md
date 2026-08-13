# API error shape

Every JSON error the API returns carries a human-readable `error` string, a
machine-readable `kind`, and sometimes a small `detail` object.

```json
{
  "error": "connect ECONNREFUSED 172.17.0.2:8181",
  "kind": "network",
  "detail": { "code": "ECONNREFUSED" }
}
```

`error` is for a person to read. `kind` is for code to branch on. Never decide
what a failure means by looking for words inside `error`.

The backend side lives in `api/src/api-error.js`, the frontend side in
`ui/js/admin-error.js`, and `api/test/api-error.test.js` asserts the two agree.

## What the message says

The `error` string is composed from the `kind`, never taken from the underlying
error. An operating system message names what failed, `connect ECONNREFUSED
172.17.0.2:8181` or `ENOENT ... open '/data/apps.json'`, and that is an internal
address, hostname or server path being rendered in a browser.

Composing fails closed: nothing from the original is present unless it was put
there deliberately. Filtering the message instead would fail open, since anything
the filter did not recognise would pass through.

The full message is logged on every failure, which is where an operator should
look for it.

A route may pass an explicit `error` when the text is one the code chose and can
vouch for, such as `Set a password before turning authentication on.` Such a
message must not name a host, an address or a path.

A widget's `data.js` vouches for a message the same way, by throwing
`ctx.fail(message)` rather than a plain `Error`. The same restriction applies,
and a status code is the only thing that may be interpolated into one. See
[widgets.md](./widgets.md#reporting-a-failure).

## Kinds

`kind` is a closed set. Adding one is a deliberate contract change and needs a
matching entry in both modules.

| Kind | Meaning | Typical status |
|---|---|---|
| `network` | The target could not be reached at all: connection refused, DNS failure, TLS handshake failure. | 502 |
| `timeout` | Dialling or reading ran past the deadline. | 502 |
| `blocked` | Stackyard's own outbound guard or rate limiter refused the request. Not the target's decision. | 403, 429 |
| `auth` | The **caller's** Stackyard session or password. Never the upstream's credentials. | 401, 429 |
| `upstream` | We reached the target and it answered with an error status. `detail.status` carries it. | 502 |
| `invalid` | The request, its body, or its parameters were malformed or referred to something that does not exist. | 400, 404, 409 |
| `internal` | Anything not classified above. | 500 |

Two of these are easy to confuse:

- `auth` is about *us*. An expired admin session is `auth`.
- `upstream` with `detail.status` of 401 or 403 is about *the service the user is
  pointing at*. That is the one where offering to add an API key makes sense.

Reading them the other way round tells someone to add an upstream API key when
their own login has timed out.

## Handling an unknown kind

A consumer that does not recognise a `kind`, or receives a response with no
`kind` at all, must treat it as `internal` and fall back to displaying `error`.
This is what lets an older frontend run against a newer API, and the reverse.
Both `classify()` and `readError()` do this. Do not add a `throw` to either.

## The `detail` object

`detail` is optional and deliberately constrained, so it does not become a place
where arbitrary strings accumulate.

1. **Declared keys only.** Anything not in the table below does not go in.
2. **Server-derived values only.** A status code we read, an errno Node handed
   us, a URL we constructed ourselves. Never an upstream response body, an
   upstream header, or a filesystem path.
3. **Omit it entirely** rather than sending `{}`.

| Kind | Key | Type | Meaning |
|---|---|---|---|
| `network` | `code` | string | Node errno or TLS code, e.g. `ECONNREFUSED`, `CERT_HAS_EXPIRED` |
| `timeout` | `code` | string | Node errno, when there was one |
| `upstream` | `status` | number | The HTTP status the target replied with |
| `invalid` | `code` | string | `ERR_INVALID_URL`, where applicable |
| `blocked` | `reason` | string | `private-address`, when `ALLOW_PRIVATE_IPS=true` would allow the request |

`auth` and `internal` carry no `detail`.

A `blocked` message never names the address it blocked, so it carries no wording
to match on. The UI keys its advice off `detail.reason`.

## Adding a kind

1. Add it to `KIND` in `api/src/api-error.js`.
2. Add it to `KIND` in `ui/js/admin-error.js`.
3. Add a row to the table above, and a `detail` row if it carries one.
4. `api/test/api-error.test.js` fails until steps 1 and 2 match.
