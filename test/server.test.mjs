import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 18377;
const base = `http://127.0.0.1:${port}`;
let child;
before(async () => {
  child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), APP_MODE: 'demo' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Server failed to start'); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Server timeout')), 5000); timer.unref(); })]);
});
after(async () => { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } });
test('homepage makes demo-only status explicit', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /DEMO ONLY/);
  assert.match(html, /not other phones/);
  assert.doesNotMatch(html, /style=/);
  assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('healthcheck reports demo mode', async () => { assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: 'ok', mode: 'demo' }); });
test('only intended public assets are available', async () => {
  for (const path of ['/styles.css', '/app.js', '/robots.txt']) assert.equal((await fetch(`${base}${path}`)).status, 200);
  for (const path of ['/server.mjs', '/package.json', '/.env', '/.git/config', '/docs/production-plan.md', '/%2e%2e/server.mjs', '/app.js/extra']) assert.equal((await fetch(`${base}${path}`)).status, 404, path);
});
test('write requests are rejected', async () => { assert.equal((await fetch(base, { method: 'POST', body: 'sample' })).status, 405); });
test('HEAD returns headers without body', async () => { const response = await fetch(base, { method: 'HEAD' }); assert.equal(response.status, 200); assert.equal(await response.text(), ''); });
test('private deployment mode fails closed', async () => {
  const invalid = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '18378', APP_MODE: 'production' }, stdio: 'ignore' });
  const [code] = await once(invalid, 'exit');
  assert.notEqual(code, 0);
});
