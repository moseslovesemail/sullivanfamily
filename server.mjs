import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This executable is deliberately DEMO ONLY. It has no database or write API.
if (process.env.APP_MODE && process.env.APP_MODE !== 'demo') {
  throw new Error('This build supports APP_MODE=demo only. No production access control exists.');
}
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');

// Exact asset allowlist: never serve project files, dotfiles or directory listings.
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);
const headers = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"
};
const server = http.createServer(async (req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    res.writeHead(status, { ...headers, 'content-type': type, ...extra });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed', undefined, { allow: 'GET, HEAD' });
  try {
    // Do not trust Host or normalise a traversal request into a permitted route.
    const path = (req.url || '/').split('?')[0];
    if (path === '/healthz') return send(200, JSON.stringify({ status: 'ok', mode: 'demo' }), 'application/json');
    if (path === '/robots.txt') return send(200, 'User-agent: *\nDisallow: /\n');
    const asset = assets.get(path);
    if (!asset) return send(404, 'Not found');
    const body = await readFile(fileURLToPath(new URL(`./public/${asset[0]}`, import.meta.url)));
    return send(200, body, asset[1]);
  } catch {
    return send(500, 'Unable to serve demo');
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(port, '0.0.0.0', () => console.log(`Family Support demo listening on ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
