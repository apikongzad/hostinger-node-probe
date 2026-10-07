const http = require('http');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const crypto = require('crypto');
const url = require('url');
const os = require('os');
const net = require('net');

const raw = process.env.PORT || 3000;
const listenTarget = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;

const ALLOW_PREFIXES = ['/home/u400017829/domains/', '/opt/alt/', '/usr/local/lsws/'];
const RUN_DIR_PREFIX = '/home/u400017829/domains/';

function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isAuthorized(query) {
  const expected = process.env.DIAG_TOKEN;
  if (!expected) return false;
  const got = query && query.token;
  if (Array.isArray(got)) return false;
  if (typeof got !== 'string') return false;
  return tokensEqual(got, expected);
}

function firstParam(v) {
  if (Array.isArray(v)) return v[0];
  return v;
}

function isAllowedPath(literalPath) {
  if (typeof literalPath !== 'string' || literalPath.length === 0) return false;
  for (const p of ALLOW_PREFIXES) {
    if (literalPath.startsWith(p)) return true;
  }
  try {
    const rp = fs.realpathSync(literalPath);
    for (const p of ALLOW_PREFIXES) {
      if (rp.startsWith(p)) return true;
    }
  } catch (_) {
    // realpath failed (missing file); literal check already done
  }
  return false;
}

function isAllowedRunDir(literalPath) {
  if (typeof literalPath !== 'string' || literalPath.length === 0) return false;
  if (literalPath.startsWith(RUN_DIR_PREFIX)) return true;
  try {
    const rp = fs.realpathSync(literalPath);
    if (rp.startsWith(RUN_DIR_PREFIX)) return true;
  } catch (_) {
    // ignore
  }
  return false;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, { 'Content-Type': contentType || 'text/plain; charset=utf-8' });
  res.end(text);
}

function handleDiagLs(res, query) {
  const rawPath = firstParam(query.path);
  let depth = parseInt(firstParam(query.depth), 10);
  if (isNaN(depth)) depth = 1;
  depth = Math.min(3, Math.max(1, depth));

  if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }
  if (!isAllowedPath(rawPath)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }

  let rootStat;
  try {
    rootStat = fs.lstatSync(rawPath);
  } catch (e) {
    sendJson(res, 404, { ok: false, error: 'not found: ' + rawPath });
    return;
  }

  const entries = [];
  let truncated = false;
  const CAP = 2000;

  function pushEntry(full, name) {
    let st;
    try {
      st = fs.lstatSync(full);
    } catch (_) {
      return false;
    }
    let type = 'other';
    if (st.isSymbolicLink()) type = 'symlink';
    else if (st.isDirectory()) type = 'dir';
    else if (st.isFile()) type = 'file';
    const e = { path: full, name: name, type: type, size: st.size };
    if (type === 'symlink') {
      try {
        e.target = fs.readlinkSync(full);
      } catch (_) {
        e.target = null;
      }
    }
    entries.push(e);
    if (entries.length >= CAP) {
      truncated = true;
      return true;
    }
    return false;
  }

  function collect(dir, depthLeft) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (_) {
      return;
    }
    for (const name of names) {
      if (truncated) return;
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.lstatSync(full);
      } catch (_) {
        continue;
      }
      let type = 'other';
      if (st.isSymbolicLink()) type = 'symlink';
      else if (st.isDirectory()) type = 'dir';
      else if (st.isFile()) type = 'file';
      const e = { path: full, name: name, type: type, size: st.size };
      if (type === 'symlink') {
        try {
          e.target = fs.readlinkSync(full);
        } catch (_) {
          e.target = null;
        }
      }
      entries.push(e);
      if (entries.length >= CAP) {
        truncated = true;
        return;
      }
      // Recurse only into real directories (never follow symlinks).
      if (type === 'dir' && depthLeft > 1) {
        collect(full, depthLeft - 1);
      }
    }
  }

  if (rootStat.isSymbolicLink()) {
    const name = path.basename(rawPath);
    if (pushEntry(rawPath, name)) {
      // capped (single entry, cannot exceed cap)
    }
    sendJson(res, 200, { path: rawPath, depth: depth, count: entries.length, truncated: truncated, entries: entries });
    return;
  }
  if (rootStat.isFile()) {
    const name = path.basename(rawPath);
    entries.push({ path: rawPath, name: name, type: 'file', size: rootStat.size });
    sendJson(res, 200, { path: rawPath, depth: depth, count: entries.length, truncated: false, entries: entries });
    return;
  }
  if (!rootStat.isDirectory()) {
    sendJson(res, 400, { ok: false, error: 'not a directory: ' + rawPath });
    return;
  }

  collect(rawPath, depth);
  sendJson(res, 200, { path: rawPath, depth: depth, count: entries.length, truncated: truncated, entries: entries });
}

