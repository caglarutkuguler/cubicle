#!/usr/bin/env node
// Cubicle — a live pixel-art office for your AI agents.
// A tiny, dependency-free, read-only proxy + static page.
//
// Sources:
//   paperclip (default)  read agents/issues from a Paperclip server
//   claude-code          read the feed written by examples/claude-code/cubicle-hook.js
//   <file.json>          read a Cubicle feed from a JSON file (see docs/FEED.md)
//   <http(s)://url>      read a Cubicle feed from a URL (GET only)
//   replay:<file.jsonl>  play back a day recorded with --record
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

// `cubicle hook [codex|gemini]` — run from the CLI's hooks; see examples/claude-code/.
if (process.argv[2] === 'hook') {
  require('./cubicle-hook.js').main(process.argv[3]);
  return;
}
// `cubicle install-hooks [codex|gemini] [--uninstall]` — add/remove the hooks in the CLI's settings
// (~/.claude/settings.json, ~/.codex/hooks.json or ~/.gemini/settings.json).
if (process.argv[2] === 'install-hooks') {
  const runtime = ['codex', 'gemini', 'claude'].find((r) => process.argv.slice(3).includes(r)) || 'claude';
  try { require('./cubicle-hook.js').install({ runtime, uninstall: process.argv.includes('--uninstall') }); }
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
              [--record day.jsonl]  [--source replay:day.jsonl --speed 60]
       cubicle install-hooks [codex|gemini] [--uninstall]   add/remove the hooks for Claude Code (default),
                                             Codex CLI or Gemini CLI

Sources (--source / CUBICLE_SOURCE), one or several comma-separated, e.g. paperclip,claude-code:
  paperclip            Paperclip server, default (see --paperclip / PAPERCLIP_URL)
  claude-code          Claude Code sessions, via the hook in examples/claude-code/
  codex, gemini        Codex CLI / Gemini CLI sessions, via the same hook (install-hooks codex|gemini)
  ./agents.json        Any JSON file in the Cubicle feed format (docs/FEED.md)
  http://host/feed     Any URL returning the Cubicle feed format
  replay:day.jsonl     Play back a file written with --record (alone, not combined), --speed times
                       faster (default 60: an hour a minute), looping

Environment variables:
  CUBICLE_PORT     Port to listen on (default 3200)
  CUBICLE_HOST     Interface to bind (default 127.0.0.1)
  CUBICLE_SOURCE   Source, as above (default paperclip)
  PAPERCLIP_URL    Paperclip server URL (default http://127.0.0.1:3100)
  CUBICLE_REDACT   Set to 1 (or pass --redact) to strip task titles, commands and error text
                   on the server, e.g. for a kiosk on a shared screen
  PAPERCLIP_TOKEN  API key for an authenticated Paperclip, sent as "Authorization: Bearer …"
                   (or put it in a file and pass --token-file / PAPERCLIP_TOKEN_FILE).
                   There is deliberately no --token flag: flags show up in the process list.

Telegram (optional; docs: README "On Telegram"):
  (Easiest: ⚙ → Telegram on the page.) Or CUBICLE_TELEGRAM_TOKEN: the bot token from @BotFather
                           (or a file: --telegram-token-file / CUBICLE_TELEGRAM_TOKEN_FILE).
                           Cubicle prints a code at startup; send "/start <code>" to the bot to link your chat.
  --public-url URL         Address for links in messages, e.g. http://192.168.1.20:3200 (CUBICLE_PUBLIC_URL)
  --paperclip-public-url   Paperclip's address for links, when it differs from --paperclip
  --telegram-replies       Let a reply in Telegram be posted as a comment on the Paperclip issue
                           (the only thing Cubicle ever writes to Paperclip; off by default)
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
// Telegram (optional): the bot token, like the Paperclip key, only from the environment or a file.
function readTelegramToken() {
  const file = arg('telegram-token-file') || process.env.CUBICLE_TELEGRAM_TOKEN_FILE;
  if (file) {
    try { return fs.readFileSync(file, 'utf8').trim(); }
    catch (e) { console.error(`Cannot read Telegram token file ${file}: ${e.message}`); process.exit(1); }
  }
  return (process.env.CUBICLE_TELEGRAM_TOKEN || '').trim();
}
const TELEGRAM_TOKEN = readTelegramToken();
// --telegram-replies: the one opt-in exception to read-only. A reply in Telegram becomes a comment
// on the Paperclip issue, posted with the Paperclip key (or as the board in local_trusted mode).
const TELEGRAM_REPLIES = process.argv.includes('--telegram-replies') || /^(1|true|yes)$/i.test(process.env.CUBICLE_TELEGRAM_REPLIES || '');
const REDACT = process.argv.includes('--redact') || /^(1|true|yes)$/i.test(process.env.CUBICLE_REDACT || '');
if (TOKEN && !/^[\x21-\x7e]+$/.test(TOKEN)) {
  console.error('The Paperclip API key contains spaces or control characters; check PAPERCLIP_TOKEN / the token file.');
  process.exit(1);
}

// ---------- sources ----------
// --source takes one source or several, comma-separated: "paperclip,claude-code" shows both
// in one office. At most one Paperclip; any number of feeds (served at /api/feed/<n>).
function parseSource(raw) {
  if (raw === 'paperclip') return { kind: 'paperclip' };
  if (raw.startsWith('replay:')) return { kind: 'replay', file: path.resolve(raw.slice(7)) };
  if (raw === 'claude-code') return { kind: 'file', file: CLAUDE_CODE_FEED, label: 'Claude Code', emptyIfMissing: true };
  if (raw === 'codex') return { kind: 'file', file: path.join(os.homedir(), '.cubicle', 'codex.json'), label: 'Codex', emptyIfMissing: true };
  if (raw === 'gemini') return { kind: 'file', file: path.join(os.homedir(), '.cubicle', 'gemini.json'), label: 'Gemini CLI', emptyIfMissing: true };
  if (/^https?:\/\//.test(raw)) return { kind: 'url', url: new URL(raw), label: raw };
  return { kind: 'file', file: path.resolve(raw), label: path.basename(raw) };
}
const SOURCES = (arg('source') || process.env.CUBICLE_SOURCE || 'paperclip')
  .split(',').map((x) => x.trim()).filter(Boolean).map(parseSource);
if (SOURCES.filter((x) => x.kind === 'paperclip').length > 1) {
  console.error('Only one Paperclip source is supported.');
  process.exit(1);
}
const REPLAY = SOURCES.find((x) => x.kind === 'replay');
if (REPLAY && SOURCES.length > 1) {
  console.error('replay:<file> plays back a whole recorded office; use it on its own.');
  process.exit(1);
}
const HAS_PAPERCLIP = SOURCES.some((x) => x.kind === 'paperclip');
const FEEDS = SOURCES.filter((x) => x.kind !== 'paperclip' && x.kind !== 'replay');

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
  /^\/api\/companies\/[\w-]+\/(agents|issues|heartbeat-runs)$/,
];
// Heartbeat runs: only the latest few, so a failed run's error can be shown on the agent.
const RUNS_QUERY = '?limit=60&summary=1';

function send(res, status, body, type = 'application/json') {
  if (res.headersSent) return res.destroy();   // too late for a clean error: just drop the connection
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

// ---------- shaping ----------
// The page needs a handful of fields. Everything else Paperclip returns (descriptions,
// workspace settings, run ids, ...) never leaves the server, and with --redact neither do
// task titles, commands or error text: only ids, statuses and tool names.
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) r[k] = o[k]; return r; };
// "Bash: rm -rf build" -> "Bash", "Edit secrets.env" -> "Edit", "allow Bash: git push?" -> "allow Bash"
const toolOnly = (t) => { const x = String(t); return x.startsWith('allow ') ? x.split(':')[0] : x.split(/[:\s]/)[0]; };
const CLOSED = new Set(['done', 'cancelled']);

function shapePaperclip(pathname, data) {
  if (!Array.isArray(data)) return data;
  if (pathname === '/api/companies') return data.map((c) => pick(c, ['id', 'name', 'issuePrefix']));
  if (pathname.endsWith('/agents')) return data.map((a) => ({
    ...pick(a, ['id', 'name', 'urlKey', 'role', 'title', 'status', 'createdAt', 'budgetMonthlyCents', 'spentMonthlyCents']),
    errorReason: a.errorReason ? (REDACT ? 'error' : a.errorReason) : null,
  }));
  // Runs still going count too: a run that started after a failure means the failure is over.
  if (pathname.endsWith('/heartbeat-runs')) return data.filter((r) => r && r.agentId).map((r) => ({
    ...pick(r, ['id', 'agentId', 'status', 'errorCode', 'startedAt', 'createdAt', 'finishedAt']),
    ...(REDACT ? {} : pick({ error: r.error && String(r.error).slice(0, 500), stderrExcerpt: r.stderrExcerpt && String(r.stderrExcerpt).slice(-600) }, ['error', 'stderrExcerpt'])),
  }));
  if (pathname.endsWith('/issues')) return data.filter((i) => !CLOSED.has(i.status)).map((i) => ({
    ...pick(i, REDACT ? ['identifier', 'status', 'assigneeAgentId'] : ['identifier', 'title', 'status', 'assigneeAgentId']),
    reviewAttention: { paths: ((i.reviewAttention && i.reviewAttention.paths) || []).map((x) => pick(x, ['kind', 'responder', 'label'])) },
  }));
  return data;
}

// KPI board: every issue a person created and everything under it, finished ones from the last
// 90 days included, with just the fields progress and timing need.
const KPI_DAYS = 90;
function shapeKpi(data) {
  if (!Array.isArray(data)) return [];
  const since = Date.now() - KPI_DAYS * 86400000;
  return data.filter((i) => i && i.id && !(CLOSED.has(i.status) && Date.parse(i.completedAt || i.cancelledAt || i.updatedAt || 0) < since)).map((i) => ({
    ...pick(i, REDACT ? ['id', 'identifier', 'status', 'parentId', 'assigneeAgentId', 'createdAt', 'startedAt', 'completedAt', 'cancelledAt']
      : ['id', 'identifier', 'title', 'status', 'parentId', 'assigneeAgentId', 'createdAt', 'startedAt', 'completedAt', 'cancelledAt']),
    human: !!i.createdByUserId,
    convo: !!i.conversationAgentId,
    // what a blocked task is waiting for: how many open blockers, one of their ids, how many stalled
    blockers: i.blockerAttention && i.blockerAttention.unresolvedBlockerCount ? { n: i.blockerAttention.unresolvedBlockerCount,
      sample: i.blockerAttention.sampleBlockerIdentifier || '', stalled: i.blockerAttention.stalledBlockerCount || 0 } : null,
    asksYou: ((i.reviewAttention && i.reviewAttention.paths) || []).some((x) => /board|user|human/i.test(String(x && x.responder || ''))),
  }));
}

function shapeFeed(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data && data.agents) ? data.agents : [];
  const agents = list.map((a) => {
    const r = pick(a, ['id', 'name', 'role', 'title', 'status', 'since', 'createdAt']);
    if (a.task) {
      if (typeof a.task === 'string') r.task = REDACT ? toolOnly(a.task) : a.task;
      else r.task = REDACT ? pick(a.task, ['id', 'identifier']) : pick(a.task, ['id', 'identifier', 'title', 'url']);
    }
    if (a.taskUrl && !REDACT) r.taskUrl = a.taskUrl;
    if (a.error) r.error = REDACT ? 'error' : a.error;
    if (a.parent) r.parent = String(a.parent);
    // The last few steps: [startedAt ms, summary, duration ms?]. Redacted to the tool name.
    if (Array.isArray(a.recent)) {
      r.recent = a.recent.filter((x) => Array.isArray(x) && Number.isFinite(x[0])).slice(-10)
        .map(([t, text, d]) => [t, REDACT ? toolOnly(text) : String(text).slice(0, 100), ...(Number.isFinite(d) ? [d] : [])]);
    }
    return r;
  });
  return Array.isArray(data) ? agents : { ...pick(data, ['company']), agents };
}

