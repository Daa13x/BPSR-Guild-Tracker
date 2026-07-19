#!/usr/bin/env node
'use strict';
/**
 * Local development and smoke-test server. Never used in production.
 *
 * Serves the static frontend from the repository root and exposes the mocked
 * Apps Script runtime (the same one the backend tests exercise) as a real
 * POST /exec endpoint, so the full browser flow — cookies, gate, restore,
 * admin recovery, Master Seal — can be driven end to end without touching
 * the deployed spreadsheet. Open:
 *
 *   http://localhost:8788/Leaderboard.html?api=http%3A%2F%2Flocalhost%3A8788%2Fexec
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { runtime } = require('../tests/backend/runtime');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8788);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const backend = runtime();

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/exec') {
    if (request.method !== 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(backend.doGet({}).text);
      return;
    }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const output = backend.doPost({ postData: { contents: body } });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(output.text);
    });
    return;
  }
  const relative = decodeURIComponent(url.pathname === '/' ? '/Leaderboard.html' : url.pathname);
  const file = path.normalize(path.join(ROOT, relative));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  response.end(fs.readFileSync(file));
});

server.listen(PORT, () => {
  console.log(`BPSR dev server: http://localhost:${PORT}/Leaderboard.html?api=${encodeURIComponent(`http://localhost:${PORT}/exec`)}`);
  console.log('Mock backend state resets on restart. BPSR_ADMIN_SECRET is "secret".');
});
