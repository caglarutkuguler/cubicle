#!/usr/bin/env node
// Cubicle — a live pixel-art office for your Paperclip agents.
// A tiny, dependency-free, read-only proxy + static page.
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Cubicle — a live pixel-art office for your Paperclip agents

Usage: cubicle [--port 3200] [--host 127.0.0.1] [--paperclip http://127.0.0.1:3100]

Environment variables:
  CUBICLE_PORT     Port to listen on (default 3200)
  CUBICLE_HOST     Interface to bind (default 127.0.0.1)
  PAPERCLIP_URL    Paperclip server URL (default http://127.0.0.1:3100)
`);
  process.exit(0);
}

const PORT = Number(arg('port') || process.env.CUBICLE_PORT || 3200);
const HOST = arg('host') || process.env.CUBICLE_HOST || '127.0.0.1';
const PAPERCLIP = new URL(arg('paperclip') || process.env.PAPERCLIP_URL || 'http://127.0.0.1:3100');
const client = PAPERCLIP.protocol === 'https:' ? https : http;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Only these read-only Paperclip endpoints are ever forwarded.
const ALLOWED = [
  /^\/api\/health$/,
  /^\/api\/companies$/,
  /^\/api\/companies\/[\w-]+\/(agents|issues)$/,
];

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '{"error":"read-only"}');

  if (url.pathname === '/config.json') {
    return send(res, 200, JSON.stringify({ paperclipUrl: PAPERCLIP.origin }));
  }

  if (url.pathname.startsWith('/api/')) {
    if (!ALLOWED.some((re) => re.test(url.pathname))) return send(res, 403, '{"error":"not allowed"}');
    const upstream = client.get(
      {
        protocol: PAPERCLIP.protocol,
        hostname: PAPERCLIP.hostname,
        port: PAPERCLIP.port,
        path: url.pathname,
        headers: { accept: 'application/json' },
        timeout: 10000,
      },
      (r) => {
        res.writeHead(r.statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        r.pipe(res);
      }
    );
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => send(res, 502, '{"error":"paperclip unreachable"}'));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(PUBLIC_DIR, 'index.html')).pipe(res);
  }

  send(res, 404, 'Not found', 'text/plain');
});

server.listen(PORT, HOST, () => {
  console.log(`Cubicle is open at http://${HOST}:${PORT}  (reading ${PAPERCLIP.origin})`);
  console.log(`No Paperclip yet? Try the demo: http://${HOST}:${PORT}/?demo`);
});