function handleDiagCat(res, query) {
  const rawPath = firstParam(query.path);
  let max = parseInt(firstParam(query.max), 10);
  if (isNaN(max)) max = 20000;
  max = Math.min(200000, Math.max(1, max));

  if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }
  if (!isAllowedPath(rawPath)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }

  const base = path.basename(rawPath);
  if (base.startsWith('.env') || base.toLowerCase().includes('secret') || base.endsWith('.pem') || base.endsWith('.key')) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }

  let st;
  try {
    st = fs.lstatSync(rawPath);
  } catch (e) {
    sendJson(res, 404, { ok: false, error: 'not found: ' + rawPath });
    return;
  }
  if (st.isDirectory()) {
    sendJson(res, 400, { ok: false, error: 'not a file' });
    return;
  }
  if (st.isSymbolicLink()) {
    // Resolve symlink target for the deny + allow checks, but still refuse secrets.
    let rp = null;
    try {
      rp = fs.realpathSync(rawPath);
    } catch (_) {
      // ignore
    }
    if (rp) {
      const rbase = path.basename(rp);
      if (rbase.startsWith('.env') || rbase.toLowerCase().includes('secret') || rbase.endsWith('.pem') || rbase.endsWith('.key')) {
        sendJson(res, 403, { ok: false, error: 'forbidden' });
        return;
      }
      if (!isAllowedPath(rp) && !isAllowedPath(rawPath)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' });
        return;
      }
    }
  }

  let fd;
  try {
    fd = fs.openSync(rawPath, 'r');
  } catch (e) {
    sendJson(res, 404, { ok: false, error: 'cannot open file' });
    return;
  }
  try {
    const buf = Buffer.alloc(max);
    const n = fs.readSync(fd, buf, 0, max, 0);
    const slice = buf.slice(0, n);
    sendText(res, 200, slice.toString('utf8'), 'text/plain; charset=utf-8');
  } catch (e) {
    sendJson(res, 500, { ok: false, error: 'read failed' });
  } finally {
    try {
      fs.closeSync(fd);
    } catch (_) {
      // ignore
    }
  }
}

