#!/usr/bin/env node
// Cubicle — a live pixel-art office for your AI agents.
// A tiny, dependency-free, read-only proxy + static page.
//
// Sources:
//   paperclip (default)  read agents/issues from a Paperclip server
//   claude-code          read the feed written by examples/claude-code/cubicle-hook.js
//   <file.json>          read a Cubicle feed from a JSON file (see docs/FEED.md)
//   <http(s)://url>      read a Cubicle feed from a URL (GET only)
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

// `cubicle hook` — used from Claude Code hooks; see examples/claude-code/.
if (process.argv[2] === 'hook') {
  require('./cubicle-hook.js').main();
  return;
}
// `cubicle install-hooks [--uninstall]` — add/remove the Claude Code hooks in ~/.claude/settings.json.
if (process.argv[2] === 'install-hooks') {
  try { require('./cubicle-hook.js').install({ uninstall: process.argv.includes('--uninstall') }); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
  return;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Cubicle — a live pixel-art office for your AI agents

Usage: cubicle [--port 3200] [--host 127.0.0.1] [--source paperclip] [--paperclip http://127.0.0.1:3100]
       cubicle install-hooks [--uninstall]   add/remove the Claude Code hooks in ~/.claude/settings.json

Sources (--source / CUBICLE_SOURCE):
  paperclip            Paperclip server, default (see --paperclip / PAPERCLIP_URL)
  claude-code          Claude Code sessions, via the hook in examples/claude-code/
  ./agents.json        Any JSON file in the Cubicle feed format (docs/FEED.md)
  http://host/feed     Any URL returning the Cubicle feed format

Environment variables:
  CUBICLE_PORT     Port to listen on (default 3200)
  CUBICLE_HOST     Interface to bind (default 127.0.0.1)
  CUBICLE_SOURCE   Source, as above (default paperclip)
  PAPERCLIP_URL    Paperclip server URL (default http://127.0.0.1:3100)
`);
  process.exit(0);
}

const PORT = Number(arg('port') || process.env.CUBICLE_PORT || 3200);
const HOST = arg('host') || process.env.CUBICLE_HOST || '127.0.0.1';
const PAPERCLIP = new URL(arg('paperclip') || process.env.PAPERCLIP_URL || 'http://127.0.0.1:3100');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const STARTED = Date.now();
// Changes when the server restarts or index.html changes on disk; open pages
// compare it and reload themselves, so a wall display picks up updates.
function build() {
  let mtime = 0;
  try { mtime = fs.statSync(path.join(PUBLIC_DIR, 'index.html')).mtimeMs; } catch (_) {}
  return `${VERSION}-${STARTED}-${Math.round(mtime)}`;
}
const CLAUDE_CODE_FEED = path.join(os.homedir(), '.cubicle', 'claude-code.json');

// ---------- source ----------
const rawSource = arg('source') || process.env.CUBICLE_SOURCE || 'paperclip';
let source; // { kind: 'paperclip' } | { kind: 'file', file, label } | { kind: 'url', url, label }
if (rawSource === 'paperclip') source = { kind: 'paperclip' };
else if (rawSource === 'claude-code') source = { kind: 'file', file: CLAUDE_CODE_FEED, label: 'Claude Code', emptyIfMissing: true };
else if (/^https?:\/\//.test(rawSource)) source = { kind: 'url', url: new URL(rawSource), label: rawSource };
else source = { kind: 'file', file: path.resolve(rawSource), label: path.basename(rawSource) };

function get(url, cb) {
  const client = url.protocol === 'https:' ? https : http;
  const req = client.get(
    { protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { accept: 'application/json' }, timeout: 10000 },
    cb
  );
  req.on('timeout', () => req.destroy(new Error('timeout')));
  return req;
}

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

function serveFeed(res) {
  if (source.kind === 'file') {
    return fs.readFile(source.file, 'utf8', (err, txt) => {
      // No hook has fired yet: that is an empty office, not an error.
      if (err && err.code === 'ENOENT' && source.emptyIfMissing) return send(res, 200, JSON.stringify({ company: source.label, agents: [] }));
      if (err) return send(res, err.code === 'ENOENT' ? 404 : 500, JSON.stringify({ error: `cannot read ${source.file}` }));
      try { JSON.parse(txt); } catch (_) { return send(res, 502, '{"error":"feed is not valid JSON"}'); }
      send(res, 200, txt);
    });
  }
  const upstream = get(source.url, (r) => {
    res.writeHead(r.statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    r.pipe(res);
  });
  upstream.on('error', () => send(res, 502, '{"error":"feed unreachable"}'));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '{"error":"read-only"}');

  if (url.pathname === '/config.json') {
    const cfg = source.kind === 'paperclip'
      ? { source: 'paperclip', paperclipUrl: PAPERCLIP.origin, version: VERSION, build: build() }
      : { source: 'feed', label: source.label, version: VERSION, build: build() };
    return send(res, 200, JSON.stringify(cfg));
  }

  if (url.pathname === '/api/feed') {
    if (source.kind === 'paperclip') return send(res, 404, '{"error":"no feed source configured"}');
    return serveFeed(res);
  }

  if (url.pathname.startsWith('/api/')) {
    if (source.kind !== 'paperclip') return send(res, 403, '{"error":"not allowed"}');
    if (!ALLOWED.some((re) => re.test(url.pathname))) return send(res, 403, '{"error":"not allowed"}');
    const upstream = get(new URL(url.pathname, PAPERCLIP), (r) => {
      res.writeHead(r.statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      r.pipe(res);
    });
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
  const reading = source.kind === 'paperclip' ? PAPERCLIP.origin : source.kind === 'file' ? source.file : source.url.href;
  console.log(`Cubicle is open at http://${HOST}:${PORT}  (reading ${reading})`);
  if (source.kind === 'paperclip') console.log(`No Paperclip yet? Try the demo: http://${HOST}:${PORT}/?demo`);
});
