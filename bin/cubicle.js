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

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(require('../package.json').version);
  process.exit(0);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Cubicle — a live pixel-art office for your AI agents

Usage: cubicle [--port 3200] [--host 127.0.0.1] [--source paperclip] [--paperclip http://127.0.0.1:3100] [--token-file FILE]
       cubicle install-hooks [--uninstall]   add/remove the Claude Code hooks in ~/.claude/settings.json

Sources (--source / CUBICLE_SOURCE), one or several comma-separated, e.g. paperclip,claude-code:
  paperclip            Paperclip server, default (see --paperclip / PAPERCLIP_URL)
  claude-code          Claude Code sessions, via the hook in examples/claude-code/
  ./agents.json        Any JSON file in the Cubicle feed format (docs/FEED.md)
  http://host/feed     Any URL returning the Cubicle feed format

Environment variables:
  CUBICLE_PORT     Port to listen on (default 3200)
  CUBICLE_HOST     Interface to bind (default 127.0.0.1)
  CUBICLE_SOURCE   Source, as above (default paperclip)
  PAPERCLIP_URL    Paperclip server URL (default http://127.0.0.1:3100)
  PAPERCLIP_TOKEN  API key for an authenticated Paperclip, sent as "Authorization: Bearer …"
                   (or put it in a file and pass --token-file / PAPERCLIP_TOKEN_FILE).
                   There is deliberately no --token flag: flags show up in the process list.
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

// ---------- Paperclip credentials ----------
// Added by the proxy only; never sent to the browser, never taken from the browser.
function readToken() {
  const file = arg('token-file') || process.env.PAPERCLIP_TOKEN_FILE;
  if (file) {
    try { return fs.readFileSync(file, 'utf8').trim(); }
    catch (e) { console.error(`Cannot read token file ${file}: ${e.message}`); process.exit(1); }
  }
  return (process.env.PAPERCLIP_TOKEN || '').trim();
}
const TOKEN = readToken();
if (TOKEN && !/^[\x21-\x7e]+$/.test(TOKEN)) {
  console.error('The Paperclip API key contains spaces or control characters; check PAPERCLIP_TOKEN / the token file.');
  process.exit(1);
}

// ---------- sources ----------
// --source takes one source or several, comma-separated: "paperclip,claude-code" shows both
// in one office. At most one Paperclip; any number of feeds (served at /api/feed/<n>).
function parseSource(raw) {
  if (raw === 'paperclip') return { kind: 'paperclip' };
  if (raw === 'claude-code') return { kind: 'file', file: CLAUDE_CODE_FEED, label: 'Claude Code', emptyIfMissing: true };
  if (/^https?:\/\//.test(raw)) return { kind: 'url', url: new URL(raw), label: raw };
  return { kind: 'file', file: path.resolve(raw), label: path.basename(raw) };
}
const SOURCES = (arg('source') || process.env.CUBICLE_SOURCE || 'paperclip')
  .split(',').map((x) => x.trim()).filter(Boolean).map(parseSource);
if (SOURCES.filter((x) => x.kind === 'paperclip').length > 1) {
  console.error('Only one Paperclip source is supported.');
  process.exit(1);
}
const HAS_PAPERCLIP = SOURCES.some((x) => x.kind === 'paperclip');
const FEEDS = SOURCES.filter((x) => x.kind !== 'paperclip');

function get(url, cb, extraHeaders = {}) {
  const client = url.protocol === 'https:' ? https : http;
  const req = client.get(
    { protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { accept: 'application/json', ...extraHeaders }, timeout: 10000 },
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

function serveFeed(res, source) {
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
    let n = 0;
    const sources = SOURCES.map((x) => x.kind === 'paperclip'
      ? { kind: 'paperclip', paperclipUrl: PAPERCLIP.origin }
      : { kind: 'feed', label: x.label, path: `/api/feed/${n++}` });
    // `source`/`label`/`paperclipUrl` keep single-source pages from older versions working.
    const first = sources[0];
    return send(res, 200, JSON.stringify({ sources, source: first.kind, label: first.label, paperclipUrl: HAS_PAPERCLIP ? PAPERCLIP.origin : undefined, version: VERSION, build: build() }));
  }

  const feedMatch = url.pathname.match(/^\/api\/feed(?:\/(\d+))?$/);
  if (feedMatch) {
    const feed = FEEDS[Number(feedMatch[1] || 0)];
    if (!feed) return send(res, 404, '{"error":"no such feed source"}');
    return serveFeed(res, feed);
  }

  if (url.pathname.startsWith('/api/')) {
    if (!HAS_PAPERCLIP) return send(res, 403, '{"error":"not allowed"}');
    if (!ALLOWED.some((re) => re.test(url.pathname))) return send(res, 403, '{"error":"not allowed"}');
    const upstream = get(new URL(url.pathname, PAPERCLIP), (r) => {
      res.writeHead(r.statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      r.pipe(res);
    }, TOKEN ? { authorization: `Bearer ${TOKEN}` } : {});
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
  const reading = SOURCES.map((x) => x.kind === 'paperclip' ? PAPERCLIP.origin + (TOKEN ? ' (with an API key)' : '') : x.kind === 'file' ? x.file : x.url.href);
  console.log(`Cubicle is open at http://${HOST}:${PORT}  (reading ${reading.join(' + ')})`);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
  if (HAS_PAPERCLIP && TOKEN && !loopback) {
    console.warn(`Warning: bound to ${HOST} with a Paperclip API key. Anyone who can reach this port can read what that key can read.`);
  }
  if (HAS_PAPERCLIP) console.log(`No Paperclip yet? Try the demo: http://${HOST}:${PORT}/?demo`);
});
