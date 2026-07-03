/**
 * tools/serve.mjs security validation (codex review fixes): loopback-only
 * binding, resolved-path containment, asset allowlist, malformed-URL
 * handling. Spawns the real server and probes it over HTTP.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8199;

let server;

test.before(async () => {
  server = spawn('node', [join(root, 'tools/serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await once(server.stdout, 'data'); // "running at ..." banner
});

test.after(() => server?.kill());

const get = (path) => fetch(`http://127.0.0.1:${PORT}${path}`);

test('serves the app assets', async () => {
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/index.html')).status, 200);
  assert.equal((await get('/src/app/main.js')).status, 200);
  assert.equal((await get('/config/goals.json')).status, 200);
  assert.equal((await get('/vendor/echarts.min.js')).status, 200);
  assert.equal((await get('/template/ctr-executive-master.pptx')).status, 200);
  const res = await get('/examples/ctr-sample.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
});

test('blocks path traversal, including encoded separators (codex fix)', async () => {
  for (const path of ['/../secret.txt', '/..%2F..%2Fetc/passwd', '/..%2faltura-bsa-kpi2/x', '/vendor/..%2F..%2Fpackage.json', '/%2e%2e/%2e%2e/etc/hosts']) {
    const res = await get(path);
    assert.notEqual(res.status, 200, `${path} must not be served (got ${res.status})`);
  }
});

test('serves only allowlisted app paths — no dev/meta files (codex fix)', async () => {
  for (const path of ['/package.json', '/package-lock.json', '/tests/engine.test.mjs', '/tools/serve.mjs', '/.gitignore', '/node_modules/jszip/package.json', '/Start%20Dashboard.bat']) {
    assert.equal((await get(path)).status, 403, `${path} must be forbidden`);
  }
});

test('malformed URLs get 400, not 404 (codex fix)', async () => {
  const res = await get('/%zz');
  assert.equal(res.status, 400);
});

test('binds to loopback only (codex fix)', async () => {
  // The server must reject/refuse non-loopback interfaces. Attempt to reach
  // it via this machine's LAN address; connection should fail.
  const { networkInterfaces } = await import('node:os');
  const lan = Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);
  if (!lan) return; // no external interface on this machine — nothing to probe
  await assert.rejects(
    () => fetch(`http://${lan.address}:${PORT}/`, { signal: AbortSignal.timeout(2000) }),
    'server must not be reachable on the LAN interface'
  );
});
