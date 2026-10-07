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