// Fetch an upstream JSON document, reshape it, and answer in one piece. Buffering means an
// upstream that fails halfway can never leave a half-sent response behind.
const MAX_UPSTREAM_BYTES = 20 * 1024 * 1024;
function proxyJson(res, url, headers, failBody, shape) {
  const upstream = get(url, (r) => {
    const chunks = []; let size = 0;
    r.on('data', (c) => { size += c.length; if (size > MAX_UPSTREAM_BYTES) upstream.destroy(new Error('too large')); else chunks.push(c); });
    r.on('error', () => send(res, 502, failBody));
    r.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (r.statusCode !== 200) return send(res, r.statusCode, body);
      let data; try { data = JSON.parse(body); } catch (_) { return send(res, 502, '{"error":"upstream did not return JSON"}'); }
      send(res, 200, JSON.stringify(shape(data)));
    });
  }, headers);
  upstream.on('error', () => send(res, 502, failBody));
  res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
}

function serveFeed(res, source) {
  if (source.kind === 'file') {
    return fs.readFile(source.file, 'utf8', (err, txt) => {
      // No hook has fired yet: that is an empty office, not an error.
      if (err && err.code === 'ENOENT' && source.emptyIfMissing) return send(res, 200, JSON.stringify({ company: source.label, agents: [] }));
      if (err) return send(res, err.code === 'ENOENT' ? 404 : 500, JSON.stringify({ error: `cannot read ${source.file}` }));
      let data; try { data = JSON.parse(txt); } catch (_) { return send(res, 502, '{"error":"feed is not valid JSON"}'); }
      send(res, 200, JSON.stringify(shapeFeed(data)));
    });
  }
  proxyJson(res, source.url, {}, '{"error":"feed unreachable"}', shapeFeed);
}