function handleDiagInfo(res) {
  sendJson(res, 200, {
    version: process.version,
    execPath: process.execPath,
    cwd: process.cwd(),
    argv: process.argv,
    pid: process.pid,
    osUptime: os.uptime(),
    envNames: Object.keys(process.env).sort(),
    paths: module.paths,
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p = addr && typeof addr === 'object' ? addr.port : 0;
      s.close(() => resolve(p));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tryTcpConnect(port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch (_) {
        // ignore
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs || 1000);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
  });
}

function fetchOnce(port, targetPath, hostHeader) {
  return new Promise((resolve) => {
    const opts = {
      host: '127.0.0.1',
      port: port,
      path: targetPath,
      method: 'GET',
      headers: {
        Host: hostHeader,
        'X-Forwarded-For': '203.0.113.9',
        'X-Forwarded-Proto': 'https',
        Accept: 'text/html,*/*',
      },
      timeout: 20000,
    };
    const started = Date.now();
    void started;
    let req;
    try {
      req = http.get(opts, (resp) => {
        let total = 0;
        let snippet = '';
        resp.setEncoding('utf8');
        resp.on('data', (chunk) => {
          const s = typeof chunk === 'string' ? chunk : String(chunk);
          total += Buffer.byteLength(s);
          if (snippet.length < 1500) {
            snippet += s.slice(0, 1500 - snippet.length);
          }
        });
        resp.on('end', () => {
          resolve({
            path: targetPath,
            status: resp.statusCode,
            headers: resp.headers,
            bodyLength: total,
            bodySnippet: snippet.slice(0, 1500),
          });
        });
        resp.on('error', (e) => {
          resolve({ path: targetPath, error: String((e && e.message) || e) });
        });
      });
    } catch (e) {
      resolve({ path: targetPath, error: String((e && e.message) || e) });
      return;
    }
    req.setTimeout(20000, () => {
      req.destroy(new Error('request timeout'));
    });
    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
    req.on('error', (e) => {
      resolve({ path: targetPath, error: String((e && e.message) || e) });
    });
  });
}

async function handleDiagRun(res, query) {
  const rawDir = firstParam(query.dir);
  const urlPath = firstParam(query.path) || '/api/health';
  const hostHeader = firstParam(query.host) || 'test.demetex.life';
  const entry = firstParam(query.entry) || 'server.js';
  let waitMs = parseInt(firstParam(query.wait), 10);
  if (isNaN(waitMs)) waitMs = 8000;
  waitMs = Math.min(60000, Math.max(500, waitMs));

  if (typeof rawDir !== 'string' || !path.isAbsolute(rawDir)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }
  if (!isAllowedRunDir(rawDir)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }

  const entryStr = typeof entry === 'string' && entry.length > 0 ? entry : 'server.js';
  const resolvedEntry = path.isAbsolute(entryStr) ? path.normalize(entryStr) : path.join(rawDir, entryStr);
  if (!isAllowedPath(resolvedEntry)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }

  let dirStat;
  try {
    dirStat = fs.statSync(rawDir);
  } catch (e) {
    sendJson(res, 404, { ok: false, error: 'not found: ' + rawDir });
    return;
  }
  if (!dirStat.isDirectory()) {
    sendJson(res, 400, { ok: false, error: 'not a directory' });
    return;
  }

  let port;
  try {
    port = await getFreePort();
  } catch (e) {
    sendJson(res, 500, { ok: false, error: 'cannot allocate port' });
    return;
  }
  if (!port) {
    sendJson(res, 500, { ok: false, error: 'cannot allocate port' });
    return;
  }

  const childEnv = Object.assign({}, process.env);
  childEnv.PORT = String(port);
  childEnv.HOSTNAME = '127.0.0.1';
  delete childEnv.DIAG_TOKEN;

  let child;
  try {
    child = child_process.spawn(process.execPath, [entryStr], {
      cwd: rawDir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: 'spawn failed', port: port, childOutput: '', exitCode: null, signal: null });
    return;
  }

  let childOutput = '';
  let outputTruncated = false;
  const appendOutput = (chunk) => {
    if (outputTruncated) return;
    childOutput += chunk.toString();
    if (childOutput.length > 60000) {
      childOutput = childOutput.slice(0, 60000);
      outputTruncated = true;
    }
  };
  if (child.stdout) child.stdout.on('data', appendOutput);
  if (child.stderr) child.stderr.on('data', appendOutput);

  let exitCode = null;
  let signal = null;
  let exited = false;
  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code, sig) => {
      exitCode = code;
      signal = sig;
      exited = true;
      resolve();
    });
    child.on('error', () => {
      // 'exit' usually follows; resolve defensively after a tick if not exited
      setTimeout(() => {
        if (!exited) {
          exited = true;
          resolve();
        }
      }, 100);
    });
  });
  void exitPromise;

  const startTime = Date.now();
  let listening = false;

  while (Date.now() - startTime < waitMs) {
    if (exited) break;
    const ok = await tryTcpConnect(port, 800);
    if (ok) {
      listening = true;
      break;
    }
    if (exited) break;
    await sleep(120);
  }
  const startupMs = Date.now() - startTime;

  const cleanupAndRespond = async (requests) => {
    try {
      if (!exited) {
        try {
          child.kill('SIGTERM');
        } catch (_) {
          // ignore
        }
        const exitedInTime = await Promise.race([
          new Promise((r) => {
            child.once('exit', () => r(true));
          }),
          sleep(2000).then(() => false),
        ]);
        if (!exitedInTime && !exited) {
          try {
            child.kill('SIGKILL');
          } catch (_) {
            // ignore
          }
          await Promise.race([
            new Promise((r) => {
              child.once('exit', () => r(true));
            }),
            sleep(2000),
          ]);
        }
      }
    } catch (_) {
      // ignore cleanup errors
    }
    // Never include environment variable values in the output.
    sendJson(res, 200, {
      port: port,
      requests: requests,
      childOutput: childOutput,
      exitCode: exitCode,
      signal: signal,
      startupMs: startupMs,
    });
  };

  if (!listening) {
    await cleanupAndRespond([]);
    return;
  }

  const targets = [String(urlPath), '/', '/zz-diag-404'];
  const requests = [];
  for (const t of targets) {
    try {
      const r = await fetchOnce(port, t, String(hostHeader));
      requests.push(r);
    } catch (e) {
      requests.push({ path: t, error: String((e && e.message) || e) });
    }
    if (exited) break;
  }

  await cleanupAndRespond(requests);
}

