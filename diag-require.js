'use strict';
// diag-require.js (temporary diagnostic only — remove after use).
// Run with: node /abs/path/diag-require.js while process.cwd() is the root of ANOTHER Next.js standalone app.
// Zero dependencies, CommonJS only. Never prints env var VALUES except
// NODE_PRESERVE_SYMLINKS and NODE_OPTIONS in the first line.
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

async function main() {
  const cwd = process.cwd();

  console.log(JSON.stringify({
    node: process.version,
    execArgv: process.execArgv,
    cwd: cwd,
    preserveSymlinks: process.env.NODE_PRESERVE_SYMLINKS || null,
    nodeOptions: process.env.NODE_OPTIONS || null,
  }));

  const middlewareFile = path.join(cwd, '.next/server/middleware.js');
  const req = createRequire(middlewareFile);

  const specs = [
    'next/package.json',
    'next/dist/server/runtime-reacts.external.js',
    'next/dist/server/lib/router-utils/instrumentation-globals.external',
    'next/dist/server/lib/incremental-cache/tags-manifest.external.js',
    'next/dist/server/lib/incremental-cache/shared-cache-controls.external.js',
    'next/dist/server/lib/incremental-cache/memory-cache.external.js',
    'next/dist/server/app-render/work-unit-async-storage.external.js',
    'next/dist/server/app-render/work-async-storage.external.js',
    'next/dist/server/app-render/after-task-async-storage.external.js',
    'next/dist/server/app-render/action-async-storage.external.js',
    'next/dist/compiled/next-server/app-page.runtime.prod.js',
    'next/dist/build/adapter/setup-node-env.external',
    './webpack-runtime.js',
  ];

  for (const spec of specs) {
    try {
      const resolved = req.resolve(spec);
      let realpath = null;
      try {
        realpath = fs.realpathSync(resolved);
      } catch (_) {
        realpath = null;
      }
      console.log(JSON.stringify({ spec: spec, resolved: resolved, realpath: realpath }));
    } catch (e) {
      console.log(JSON.stringify({
        spec: spec,
        error: {
          code: (e && e.code) || null,
          message: String((e && e.message) || e).slice(0, 800),
          requireStack: (e && e.requireStack) || null,
        },
      }));
    }
  }

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }

  try {
    let mod = require(middlewareFile);
    if (mod && typeof mod.then === 'function') {
      mod = await mod;
    }
    console.log(JSON.stringify({ middleware: 'ok', keys: Object.keys(mod) }));
  } catch (e) {
    console.log(JSON.stringify({
      middleware: 'error',
      code: (e && e.code) || null,
      message: String((e && e.message) || e).slice(0, 2000),
      requireStack: (e && e.requireStack) || null,
      stack: String((e && e.stack) || '').slice(0, 3000),
    }));
  }

  setTimeout(() => process.exit(0), 2000);
}

main().catch((e) => {
  try {
    console.log(JSON.stringify({
      middleware: 'error',
      code: (e && e.code) || null,
      message: String((e && e.message) || e).slice(0, 2000),
      requireStack: (e && e.requireStack) || null,
      stack: String((e && e.stack) || '').slice(0, 3000),
    }));
  } catch (_) {
    // ignore stringify errors
  }
  setTimeout(() => process.exit(0), 2000);
});