// ---------- appearance (the office's own settings, not agent data) ----------
// Per-agent looks (hair, clothes, a photo head) and the company logo, saved in one small file
// so every screen showing this office sees them. The only thing Cubicle ever writes, and only
// from this machine: agent systems stay read-only.
const APPEARANCE_FILE = arg('appearance') || process.env.CUBICLE_APPEARANCE || path.join(os.homedir(), '.cubicle', 'appearance.json');
const MAX_APPEARANCE_BYTES = 4 * 1024 * 1024;
const isLoopback = (a) => /^(127\.|::1$|::ffff:127\.)/.test(String(a || ''));
// A request is from this machine only if it came in on loopback and not through a proxy on this
// machine (e.g. `tailscale serve`, which forwards a phone's request from 127.0.0.1).
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'tailscale-user-login', 'x-forwarded-host'];
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i;
const fromThisMachine = (req) => isLoopback(req.socket.remoteAddress) && !PROXY_HEADERS.some((h) => h in req.headers)
  && LOCAL_HOST.test(String(req.headers.host || 'localhost'));
function serveAppearance(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return fs.readFile(APPEARANCE_FILE, 'utf8', (err, txt) => {
      if (err) return send(res, 200, '{"agents":{},"names":{}}');
      send(res, 200, txt);
    });
  }
  if (req.method !== 'PUT') return send(res, 405, '{"error":"GET or PUT"}');
  // Only a browser on this machine may change it, and only this page: a cross-site page cannot
  // send a PUT with a JSON body without a CORS preflight, which this server never grants.
  if (!fromThisMachine(req)) return send(res, 403, '{"error":"appearance can only be changed from this machine"}');
  if (!/^application\/json/.test(req.headers['content-type'] || '') || req.headers['x-cubicle'] !== '1') return send(res, 400, '{"error":"bad request"}');
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, '{"error":"cross-origin"}');
  const chunks = []; let size = 0;
  req.on('data', (d) => { size += d.length; if (size <= MAX_APPEARANCE_BYTES) chunks.push(d); });
  req.on('end', () => {
    if (size > MAX_APPEARANCE_BYTES) return send(res, 413, '{"error":"too large"}');
    let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { return send(res, 400, '{"error":"not JSON"}'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, '{"error":"expected an object"}');
    const clean = { agents: {}, names: {} };
    for (const k of ['agents', 'names']) for (const [id, look] of Object.entries(data[k] || {})) if (look && typeof look === 'object') clean[k][String(id).slice(0, 300)] = look;
    if (typeof data.logo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data.logo)) clean.logo = data.logo;
    try {
      fs.mkdirSync(path.dirname(APPEARANCE_FILE), { recursive: true });
      const tmp = `${APPEARANCE_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(clean)); fs.renameSync(tmp, APPEARANCE_FILE);
    } catch (e) { return send(res, 500, JSON.stringify({ error: `cannot write ${APPEARANCE_FILE}` })); }
    send(res, 200, '{"ok":true}');
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/appearance') return serveAppearance(req, res);
  if (url.pathname === '/api/telegram') return serveTelegram(req, res);
  if (url.pathname === '/api/tailscale') return serveTailscale(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '{"error":"read-only"}');

  if (REPLAY && serveReplay(req, res, url)) return;

  if (url.pathname === '/config.json') {
    let n = 0;
    const sources = SOURCES.map((x) => x.kind === 'paperclip'
      ? { kind: 'paperclip', paperclipUrl: PAPERCLIP.origin }
      : { kind: 'feed', label: x.label, path: `/api/feed/${n++}` });
    // `source`/`label`/`paperclipUrl` keep single-source pages from older versions working.
    const first = sources[0];
    // Telegram status for the page's setup dialog; the pairing code only for a browser on this machine.
    const telegram = telegramStatus(req);
    // Paperclip on 127.0.0.1 opens only on this machine. A phone (through Tailscale) gets the address
    // given for it, or none: the page then leaves out the Paperclip links instead of opening blanks.
    const pcLinks = !HAS_PAPERCLIP ? undefined : (fromThisMachine(req) || !/^(127\.|localhost$|\[::1\]$)/.test(PAPERCLIP.hostname)) ? PAPERCLIP.origin : (PAPERCLIP_PHONE_URL() || '');
    return send(res, 200, JSON.stringify({ sources, source: first.kind, label: first.label, paperclipUrl: HAS_PAPERCLIP ? PAPERCLIP.origin : undefined,
      paperclipLinks: pcLinks, redact: REDACT, version: VERSION, build: build(), telegram }));
  }

  const feedMatch = url.pathname.match(/^\/api\/feed(?:\/(\d+))?$/);
  if (feedMatch) {
    const feed = FEEDS[Number(feedMatch[1] || 0)];
    if (!feed) return send(res, 404, '{"error":"no such feed source"}');
    return serveFeed(res, feed);
  }

  const kpiMatch = url.pathname.match(/^\/api\/kpi\/([\w-]+)$/);
  if (kpiMatch && HAS_PAPERCLIP) {
    return proxyJson(res, new URL(`/api/companies/${kpiMatch[1]}/issues`, PAPERCLIP), TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
      '{"error":"paperclip unreachable"}', shapeKpi);
  }

  if (url.pathname.startsWith('/api/')) {
    if (!HAS_PAPERCLIP) return send(res, 403, '{"error":"not allowed"}');
    if (!ALLOWED.some((re) => re.test(url.pathname))) return send(res, 403, '{"error":"not allowed"}');
    const upstreamUrl = new URL(url.pathname + (url.pathname.endsWith('/heartbeat-runs') ? RUNS_QUERY : ''), PAPERCLIP);
    return proxyJson(res, upstreamUrl, TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
      '{"error":"paperclip unreachable"}', (data) => shapePaperclip(url.pathname, data));
  }

  // Optional themes: public/themes/<name>.js, loaded by the page only when chosen, and the
  // list of them in public/themes/index.json.
  const themeMatch = url.pathname.match(/^\/themes\/([a-z0-9-]+\.js|index\.json)$/);
  if (themeMatch) {
    const file = path.join(PUBLIC_DIR, 'themes', themeMatch[1]);
    const type = file.endsWith('.json') ? 'application/json' : 'text/javascript; charset=utf-8';
    return fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(buf);
    });
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(PUBLIC_DIR, 'index.html')).pipe(res);
  }

  send(res, 404, 'Not found', 'text/plain');
});

// ---------- record and replay ----------
// --record day.jsonl asks this server for everything the page reads, every 4 s, and appends
// what changed: one line per document, { t, path, body }, after a first line describing the
// sources. replay:day.jsonl serves those documents back on a sped-up clock, so the page
// cannot tell a replay from a live office.
function configFor(sources) {
  let n = 0;
  return sources.map((x) => x.kind === 'paperclip' ? { kind: 'paperclip', paperclipUrl: PAPERCLIP.origin } : { kind: 'feed', label: x.label, path: `/api/feed/${n++}` });
}

// GET one of this server's own endpoints (the recorder and the Telegram bot read the office this way,
// already shaped and redacted like the page sees it).
const self = (p) => new Promise((resolve) => {
  http.get({ host: ['0.0.0.0', '::'].includes(HOST) ? '127.0.0.1' : HOST, port: PORT, path: p, timeout: 10000 }, (r) => {
    let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(r.statusCode === 200 ? b : null)); r.on('error', () => resolve(null));
  }).on('error', () => resolve(null));
});

function startRecording(file) {
  const last = new Map();
  fs.appendFileSync(file, JSON.stringify({ t: Date.now(), type: 'config', sources: configFor(SOURCES), redact: REDACT, version: VERSION }) + '\n');
  const keep = (p, body) => {
    if (body === null || last.get(p) === body) return;
    last.set(p, body);
    fs.appendFile(file, JSON.stringify({ t: Date.now(), path: p, body: JSON.parse(body) }) + '\n', () => {});
  };
  async function tick() {
    const paths = FEEDS.map((_, i) => `/api/feed/${i}`);
    if (HAS_PAPERCLIP) {
      const companies = await self('/api/companies');
      keep('/api/companies', companies);
      try { for (const c of JSON.parse(companies || '[]')) paths.push(`/api/companies/${c.id}/agents`, `/api/companies/${c.id}/issues`, `/api/companies/${c.id}/heartbeat-runs`, `/api/kpi/${c.id}`); } catch (_) {}
    }
    for (const p of paths) keep(p, await self(p));
  }
  setInterval(tick, 4000).unref();
  tick();
  console.log(`Recording to ${file}`);
}

let replay = null;   // { config, from, to, byPath: Map(path -> [{ t, body }]), started, speed }
function loadReplay(file) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
  catch (e) { console.error(`Cannot read the recording ${file}: ${e.message}`); process.exit(1); }
  const config = lines.find((l) => l.type === 'config');
  const docs = lines.filter((l) => l.path);
  if (!config || !docs.length) { console.error(`${file} is not a Cubicle recording (made with --record).`); process.exit(1); }
  const byPath = new Map();
  for (const d of docs) { if (!byPath.has(d.path)) byPath.set(d.path, []); byPath.get(d.path).push(d); }
  const speed = Math.max(1, Number(arg('speed') || process.env.CUBICLE_SPEED || 60));
  // After the last document the office stays as it was for 5 real seconds, then the day starts again.
  replay = { config, from: docs[0].t, to: docs[docs.length - 1].t, byPath, started: Date.now(), speed, hold: 5000 * speed };
}
function replayNow() {
  const span = replay.to - replay.from + replay.hold;              // hold the last state briefly, then loop
  return replay.from + ((Date.now() - replay.started) * replay.speed) % span;
}
function serveReplay(req, res, url) {
  const at = replayNow();
  if (url.pathname === '/config.json') {
    const sources = replay.config.sources || [];
    const first = sources[0] || { kind: 'feed' };
    send(res, 200, JSON.stringify({ sources, source: first.kind, label: first.label, paperclipUrl: first.paperclipUrl, redact: !!replay.config.redact,
      replay: { at, from: replay.from, to: replay.to, speed: replay.speed, hold: replay.hold }, version: VERSION, build: build() }));
    return true;
  }
  if (url.pathname.startsWith('/api/')) {
    const list = replay.byPath.get(url.pathname.replace(/^\/api\/feed$/, '/api/feed/0'));
    if (!list) { send(res, url.pathname === '/api/companies' ? 200 : 404, url.pathname === '/api/companies' ? '[]' : '{"error":"not in the recording"}'); return true; }
    let lo = 0, hi = list.length - 1, best = list[0];                       // last document at or before `at`
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].t <= at) { best = list[mid]; lo = mid + 1; } else hi = mid - 1; }
    send(res, 200, JSON.stringify(best.body));
    return true;
  }
  return false;
}

if (REPLAY) loadReplay(REPLAY.file);

server.listen(PORT, HOST, () => {
  if (REPLAY) {
    const mins = Math.round((replay.to - replay.from) / 60000);
    console.log(`Cubicle is open at http://${HOST}:${PORT}  (replaying ${REPLAY.file}: ${mins} min at ×${replay.speed}, looping)`);
    return;
  }
  if (arg('record')) startRecording(path.resolve(arg('record')));
  const reading = SOURCES.map((x) => x.kind === 'paperclip' ? PAPERCLIP.origin + (TOKEN ? ' (with an API key)' : '') : x.kind === 'file' ? x.file : x.url.href);
  console.log(`Cubicle is open at http://${HOST}:${PORT}  (reading ${reading.join(' + ')})${REDACT ? '  [redacted: ids and statuses only]' : ''}`);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
  if (HAS_PAPERCLIP && TOKEN && !loopback) {
    console.warn(`Warning: bound to ${HOST} with a Paperclip API key. Anyone who can reach this port can read what that key can read.`);
  }
  if (HAS_PAPERCLIP) console.log(`No Paperclip yet? Try the demo: http://${HOST}:${PORT}/?demo`);
  restartTelegram();
});

