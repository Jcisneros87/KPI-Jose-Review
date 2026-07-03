/**
 * Minimal zero-dependency static server for running the dashboard locally
 * when Python isn't available (used by the Start Dashboard launchers).
 * Usage: node tools/serve.mjs [port]
 *
 * Binds to 127.0.0.1 only and serves only app assets (no dotfiles, tests,
 * tooling, or node_modules) with resolved-path containment.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8137;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.md': 'text/markdown; charset=utf-8',
};

// Only what the app actually needs; everything else (tests/, tools/, .git,
// node_modules, package files) is never served.
const ALLOWED_DIRS = new Set(['src', 'config', 'vendor', 'examples', 'template', 'assets', 'docs']);
const ALLOWED_FILES = new Set(['index.html', 'README.md']);

function isAllowed(rel) {
  const segments = rel.split(sep);
  if (segments.some((s) => s.startsWith('.') || s === 'node_modules')) return false;
  return segments.length === 1 ? ALLOWED_FILES.has(rel) : ALLOWED_DIRS.has(segments[0]);
}

createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const filePath = resolve(root, '.' + (urlPath === '/' ? '/index.html' : urlPath));
  const rel = relative(root, filePath);
  if (rel === '' || rel.startsWith('..') || !isAllowed(rel)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, HOST, () => {
  console.log(`Altura BSA KPI running at http://localhost:${port}/  (Ctrl+C to stop)`);
});
