const http = require('http');

const raw = process.env.PORT || 3000;
const listenTarget = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;

const server = http.createServer((req, res) => {
  const now = new Date().toISOString();
  const host = req.headers.host || '-';
  const fwd = req.headers['x-forwarded-for'] || '-';
  console.log(`${now} ${req.method} ${req.url} ${host} ${fwd}`);
  res.setHeader('X-Probe', 'node');
  res.setHeader('Cache-Control', 'no-store');
  const path = (req.url || '/').split('?')[0];
  if (path === '/health') {
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