// The bot can also be set up from the page (⚙ → Telegram): the token and the replies switch are
// kept in ~/.cubicle/telegram-settings.json (chmod 600). A token from the environment wins.
let TELEGRAM = null;
const TG_SETTINGS = process.env.CUBICLE_TELEGRAM_SETTINGS || path.join(path.dirname(APPEARANCE_FILE), 'telegram-settings.json');
function tgSettings() { try { return JSON.parse(fs.readFileSync(TG_SETTINGS, 'utf8')) || {}; } catch (_) { return {}; } }
function tgToken() { return TELEGRAM_TOKEN || String(tgSettings().token || '').trim(); }
function tgReplies() { return HAS_PAPERCLIP && (TELEGRAM_REPLIES || !!tgSettings().replies); }
// The address links in messages use: --public-url, else the one saved from the page (⚙ → Telegram →
// "Open on your phone"), else this machine's own.
const PUBLIC_URL_FLAG = arg('public-url') || process.env.CUBICLE_PUBLIC_URL || '';
// Paperclip's address for other devices (links on the phone), when it differs from --paperclip.
const PAPERCLIP_PHONE_URL = () => arg('paperclip-public-url') || process.env.CUBICLE_PAPERCLIP_PUBLIC_URL || '';
function tgPublicUrl() {
  return PUBLIC_URL_FLAG || tgSettings().publicUrl || `http://${['0.0.0.0', '::'].includes(HOST) ? '127.0.0.1' : HOST}:${PORT}`;
}
function restartTelegram() {
  if (TELEGRAM) { TELEGRAM.stop(); TELEGRAM = null; }
  if (tgToken()) TELEGRAM = startTelegram(tgToken());
}
function telegramStatus(req) {
  const local = fromThisMachine(req);
  const seen = TELEGRAM ? TELEGRAM.seen() : {};
  return {
    on: !!TELEGRAM, username: TELEGRAM ? TELEGRAM.username : '', chats: TELEGRAM ? TELEGRAM.chats() : 0, replies: tgReplies(),
    canReply: HAS_PAPERCLIP, fromEnv: !!TELEGRAM_TOKEN, canEdit: local,
    polling: TELEGRAM ? TELEGRAM.polling() : '', heard: !!seen.any, unpaired: !!seen.unpaired,
    publicUrl: tgPublicUrl(), publicFixed: !!PUBLIC_URL_FLAG,
    ...(local && TELEGRAM ? { code: TELEGRAM.code } : {}),
  };
}
function serveTelegram(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, JSON.stringify(telegramStatus(req)));
  if (req.method !== 'PUT') return send(res, 405, '{"error":"GET or PUT"}');
  // Same rules as the appearance file: only a browser on this machine, only this page.
  if (!fromThisMachine(req)) return send(res, 403, '{"error":"only from this machine"}');
  if (!/^application\/json/.test(req.headers['content-type'] || '') || req.headers['x-cubicle'] !== '1') return send(res, 400, '{"error":"bad request"}');
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, '{"error":"cross-origin"}');
  let body = '';
  req.on('data', (d) => { if (body.length < 10000) body += d; });
  req.on('end', async () => {
    let data; try { data = JSON.parse(body); } catch (_) { return send(res, 400, '{"error":"not JSON"}'); }
    const next = { ...tgSettings() };
    if ('token' in data) {
      if (TELEGRAM_TOKEN) return send(res, 409, '{"error":"env"}');
      if (data.token) {
        const me = await require('./cubicle-telegram.js').getMe(String(data.token).trim());
        if (!me.ok) return send(res, 400, JSON.stringify({ error: me.error }));
        next.token = String(data.token).trim();
      } else delete next.token;
    }
    if ('replies' in data) next.replies = !!data.replies;
    if ('publicUrl' in data) {
      const u = String(data.publicUrl || '').trim();
      if (!u) delete next.publicUrl;
      else {
        let ok = false; try { ok = /^https?:$/.test(new URL(u).protocol); } catch (_) {}
        if (!ok) return send(res, 400, '{"error":"url"}');
        next.publicUrl = u.replace(/\/+$/, '');
      }
    }
    try {
      fs.mkdirSync(path.dirname(TG_SETTINGS), { recursive: true });
      fs.writeFileSync(TG_SETTINGS, JSON.stringify(next), { mode: 0o600 }); fs.chmodSync(TG_SETTINGS, 0o600);
    } catch (e) { return send(res, 500, JSON.stringify({ error: `cannot write ${TG_SETTINGS}` })); }
    if ('token' in data) restartTelegram(); else if (TELEGRAM) { TELEGRAM.setReplies(tgReplies()); TELEGRAM.setPublicUrl(tgPublicUrl()); }
    setTimeout(() => send(res, 200, JSON.stringify(telegramStatus(req))), 'token' in data && data.token ? 1200 : 0);   // let getMe fill in the name
  });
}

