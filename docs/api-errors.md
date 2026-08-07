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

`error` is for a person to read. `kind` is for code to branch on. Nothing should
ever decide what a failure means by looking for words inside `error`; that is
what this contract exists to replace.

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

A widget's `data.js` vouches for a message the same way, from further off, by
throwing `ctx.fail(message)` rather than a plain `Error`. That is how
`API key not configured` and `TrueNAS auth failed, check API key` survive: they
tell someone what to change, where `Something went wrong.` does not. The same
restriction applies, and a status code is the only thing that should ever be
interpolated into one. See [widgets.md](./widgets.md#reporting-a-failure).

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

Reading them the other way round is exactly the bug this contract fixed: the
admin UI used to match the string `Unauthori`, which is the text of our own
session-expiry message, and so told users to add an upstream API key when their
own login had simply timed out.

## Handling an unknown kind

A consumer that does not recognise a `kind`, or receives a response with no
`kind` at all, must treat it as `internal` and fall back to displaying `error`.
This is what lets an older frontend run against a newer API, and a newer frontend
run against an API container that has not been redeployed yet. Both
`classify()` and `readError()` do this; do not add a `throw` to either.

## The `detail` object

`detail` is optional and deliberately constrained, so it does not become a place
where arbitrary strings accumulate.

1. **Declared keys only.** Anything not in the table below does not go in.
2. **Server-derived values only.** A status code we read, an errno Node handed
   us, a URL we constructed ourselves. Never an upstream response body, an
   upstream header, or a filesystem path. This is the rule that keeps `detail`
   safe once error-message sanitisation makes `error` generic.
3. **Omit it entirely** rather than sending `{}`.

| Kind | Key | Type | Meaning |
|---|---|---|---|
| `network` | `code` | string | Node errno or TLS code, e.g. `ECONNREFUSED`, `CERT_HAS_EXPIRED` |
| `timeout` | `code` | string | Node errno, when there was one |
| `upstream` | `status` | number | The HTTP status the target replied with |
| `invalid` | `code` | string | `ERR_INVALID_URL`, where applicable |

`blocked`, `auth` and `internal` carry no `detail`. For `blocked` the reason is
already a sentence we wrote ourselves, so `error` is safe to show verbatim.

## Adding a kind

1. Add it to `KIND` in `api/src/api-error.js`.
2. Add it to `KIND` in `ui/js/admin-error.js`.
3. Add a row to the table above, and a `detail` row if it carries one.
4. `api/test/api-error.test.js` fails until steps 1 and 2 match.
