# hostinger-node-probe (`next-bare` branch)

The `next-bare` branch is a bare Next.js 16.3.6 replica used to check whether
Hostinger's Next.js preset (standalone `server.js` under LiteSpeed/lsnode)
serves a bare app or returns an empty 200 like `test.demetex.life`.

Minimal App Router app (no Tailwind, no ESLint): `/` page + `/api/health`
route, both `force-dynamic` with stdout logging.

## Expected results

- `GET /` → `200`, HTML containing `hello from next bare`.
- `GET /api/health` → `200`, JSON `{ok:true,app:'next-bare',...}` with
  header `X-Probe: next-bare`.
- Unknown path (e.g. `/zz-404`) → `404` (`next-bare 404` page).

Every render/request writes one line to stdout:

- Page: `[next-bare] page / <ISO time>`
- API: `[next-bare] GET /api/health <ISO time> host=<host header>`

## Run locally

Requires Node 24 + pnpm 11.13.1 (Hostinger `Next.js` preset):

```sh
pnpm install
pnpm dev
pnpm build
pnpm start
```

`next.config.ts` intentionally sets no `output` option; Hostinger injects
`output: standalone` itself. `@swc/helpers` is a direct dependency pinned to
0.5.23 (the exact version `next@16.3.6` requires) because Hostinger relocates
`next` outside pnpm's virtual store, which otherwise breaks with
`Cannot find module '@swc/helpers/_/_interop_require_default'`.
`nodeLinker: hoisted` lives in `pnpm-workspace.yaml` (pnpm 11 ignores
`node-linker` in `.npmrc`) so the standalone output gets a flat
`node_modules` including `@swc/helpers`.

## Interpreting hosted results

If the hosted site returns an empty `200` without the expected body/headers
and the Node log shows no `[next-bare]` lines, the request never reached the
Next standalone server (it was served/short-circuited by LiteSpeed / hCDN / a
static layer in front of the app).