// Tailscale, for opening the office (and the links in Telegram messages) on a phone. Cubicle only
// looks: `tailscale status` and `tailscale serve status`. The one change, `tailscale serve` for this
// port, runs only when someone presses the button on this machine (same rules as the settings).
const TS_BINS = process.env.CUBICLE_TAILSCALE ? [process.env.CUBICLE_TAILSCALE]
  : ['tailscale', '/mnt/c/Program Files/Tailscale/tailscale.exe', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe'];
function tsRun(bin, args) {
  return new Promise((resolve) => require('child_process').execFile(bin, args, { timeout: 6000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    (err, out) => resolve(err && !out ? null : String(out || ''))));
}
async function tailscaleInfo() {
  for (const bin of TS_BINS) {
    const raw = await tsRun(bin, ['status', '--json']);
    if (raw == null) continue;
    let st = {}; try { st = JSON.parse(raw); } catch (_) { return { found: true, bin, running: false }; }
    const dns = String((st.Self && st.Self.DNSName) || '').replace(/\.$/, '');
    const running = st.BackendState === 'Running' && !!dns;
    let served = false;
    if (running) {
      let sv = {}; try { sv = JSON.parse((await tsRun(bin, ['serve', 'status', '--json'])) || '{}'); } catch (_) {}
      served = Object.entries(sv.Web || {}).some(([host, w]) => host.endsWith(`:${PORT}`)
        && Object.values((w && w.Handlers) || {}).some((h) => h && new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${PORT}/?$`).test(String(h.Proxy || ''))));
    }
    const devices = Object.values(st.Peer || {}).map((x) => x && x.OS).filter(Boolean);
    return { found: true, bin, running, dns, served, url: running ? `http://${dns}:${PORT}` : '', phones: devices.filter((o) => /ios|android/i.test(o)).length };
  }
  return { found: false };
}
function serveTailscale(req, res) {
  if (!fromThisMachine(req)) return send(res, 403, '{"error":"only from this machine"}');
  if (req.method === 'GET' || req.method === 'HEAD') {
    return tailscaleInfo().then((t) => { const { bin, ...pub } = t; send(res, 200, JSON.stringify({ ...pub, cmd: `tailscale serve --bg --http ${PORT} http://127.0.0.1:${PORT}` })); });
  }
  if (req.method !== 'PUT') return send(res, 405, '{"error":"GET or PUT"}');
  if (!/^application\/json/.test(req.headers['content-type'] || '') || req.headers['x-cubicle'] !== '1') return send(res, 400, '{"error":"bad request"}');
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, '{"error":"cross-origin"}');
  req.resume();
  req.on('end', async () => {
    const t = await tailscaleInfo();
    if (!t.found || !t.running) return send(res, 409, '{"error":"tailscale"}');
    if (!t.served) await tsRun(t.bin, ['serve', '--bg', '--http', String(PORT), `http://127.0.0.1:${PORT}`]);
    const after = await tailscaleInfo();
    if (!after.served) return send(res, 500, '{"error":"serve"}');
    // the links in Telegram messages use it from now on (unless --public-url says otherwise)
    if (!PUBLIC_URL_FLAG) {
      try { fs.mkdirSync(path.dirname(TG_SETTINGS), { recursive: true }); fs.writeFileSync(TG_SETTINGS, JSON.stringify({ ...tgSettings(), publicUrl: after.url }), { mode: 0o600 }); fs.chmodSync(TG_SETTINGS, 0o600); } catch (_) {}
      if (TELEGRAM) TELEGRAM.setPublicUrl(tgPublicUrl());
    }
    const { bin, ...pub } = after;
    send(res, 200, JSON.stringify(pub));
  });
}

function startTelegram(token) {
  const bot = require('./cubicle-telegram.js').start({
    token, self, publicUrl: tgPublicUrl(), replies: tgReplies(),
    paperclipPublicUrl: arg('paperclip-public-url') || process.env.CUBICLE_PAPERCLIP_PUBLIC_URL || (HAS_PAPERCLIP ? PAPERCLIP.origin : ''),
    stateFile: process.env.CUBICLE_TELEGRAM_STATE || path.join(os.homedir(), '.cubicle', 'telegram.json'),
    interval: Number(process.env.CUBICLE_TELEGRAM_INTERVAL || 10000),
    pollTimeout: process.env.CUBICLE_TELEGRAM_POLL ? Number(process.env.CUBICLE_TELEGRAM_POLL) : undefined,
    async postComment(identifier, body) {
      if (!/^[A-Za-z0-9]+-\d+$/.test(identifier)) return { ok: false, error: 'not an issue id' };
      const r = await new Promise((resolve) => {
        const data = Buffer.from(JSON.stringify({ body: String(body).slice(0, 8000), clientRequestId: require('crypto').randomUUID() }));
        const u = new URL(`/api/issues/${encodeURIComponent(identifier)}/comments`, PAPERCLIP);
        const req = (u.protocol === 'https:' ? https : http).request(u, { method: 'POST', timeout: 15000,
          headers: { 'content-type': 'application/json', 'content-length': data.length, ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) } }, (res) => {
          let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (e) => resolve({ status: 0, body: e.message }));
        req.end(data);
      });
      if (r.status >= 200 && r.status < 300) return { ok: true };
      let msg = r.body; try { msg = JSON.parse(r.body).error || msg; } catch (_) {}
      return { ok: false, status: r.status, error: String(msg).slice(0, 200) };
    },
  });
  if (tgReplies()) console.log('Telegram: replies are on: a reply to a "needs you" message is posted as a comment on that Paperclip issue.');
  return bot;
}