async function handleDiagLsrun(res, query) {
  const rawDir = firstParam(query.dir);
  const rawPaths = firstParam(query.paths);
  const hostHeader = firstParam(query.host) || 'test.demetex.life';
  const rawEnvFile = firstParam(query.envFile);
  const rawUnset = firstParam(query.unset);
  const rawSet = firstParam(query.set);
  let waitMs = parseInt(firstParam(query.wait), 10);
  if (isNaN(waitMs)) waitMs = 20000;
  waitMs = Math.min(60000, Math.max(500, waitMs));
  const rawPreload = firstParam(query.preload);

  if (typeof rawDir !== 'string' || !path.isAbsolute(rawDir)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }
  if (!isAllowedRunDir(rawDir)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return;
  }

  let dirStat;
  try {
    dirStat = fs.statSync(rawDir);
  } catch (e) {
    sendJson(res, 404, { ok: false, error: 'not found: ' + rawDir });
    return;
  }
  if (!dirStat.isDirectory()) {
    sendJson(res, 400, { ok: false, error: 'not a directory' });
    return;
  }

  let targets;
  if (typeof rawPaths !== 'string' || rawPaths.length === 0) {
    targets = ['/api/health', '/', '/zz-diag-404'];
  } else {
    targets = rawPaths.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (targets.length === 0) targets = ['/api/health', '/', '/zz-diag-404'];
  }
  const hostStr = String(hostHeader);

  let envFile = null;
  if (typeof rawEnvFile === 'string' && rawEnvFile.length > 0) {
    envFile = rawEnvFile;
    if (!path.isAbsolute(envFile)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    if (!/^\/home\/u400017829\/domains\/[^/]+\/hbuilds\/config\/\.env$/.test(envFile)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    if (!isAllowedPath(envFile)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
  }

  let preload = null;
  if (typeof rawPreload === 'string' && rawPreload.length > 0) {
    preload = rawPreload;
    if (!path.isAbsolute(preload)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    if (!isAllowedPath(preload)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
  }

  let unsetList = [];
  if (typeof rawUnset === 'string' && rawUnset.length > 0) {
    unsetList = rawUnset.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }

  const setPairs = [];
  if (typeof rawSet === 'string' && rawSet.length > 0) {
    const parts = rawSet.split(',');
    for (const part of parts) {
      const t = part.trim();
      if (!t) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const name = t.slice(0, eq).trim();
      const value = t.slice(eq + 1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      setPairs.push({ name: name, value: value });
    }
  }

  let tmpDir = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsrun-'));
  } catch (_) {
    try {
      fs.mkdirSync('/home/u400017829/tmp', { recursive: true });
      tmpDir = fs.mkdtempSync(path.join('/home/u400017829/tmp', 'lsrun-'));
    } catch (e) {
      sendJson(res, 500, { ok: false, error: 'cannot create temp dir' });
      return;
    }
  }
  const socket = path.join(tmpDir, 'app.sock');
  const consoleLog = path.join(tmpDir, 'console.log');

  const childEnv = Object.assign({}, process.env);
  delete childEnv.DIAG_TOKEN;
  for (const k of Object.keys(childEnv)) {
    if (k.startsWith('LSNODE_') || k.startsWith('LSAPI_')) delete childEnv[k];
  }
  const secretValues = [];

  if (envFile) {
    let content;
    try {
      content = fs.readFileSync(envFile, 'utf8');
    } catch (e) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {
        // ignore
      }
      const code = e && e.code === 'ENOENT' ? 404 : 500;
      sendJson(res, code, { ok: false, error: code === 404 ? 'not found: ' + envFile : 'cannot read envFile' });
      return;
    }
    const lines = content.split('\n');
    for (let line of lines) {
      line = line.trim();
      if (!line || line[0] === '#') continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (val.length >= 2 && ((val[0] === '"' && val[val.length - 1] === '"') || (val[0] === "'" && val[val.length - 1] === "'"))) {
        val = val.slice(1, -1);
      }
      childEnv[key] = val;
      secretValues.push(val);
    }
  }

  for (const name of unsetList) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    delete childEnv[name];
  }
  for (const p of setPairs) {
    childEnv[p.name] = p.value;
    secretValues.push(p.value);
  }
  delete childEnv.DIAG_TOKEN;

  childEnv.LSNODE_ROOT = rawDir;
  childEnv.LSNODE_STARTUP_FILE = 'server.js';
  childEnv.LSNODE_BIND_SOCKET = '1';
  childEnv.LSNODE_SOCKET = socket;
  childEnv.LSNODE_CONSOLE_LOG = consoleLog;
  childEnv.NODE_ENV = 'production';
  if (preload) {
    childEnv.NODE_OPTIONS = '--require ' + preload;
  } else {
    delete childEnv.NODE_OPTIONS;
  }

  let child;
  try {
    child = child_process.spawn(process.execPath, ['/usr/local/lsws/fcgi-bin/lsnode.js'], {
      cwd: rawDir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      // ignore
    }
    sendJson(res, 500, { ok: false, error: 'spawn failed' });
    return;
  }

  let childOutput = '';
  let outputTruncated = false;
  const appendOutput = (chunk) => {
    if (outputTruncated) return;
    childOutput += chunk.toString();
    if (childOutput.length > 60000) {
      childOutput = childOutput.slice(0, 60000);
      outputTruncated = true;
    }
  };
  if (child.stdout) child.stdout.on('data', appendOutput);
  if (child.stderr) child.stderr.on('data', appendOutput);

  let exitCode = null;
  let signal = null;
  let exited = false;
  child.on('exit', (code, sig) => {
    exitCode = code;
    signal = sig;
    exited = true;
  });
  child.on('error', () => {
    // 'exit' usually follows; polling loop will observe `exited`
  });

  const trySocketConnect = () => {
    return new Promise((resolve) => {
      let sock;
      try {
        sock = net.createConnection({ path: socket });
      } catch (_) {
        resolve(false);
        return;
      }
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        try {
          sock.destroy();
        } catch (_) {
          // ignore
        }
        resolve(ok);
      };
      sock.setTimeout(1000);
      sock.on('connect', () => finish(true));
      sock.on('timeout', () => finish(false));
      sock.on('error', () => finish(false));
    });
  };

  const fetchViaSocket = (targetPath) => {
    return new Promise((resolve) => {
      const started = Date.now();
      let req;
      try {
        req = http.request(
          {
            socketPath: socket,
            path: targetPath,
            method: 'GET',
            headers: {
              Host: hostStr,
              'X-Forwarded-For': '203.0.113.9',
              'X-Forwarded-Proto': 'https',
              Accept: 'text/html,*/*',
            },
            timeout: 30000,
          },
          (resp) => {
            let total = 0;
            let snippet = '';
            resp.setEncoding('utf8');
            resp.on('data', (chunk) => {
              const s = typeof chunk === 'string' ? chunk : String(chunk);
              total += Buffer.byteLength(s);
              if (snippet.length < 1500) {
                snippet += s.slice(0, 1500 - snippet.length);
              }
            });
            resp.on('end', () => {
              resolve({
                path: targetPath,
                status: resp.statusCode,
                headers: resp.headers,
                bodyLength: total,
                bodySnippet: snippet.slice(0, 1500),
                elapsedMs: Date.now() - started,
              });
            });
            resp.on('error', (e) => {
              resolve({ path: targetPath, error: String((e && e.message) || e), elapsedMs: Date.now() - started });
            });
          }
        );
      } catch (e) {
        resolve({ path: targetPath, error: String((e && e.message) || e), elapsedMs: Date.now() - started });
        return;
      }
      req.setTimeout(30000, () => {
        req.destroy(new Error('request timeout'));
      });
      req.on('timeout', () => {
        req.destroy(new Error('request timeout'));
      });
      req.on('error', (e) => {
        resolve({ path: targetPath, error: String((e && e.message) || e), elapsedMs: Date.now() - started });
      });
      req.end();
    });
  };

  const startTime = Date.now();
  let ready = false;
  while (Date.now() - startTime < waitMs) {
    if (exited) break;
    const ok = await trySocketConnect();
    if (ok) {
      ready = true;
      break;
    }
    if (exited) break;
    await sleep(200);
  }
  const socketReadyMs = ready ? Date.now() - startTime : null;

  const requests = [];
  if (ready) {
    for (const t of targets) {
      try {
        const r = await fetchViaSocket(String(t));
        requests.push(r);
      } catch (e) {
        requests.push({ path: String(t), error: String((e && e.message) || e) });
      }
      if (exited) break;
    }
  }

  await sleep(1500);

  let logContent = '';
  try {
    const fd = fs.openSync(consoleLog, 'r');
    try {
      const buf = Buffer.alloc(60000);
      const n = fs.readSync(fd, buf, 0, 60000, 0);
      logContent = buf.slice(0, n).toString('utf8');
    } finally {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // ignore
      }
    }
  } catch (_) {
    logContent = '';
  }

  try {
    if (!exited) {
      try {
        child.kill('SIGTERM');
      } catch (_) {
        // ignore
      }
      const exitedInTime = await Promise.race([
        new Promise((r) => {
          child.once('exit', () => r(true));
        }),
        sleep(2000).then(() => false),
      ]);
      if (!exitedInTime && !exited) {
        try {
          child.kill('SIGKILL');
        } catch (_) {
          // ignore
        }
        await Promise.race([
          new Promise((r) => {
            child.once('exit', () => r(true));
          }),
          sleep(2000),
        ]);
      }
    }
  } catch (_) {
    // ignore cleanup errors
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {
    // ignore
  }

  const redact = (s) => {
    let out = s;
    const vals = secretValues.filter((v) => typeof v === 'string' && v.length >= 8).sort((a, b) => b.length - a.length);
    for (const v of vals) {
      if (!v) continue;
      out = out.split(v).join('<redacted>');
    }
    return out;
  };

  sendJson(res, 200, {
    socketReadyMs: socketReadyMs,
    requests: requests,
    consoleLog: redact(logContent),
    childOutput: redact(childOutput),
    exitCode: exitCode,
    signal: signal,
  });
}

const server = http.createServer((req, res) => {
  const now = new Date().toISOString();
  const host = req.headers.host || '-';
  const fwd = req.headers['x-forwarded-for'] || '-';
  console.log(`${now} ${req.method} ${req.url} ${host} ${fwd}`);
  res.setHeader('X-Probe', 'node');
  res.setHeader('Cache-Control', 'no-store');

  let parsed;
  try {
    parsed = url.parse(req.url || '/', true);
  } catch (_) {
    parsed = { pathname: (req.url || '/').split('?')[0], query: {} };
  }
  const pathname = parsed.pathname || '/';
  const query = parsed.query || {};

  if (pathname === '/diag' || pathname.startsWith('/diag/')) {
    if (!isAuthorized(query)) {
      sendText(res, 404, 'not found');
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    try {
      if (pathname === '/diag/ls') {
        handleDiagLs(res, query);
        return;
      }
      if (pathname === '/diag/cat') {
        handleDiagCat(res, query);
        return;
      }
      if (pathname === '/diag/run') {
        handleDiagRun(res, query).catch(() => {
          try {
            sendJson(res, 500, { ok: false, error: 'run failed' });
          } catch (_) {
            // ignore double-send
          }
        });
        return;
      }
      if (pathname === '/diag/lsrun') {
        handleDiagLsrun(res, query).catch(() => {
          try {
            sendJson(res, 500, { ok: false, error: 'run failed' });
          } catch (_) {
            // ignore double-send
          }
        });
        return;
      }
      if (pathname === '/diag/info') {
        handleDiagInfo(res);
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
      return;
    }
  }

  const pathOnly = pathname;
  if (pathOnly === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, pid: process.pid, uptime: process.uptime() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`hello from node probe ${now} ${req.method} ${req.url}\n`);
});

server.listen(listenTarget, () => {
  console.log(`probe listening on ${listenTarget} pid=${process.pid}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
