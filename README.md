# hostinger-node-probe

A minimal **zero-dependency** Node.js app used to prove whether Hostinger's
LiteSpeed/Passenger (`lsnode`) + hCDN layer forwards requests to a Node.js app
on a web hosting account.

## Expected responses

All responses return `200` with headers `X-Probe: node` and
`Cache-Control: no-store`.

- `GET /` → `200`, `Content-Type: text/plain; charset=utf-8`,
  body starting with `hello from node probe`, e.g.
  `hello from node probe <ISO time> GET /\n`
- `GET /health` → `200`, `Content-Type: application/json; charset=utf-8`,
  body `{"ok":true,"pid":<pid>,"uptime":<seconds>}`
- Any unknown path (e.g. `/zz-404`) and any method → same as `/`:
  `200`, `text/plain`, body starting with `hello from node probe`.

Every request writes exactly one line to stdout:
`<ISO timestamp> <method> <url> <host header> <x-forwarded-for header>`
(`-` when a header is missing).

## Run locally

No install needed (only Node.js >= 20, no dependencies):

```sh
node server.js
PORT=3999 node server.js
npm start
```

The server listens on `process.env.PORT || 3000`. A non-numeric `PORT`
(e.g. a unix socket path) is passed through unchanged to `server.listen`.

## Interpreting hosted results

If the hosted site returns an empty `200` **without** the `X-Probe: node`
header and the Node log shows no request lines, the request never reached
Node (it was served/short-circuited by LiteSpeed / hCDN / a static layer
in front of the app).

## diag branch (temporary debugging only — remove after use)

> The `diag` branch extends `server.js` (still CommonJS, built-in modules
> only, no dependencies) with token-protected diagnostics. **Remove these
> endpoints after debugging — they list files and probe apps.**

All `/diag/*` endpoints require `?token=<DIAG_TOKEN>` where `DIAG_TOKEN`
matches the `DIAG_TOKEN` env var via `crypto.timingSafeEqual`. If
`DIAG_TOKEN` is unset or the token mismatches, the server returns
`404 not found` (never reveals why). All diag responses send
`Cache-Control: no-store` and `X-Probe: node`.

- `GET /diag/ls?path=<abs>&depth=<1-3, default 1>&token=...` → JSON
  `{path, depth, count, truncated, entries:[{path, name, type, size, target?}]}`.
  `type` is `file`/`dir`/`symlink` (`target` via `readlink`).
  Only paths whose literal or `realpath` starts with
  `/home/u400017829/domains/`, `/opt/alt/`, or `/usr/local/lsws/`,
  else `403`. Capped at 2000 entries.
- `GET /diag/cat?path=<abs>&max=<bytes, default 20000, cap 200000>&token=...`
  → first `max` bytes as `text/plain`. Same allowlist. Refuses (`403`)
  basenames starting with `.env`, containing `secret`, or ending with
  `.pem`/`.key`.
- `GET /diag/run?dir=<abs>&path=</api/health>&host=<test.demetex.life>&entry=<server.js>&wait=<8000>&token=...`
  → spawns `process.execPath [entry]` with `cwd=dir` (`dir` must be under
  `/home/u400017829/domains/`), `PORT=<random free port>` (via `net`,
  port 0), `HOSTNAME=127.0.0.1`, `DIAG_TOKEN` removed. Polls the port up to
  `wait` ms, then `GET`s `<path>`, `/`, `/zz-diag-404` with
  `Host:<host>`, `X-Forwarded-For: 203.0.113.9`,
  `X-Forwarded-Proto: https`. Returns
  `{port, requests:[{path, status, headers, bodyLength, bodySnippet}],
  childOutput (cap 60000), exitCode, signal, startupMs}`. Never includes
  env values.
- `GET /diag/info?token=...` → JSON with `process.version`, `execPath`,
  `cwd()`, `argv`, `pid`, `os.uptime()`, env var **names only**, and
  `module.paths`.
