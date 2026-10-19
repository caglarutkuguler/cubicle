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

Updates:
  Cubicle asks npm now and then whether a newer version is out and says so on the page and in
  Telegram, with the command to update. --no-update-check (CUBICLE_UPDATE_CHECK=0) turns that off.
  --auto-update            Install new versions by itself: Cubicle runs under a small supervisor that
                           starts the new version (through npx, or git pull for a clone) and the open
                           pages reload. Off by default.
`);
  process.exit(0);
}

// --auto-update: this process only supervises; the office runs in a child it restarts on updates.
if (process.argv.includes('--auto-update') && process.env.CUBICLE_WORKER !== '1') {
  require('./cubicle-update.js').supervise(process.argv.slice(2));
  return;
}

const PORT = Number(arg('port') || process.env.CUBICLE_PORT || 3200);
const HOST = arg('host') || process.env.CUBICLE_HOST || '127.0.0.1';
const PAPERCLIP = new URL(arg('paperclip') || process.env.PAPERCLIP_URL || 'http://127.0.0.1:3100');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const STARTED = Date.now();
// A newer version on npm, once one is seen: { latest, kind, command, auto }.
const UPDATES = require('./cubicle-update.js');
const UPDATE_CHECK = !process.argv.includes('--no-update-check') && !/^(0|false|no|off)$/i.test(process.env.CUBICLE_UPDATE_CHECK || '');
const AUTO_UPDATE = process.env.CUBICLE_WORKER === '1';
let UPDATE = null;
// Changes when the server restarts or index.html changes on disk; open pages
// compare it and reload themselves, so a wall display picks up updates.
// Open pages reload when this changes, so it changes only when what they run changes: the page
// itself, its script, its themes. A restart (an update of the server alone, a service restart)
// leaves it as it was and the office goes on undisturbed.
let buildCache = { key: '', id: '' };
function build() {
  const files = ['index.html', 'index.js', 'themes/index.json'].map((f) => path.join(PUBLIC_DIR, f));
  let key = '';
  for (const f of files) { try { const st = fs.statSync(f); key += `${st.mtimeMs}:${st.size};`; } catch (_) { key += '-;'; } }
  if (key !== buildCache.key) {
    const h = require('crypto').createHash('sha1');
    for (const f of files) { try { h.update(fs.readFileSync(f)); } catch (_) {} }
    buildCache = { key, id: `${VERSION}-${h.digest('hex').slice(0, 12)}` };
  }
  return buildCache.id;
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
  // A file that is not there yet (a hook that has not fired, a tool not used on this machine yet)
  // is an empty office until it appears, not an error on the page.
  return { kind: 'file', file: path.resolve(raw), label: path.basename(raw), emptyIfMissing: true };
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
  /^\/api\/issues\/[A-Za-z0-9-]+\/interactions$/,      // what an agent is asking you (shown, never answered here)
  /^\/api\/issues\/[A-Za-z0-9-]+\/approvals$/,         // what an agent asks you to approve (shown, never decided here)
  /^\/api\/issues\/[A-Za-z0-9-]+\/cost-summary$/,      // runs, run time and cost under a task (KPI advice)
  /^\/api\/issues\/[A-Za-z0-9-]+\/comments$/,          // the last word on a finished advice task (its result)
];
// Heartbeat runs: only the latest few, so a failed run's error can be shown on the agent.
const RUNS_QUERY = '?limit=60&summary=1';
// The KPI's advice looks further back: the last thousand runs, each with the issue it worked on.
const KPI_RUNS_QUERY = '?limit=1000&summary=1';
// The office needs open issues only; asking Paperclip for those keeps a big company under its page size.
const ISSUES_QUERY = '?status=backlog,todo,in_progress,in_review,blocked&limit=1000';

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
// A review path that waits on a person: the board or a user, or an interaction (questions,
// confirmations) — Paperclip names the agent as the responder of those.
const asksPerson = (x) => !!x && (/board|user|human/i.test(String(x.responder || '')) || x.kind === 'interaction');

function shapePaperclip(pathname, data, light = false) {
  if (pathname.endsWith('/cost-summary')) return pick(data, ['issueCount', 'runCount', 'runtimeMs', 'costCents', 'inputTokens', 'outputTokens']);
  if (!Array.isArray(data)) return data;
  if (pathname === '/api/companies') return data.map((c) => pick(c, ['id', 'name', 'issuePrefix']));
  if (pathname.endsWith('/agents')) return data.map((a) => ({
    ...pick(a, ['id', 'name', 'urlKey', 'role', 'title', 'status', 'createdAt', 'budgetMonthlyCents', 'spentMonthlyCents']),
    errorReason: a.errorReason ? (REDACT ? 'error' : a.errorReason) : null,
  }));
  // Runs still going count too: a run that started after a failure means the failure is over.
  if (pathname.endsWith('/heartbeat-runs')) return data.filter((r) => r && r.agentId).map((r) => ({
    ...pick(r, ['id', 'agentId', 'status', 'errorCode', 'startedAt', 'createdAt', 'finishedAt']),
    ...(r.contextSnapshot && typeof r.contextSnapshot.issueId === 'string' ? { issueId: r.contextSnapshot.issueId } : {}),
    // the KPI's thousand runs need only the start of the error (to tell a quota from a too-large prompt)
    ...(REDACT ? {} : light ? pick({ error: r.error && String(r.error).slice(0, 120) }, ['error'])
      : pick({ error: r.error && String(r.error).slice(0, 500), stderrExcerpt: r.stderrExcerpt && String(r.stderrExcerpt).slice(-600) }, ['error', 'stderrExcerpt'])),
  }));
  // the newest few comments, short: what an advice task ended with
  if (pathname.endsWith('/comments')) return REDACT ? [] : data.filter((c) => c && !c.deletedAt).slice(0, 3).map((c) => ({
    ...pick(c, ['createdAt', 'authorType', 'authorAgentId']), body: String(c.body || '').slice(0, 700) }));
  if (pathname.endsWith('/issues')) return data.filter((i) => !CLOSED.has(i.status)).map((i) => ({
    ...pick(i, REDACT ? ['identifier', 'status', 'assigneeAgentId', 'startedAt', 'createdAt'] : ['identifier', 'title', 'status', 'assigneeAgentId', 'startedAt', 'createdAt']),
    reviewAttention: { paths: ((i.reviewAttention && i.reviewAttention.paths) || []).map((x) => pick(x, ['kind', 'responder', 'label', 'ref'])) },
  }));
  // Approvals still waiting for a decision: what is asked and its risks, to read on any screen.
  if (pathname.endsWith('/approvals')) return data.filter((x) => x && x.status === 'pending').map((x) => {
    const p = x.payload || {};
    return REDACT ? pick(x, ['id', 'type', 'status']) : {
      ...pick(x, ['id', 'type', 'status', 'createdAt']),
      title: String(p.title || '').slice(0, 300), summary: String(p.summary || '').slice(0, 4000),
      risks: (Array.isArray(p.risks) ? p.risks : []).slice(0, 10).map((r) => String(r).slice(0, 600)),
    };
  });
  // Open questions to a person: the questions and their options, to read on any screen.
  if (pathname.endsWith('/interactions')) return data.filter((x) => x && x.status === 'pending').map((x) => {
    const qs = (x.payload && Array.isArray(x.payload.questions)) ? x.payload.questions : [];
    return REDACT ? { id: x.id, kind: x.kind, status: x.status, count: qs.length } : {
      ...pick(x, ['id', 'kind', 'status', 'title', 'summary', 'createdAt']),
      // an agent asking for an app connection (e.g. Google Sheets): which service, to link its setup
      ...(x.kind === 'connection_intent' && x.payload && x.payload.serviceSlug ? { service: { slug: String(x.payload.serviceSlug).slice(0, 80), name: String(x.payload.serviceName || x.payload.serviceSlug).slice(0, 120) } } : {}),
      questions: qs.slice(0, 10).map((q) => ({
        ...pick(q, ['id', 'selectionMode', 'required', 'allowOther']), prompt: String(q.prompt || '').slice(0, 2000),
        options: (Array.isArray(q.options) ? q.options : []).slice(0, 12).map((o) => ({ id: o.id, label: String(o.label || '').slice(0, 200), description: o.description ? String(o.description).slice(0, 400) : undefined })),
      })),
    };
  });
  return data;
}

// Blocked work Paperclip says needs someone (its "blocked" inbox): why it stopped, since when, who
// can move it (the board, a user, an agent, nobody known) and the issue to look at.
const BLOCKED_TTL = Number(process.env.CUBICLE_BLOCKED_TTL) || 30000;
const blockedCache = new Map();        // company id -> { at, map: identifier -> blocked, busy }
function shapeBlocked(i) {
  const a = i && i.blockedInboxAttention; if (!a || !i.identifier) return null;
  const b = i.blockerAttention || {}, leaf = a.leafIssue || b.terminalBlocker || null;
  const on = (leaf && leaf.identifier) || b.sampleStalledBlockerIdentifier || b.sampleBlockerIdentifier || '';
  return {
    state: String(a.state || ''), reason: String(a.reason || ''), severity: String(a.severity || ''),
    ...(a.stoppedSinceAt ? { since: a.stoppedSinceAt } : {}), owner: String((a.owner && a.owner.type) || 'unknown'),
    ...(on && on !== i.identifier ? { on } : {}),
    ...(a.interactionId ? { asks: true } : {}), ...(a.approvalId ? { approval: String(a.approvalId) } : {}),
    ...(REDACT ? {} : {
      ...(leaf && leaf.title && on !== i.identifier ? { onTitle: String(leaf.title).slice(0, 200) } : {}),
      ...(a.action && a.action.label ? { action: String(a.action.label).slice(0, 120), detail: String(a.action.detail || '').slice(0, 400) } : {}),
    }),
  };
}
// Paperclip takes a moment to work this out, so it is read at most every half minute, and once
// known the office gets the last answer at once while a newer one is fetched.
function blockedFor(companyId) {
  const c = blockedCache.get(companyId);
  if (c && (Date.now() - c.at < BLOCKED_TTL || c.busy)) return Promise.resolve(c.map);
  const entry = c || { at: 0, map: new Map() }; entry.busy = true; blockedCache.set(companyId, entry);
  const fresh = upstreamJSON('GET', `/api/companies/${companyId}/issues?attention=blocked`).then((r) => {
    if (r.status === 200 && Array.isArray(r.data)) entry.map = new Map(r.data.map((i) => [i && i.identifier, shapeBlocked(i)]).filter(([k, v]) => k && v));
    entry.at = Date.now(); entry.busy = false; return entry.map;
  }, () => { entry.at = Date.now(); entry.busy = false; return entry.map; });
  return c ? Promise.resolve(c.map) : fresh;
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
    toUser: !!i.assigneeUserId,
    blockers: i.blockerAttention && i.blockerAttention.unresolvedBlockerCount ? { n: i.blockerAttention.unresolvedBlockerCount,
      sample: i.blockerAttention.sampleBlockerIdentifier || '', stalled: i.blockerAttention.stalledBlockerCount || 0 } : null,
    asksYou: ((i.reviewAttention && i.reviewAttention.paths) || []).some(asksPerson),
    ...kpiTiming(i),
    // an advice task made by Cubicle: only the advice keys its description ends with, not the description
    ...(/cubicle-advice: ([A-Za-z0-9_,-]{1,300})/.test(String(i.description || '')) ? { advice: /cubicle-advice: ([A-Za-z0-9_,-]{1,300})/.exec(String(i.description))[1] } : {}),
  }));
}
// What the KPI's advice reads besides the status: priority, last activity, whether a run holds the
// task now, and since when (and for what) it waits on a person.
function kpiTiming(i) {
  const asks = ((i.reviewAttention && i.reviewAttention.paths) || []).filter(asksPerson);
  const since = asks.map((x) => Date.parse(x.since)).filter(Number.isFinite);
  return {
    ...pick(i, ['priority', 'lastActivityAt', 'updatedAt']),
    running: !!(i.executionRunId || i.checkoutRunId),
    ...(asks.length ? { asksKind: String(asks[0].kind || ''), ...(since.length ? { asksSince: new Date(Math.min(...since)).toISOString() } : {}) } : {}),
  };
}

function shapeFeed(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data && data.agents) ? data.agents : [];
  const agents = list.map((a) => {
    const r = pick(a, ['id', 'name', 'role', 'title', 'status', 'since', 'createdAt']);
    // Null marks sources that report completion explicitly but have not finished a turn yet.
    if (Object.hasOwn(a, 'completedAt')) {
      const t = typeof a.completedAt === 'number' ? a.completedAt : typeof a.completedAt === 'string' ? Date.parse(a.completedAt) : NaN;
      r.completedAt = Number.isFinite(t) && t > 0 && t <= 8640000000000000 ? new Date(t).toISOString() : null;
    }
    if (a.task) {
      if (typeof a.task === 'string') r.task = REDACT ? toolOnly(a.task) : a.task;
      else r.task = REDACT ? pick(a.task, ['id', 'identifier']) : pick(a.task, ['id', 'identifier', 'title', 'url']);
    }
    if (a.taskUrl && !REDACT) r.taskUrl = a.taskUrl;
    if (a.error) r.error = REDACT ? 'error' : a.error;
    if (a.parent) r.parent = String(a.parent);
    // When the current turn began, what the run said last, and the main task it belongs to.
    if (Number.isFinite(a.turnStart)) r.turnStart = a.turnStart;
    if (a.result && !REDACT) r.result = String(a.result).slice(0, 1200);
    if (a.main && typeof a.main === 'object') r.main = REDACT ? pick(a.main, ['id']) : { ...pick(a.main, ['id']), ...(a.main.title ? { title: String(a.main.title).slice(0, 160) } : {}) };
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
// One request to Paperclip, with the key when there is one: { status, data } (status 0 when unreachable).
function upstreamJSON(method, pathAndQuery, body) {
  return new Promise((resolve) => {
    const u = new URL(pathAndQuery, PAPERCLIP);
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = (u.protocol === 'https:' ? https : http).request(u, { method, timeout: 20000, headers: { accept: 'application/json',
      ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) } }, (r) => {
      const chunks = []; let size = 0;
      r.on('data', (c) => { size += c.length; if (size > MAX_UPSTREAM_BYTES) req.destroy(new Error('too large')); else chunks.push(c); });
      r.on('end', () => { let d = null; try { d = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {} resolve({ status: r.statusCode, data: d }); });
      r.on('error', () => resolve({ status: 0, data: null }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, data: null }));
    req.end(data || undefined);
  });
}
const KPI_MAX_PAGES = 20;

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

// An agent with an open "needs you" item raises its hand at its desk (status waiting, or error for a
// failure) until the item is dismissed, as agents waiting on a decision did in Paperclip.
// What the server itself writes (decisions it raises, labels on mirrored Paperclip tasks, the
// Telegram alert): Turkish or English, from "lang" in ~/.cubicle/settings.json, else the system's.
const SRV_TEXT = {
  en: { working: 'working', queued: 'queued', done: 'done', waiting: 'needs a decision', error: 'error', decision: 'Decision', busy: 'The CEO is busy; this task waits in the queue (one CEO, tasks in turn).',
    budgetTitle: (t) => `CEO ran out of budget: ${t}`, budgetText: (b) => `The task stopped halfway because it went over the budget for one run ($${b}). The issues and PRs it opened stay; a retry continues where it left off.`,
    failTitle: (t) => `CEO task failed: ${t}`, failText: (t) => `The task ended with an error: ${t}`,
    budgetOpts: ['Raise the budget and continue where you left off', 'Split the task into smaller parts and retry', 'Give up'], failOpts: ['Retry', 'Give up'],
    tgDecision: '❓ <b>Needs a decision</b>', tgError: '⚠️ <b>Error</b>', tgAnswer: 'Answer in Cubicle', tgHint: '(click the agent in Cubicle to answer)',
    fixTask: (f) => `[First responder] The agent "${f.name}" stopped with an error and no one has looked at it yet.\nTask: ${f.task || '(unknown)'}\nError: ${f.error || '(no message)'}${f.code ? `\nCode: ${f.code}` : ''}${f.steps ? `\nLast steps: ${f.steps}` : ''}\n\nFind out why and fix it if you can: read its log or issue, retry or relaunch the work, adjust the task, or close it if it is already done. Decide what you can decide yourself; the human only hears from you if you cannot fix it. In that case explain what you found and end with DECISION: <one question for the human> and OPTIONS: <2-4 options>. If you fixed it, end with DECISION: none.`, },
  tr: { working: '\u00e7al\u0131\u015f\u0131yor', queued: 's\u0131rada', done: 'tamamland\u0131', waiting: 'karar bekliyor', error: 'hata', decision: 'Karar', busy: 'CEO me\u015fgul; bu g\u00f6rev s\u0131raya al\u0131nd\u0131 (tek CEO, g\u00f6revler s\u0131rayla).',
    budgetTitle: (t) => `CEO bütçeye takıldı: ${t}`, budgetText: (b) => `Görev, tek çalıştırma bütçesini ($${b}) aştığı için yarıda kaldı. Açılan issue ve PR'lar yerinde duruyor; yeniden denerken kaldığı yerden devam eder.`,
    failTitle: (t) => `CEO görevi başarısız: ${t}`, failText: (t) => `Görev bir hatayla bitti: ${t}`,
    budgetOpts: ['Bütçeyi artırıp kaldığın yerden devam et', 'Görevi küçük parçalara bölüp yeniden dene', 'Vazgeç'], failOpts: ['Yeniden dene', 'Vazgeç'],
    tgDecision: '❓ <b>Karar bekliyor</b>', tgError: '⚠️ <b>Hata</b>', tgAnswer: 'Cubicle\'da cevapla', tgHint: '(Cubicle\'da ajan\u0131n \u00fczerine t\u0131klayarak cevaplayabilirsin)',
    fixTask: (f) => `[İlk müdahale] "${f.name}" ajanı hata verip durdu, henüz kimse bakmadı.\nGörev: ${f.task || '(bilinmiyor)'}\nHata: ${f.error || '(mesaj yok)'}${f.code ? `\nKod: ${f.code}` : ''}${f.steps ? `\nSon adımlar: ${f.steps}` : ''}\n\nNedenini bul ve çözebiliyorsan çöz: kaydını ya da issue'sunu oku, işi yeniden dene ya da yeniden başlat, görevi düzelt, iş zaten bitmişse kapat. Kendin karar verebileceğin şeyleri sormadan yap; insan ancak çözemezsen haberdar olsun. O durumda ne bulduğunu açıkla ve DECISION: <insana tek soru> ile OPTIONS: <2-4 seçenek> satırlarıyla bitir. Çözdüysen DECISION: none ile bitir.`, },
};
const srvLang = () => { const l = String(cubicleSettings().lang || process.env.CUBICLE_LANG || process.env.LANG || '').slice(0, 2).toLowerCase(); return SRV_TEXT[l] ? l : 'en'; };
const ST = (lang) => SRV_TEXT[lang || srvLang()] || SRV_TEXT.en;
// "raise the budget" in either language: the retry gets twice the budget
const MORE_BUDGET = /Bütçeyi artırıp|Raise the budget/i;
function overlayAttention(feed) {
  try {
    const items = attentionList().filter((x) => x.agent || x.taskId);
    if (!items.length || !feed || !Array.isArray(feed.agents)) return feed;
    for (const it of items) {
      const hits = feed.agents.filter((a) => (it.taskId && a.task && typeof a.task === 'object' && a.task.id === it.taskId) || (!it.taskId && a.name === it.agent));
      const a = hits.sort((x, y) => String(y.since || 0).localeCompare(String(x.since || 0), undefined, { numeric: true }))[0]
        || feed.agents.filter((x) => x.name === it.agent)[0];
      if (!a) continue;
      if (it.kind === 'decision') { a.status = 'waiting'; a.task = { ...(typeof a.task === 'object' && a.task ? a.task : {}), title: `${ST().decision}: ${it.text}`.slice(0, 120) }; }
      else { a.status = 'error'; a.error = it.text.slice(0, 120); }
    }
  } catch (_) {}
  return feed;
}
function serveFeed(res, source) {
  if (source.kind === 'file') {
    return fs.readFile(source.file, 'utf8', (err, txt) => {
      // No hook has fired yet: that is an empty office, not an error.
      if (err && err.code === 'ENOENT' && source.emptyIfMissing) return send(res, 200, JSON.stringify({ company: source.label, agents: [] }));
      if (err) return send(res, err.code === 'ENOENT' ? 404 : 500, JSON.stringify({ error: `cannot read ${source.file}` }));
      let data; try { data = JSON.parse(txt); } catch (_) { return send(res, 502, '{"error":"feed is not valid JSON"}'); }
      send(res, 200, JSON.stringify(overlayAttention(shapeFeed(data))));
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
  if (url.pathname === '/api/cubicle/settings') return serveSettings(req, res);
  if (url.pathname === '/api/cubicle/tasks') return serveTasks(req, res);
  if (url.pathname === '/api/cubicle/dispatch') return serveDispatch(req, res);
  if (url.pathname === '/api/cubicle/attention') return serveAttention(req, res);
  if (url.pathname === '/api/cubicle/update') return serveUpdate(req, res);
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
    const pcOff = cubicleSettings().paperclipLinks === false;
    const pcLinks = !HAS_PAPERCLIP ? undefined : pcOff ? '' : (fromThisMachine(req) || !/^(127\.|localhost$|\[::1\]$)/.test(PAPERCLIP.hostname)) ? PAPERCLIP.origin : (PAPERCLIP_PHONE_URL() || '');
    return send(res, 200, JSON.stringify({ sources, source: first.kind, label: first.label, paperclipUrl: HAS_PAPERCLIP ? PAPERCLIP.origin : undefined,
      paperclipLinks: pcLinks, ...(pcOff ? { paperclipLinksOff: true } : {}), redact: REDACT, version: VERSION, build: build(), telegram, ...(UPDATE ? { update: { ...UPDATE, canApply: fromThisMachine(req) && UPDATES.canApply(UPDATE.kind, UPDATE.auto) } } : {}) }));
  }

  const feedMatch = url.pathname.match(/^\/api\/feed(?:\/(\d+))?$/);
  if (feedMatch) {
    const feed = FEEDS[Number(feedMatch[1] || 0)];
    if (!feed) return send(res, 404, '{"error":"no such feed source"}');
    return serveFeed(res, feed);
  }

  const kpiMatch = url.pathname.match(/^\/api\/kpi\/([\w-]+)$/);
  if (kpiMatch && HAS_PAPERCLIP) {
    // Paperclip lists at most a thousand issues at a time: read every page (a big company has more).
    return (async () => {
      const all = [];
      for (let page = 0; page < KPI_MAX_PAGES; page++) {
        const r = await upstreamJSON('GET', `/api/companies/${kpiMatch[1]}/issues?limit=1000&offset=${page * 1000}&sortField=id&view=compact`);
        if (r.status !== 200 || !Array.isArray(r.data)) return send(res, r.status || 502, page ? JSON.stringify(shapeKpi(all)) : '{"error":"paperclip unreachable"}');
        all.push(...r.data);
        if (r.data.length < 1000) break;
      }
      send(res, 200, JSON.stringify(shapeKpi(all)));
    })();
  }

  // Paperclip retired: keep it only as the task store (KPI board), but show none of its agents or runs in the office.
  if (HAS_PAPERCLIP && /^\/api\/companies\/[\w-]+\/(agents|heartbeat-runs)$/.test(url.pathname)) {
    const st = cubicleSettings();
    if (st.paperclipAgents === false || (st.paperclipAgents === undefined && st.paperclipLinks === false)) return send(res, 200, '[]');
  }
  if (url.pathname.startsWith('/api/')) {
    if (!HAS_PAPERCLIP) return send(res, 403, '{"error":"not allowed"}');
    if (!ALLOWED.some((re) => re.test(url.pathname))) return send(res, 403, '{"error":"not allowed"}');
    // A company's open issues, each blocked one carrying what it waits for (Paperclip's blocked inbox).
    const issuesMatch = url.pathname.match(/^\/api\/companies\/([\w-]+)\/issues$/);
    if (issuesMatch) return (async () => {
      const [r, blocked] = await Promise.all([upstreamJSON('GET', url.pathname + ISSUES_QUERY), blockedFor(issuesMatch[1]).catch(() => new Map())]);
      if (r.status !== 200 || !Array.isArray(r.data)) return send(res, r.status || 502, r.status ? JSON.stringify(r.data || { error: 'paperclip error' }) : '{"error":"paperclip unreachable"}');
      send(res, 200, JSON.stringify(shapePaperclip(url.pathname, r.data).map((i) => (blocked.has(i.identifier) ? { ...i, blocked: blocked.get(i.identifier) } : i))));
    })();
    const query = url.pathname.endsWith('/heartbeat-runs') ? (url.searchParams.get('scope') === 'kpi' ? KPI_RUNS_QUERY : RUNS_QUERY)
      : url.pathname.endsWith('/issues') ? ISSUES_QUERY : url.pathname.endsWith('/comments') ? '?limit=3' : '';
    const upstreamUrl = new URL(url.pathname + query, PAPERCLIP);
    return proxyJson(res, upstreamUrl, TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
      '{"error":"paperclip unreachable"}', (data) => shapePaperclip(url.pathname, data, query === KPI_RUNS_QUERY));
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

// Hooks installed with npx (or for another OS, e.g. Windows next to WSL) run a copy of the hook
// script in <feed folder>/bin/. Keep such copies the same as this version's, so a Cubicle update
// reaches them too. Only a copy that already exists is refreshed.
function refreshHookCopies() {
  const mine = path.join(__dirname, 'cubicle-hook.js');
  let src; try { src = fs.readFileSync(mine); } catch (_) { return; }
  const dirs = new Set(SOURCES.filter((x) => x.kind === 'file').map((x) => path.join(path.dirname(x.file), 'bin')));
  for (const d of dirs) {
    const copy = path.join(d, 'cubicle-hook.js');
    try { if (path.resolve(copy) !== path.resolve(mine) && fs.existsSync(copy) && !fs.readFileSync(copy).equals(src)) { fs.writeFileSync(`${copy}.tmp`, src); fs.renameSync(`${copy}.tmp`, copy); console.log(`Cubicle: updated the hook script at ${copy}`); } } catch (_) {}
  }
}
refreshHookCopies();

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
  for (const x of SOURCES) if (x.kind === 'file' && !fs.existsSync(x.file)) console.log(`Note: ${x.file} does not exist yet; it counts as no agents until something writes it.`);
  restartTelegram();
  setInterval(watchFailures, Number(process.env.CUBICLE_FIX_INTERVAL || 15000)).unref();
  if (UPDATE_CHECK || AUTO_UPDATE) {
    UPDATES.watch({ every: AUTO_UPDATE ? 3600000 : 6 * 3600000, onNewer(v) {
      const kind = process.env.CUBICLE_INSTALL_KIND || UPDATES.installKind();
      UPDATE = { latest: v, kind, command: UPDATES.command(kind), auto: AUTO_UPDATE };
      if (!AUTO_UPDATE) return console.log(`Cubicle ${v} is out (this is ${VERSION}). To update: ${UPDATE.command}  (or start with --auto-update)`);
      // under --auto-update: stop cleanly and let the supervisor start the new version
      console.log(`Cubicle ${v} is out (this is ${VERSION}): restarting on it.`);
      if (TELEGRAM) TELEGRAM.stop();
      process.exitCode = UPDATES.UPDATE_EXIT;
      server.close(); server.closeAllConnections?.();
      setTimeout(() => process.exit(UPDATES.UPDATE_EXIT), 1500).unref();
    } });
  }
});

// The bot can also be set up from the page (⚙ → Telegram): the token and the replies switch are
// kept in ~/.cubicle/telegram-settings.json (chmod 600). A token from the environment wins.
let TELEGRAM = null;
const TG_SETTINGS = process.env.CUBICLE_TELEGRAM_SETTINGS || path.join(path.dirname(APPEARANCE_FILE), 'telegram-settings.json');
function tgSettings() { try { return JSON.parse(fs.readFileSync(TG_SETTINGS, 'utf8')) || {}; } catch (_) { return {}; } }
function tgToken() { return TELEGRAM_TOKEN || String(tgSettings().token || '').trim(); }
function tgReplies() { return HAS_PAPERCLIP && (TELEGRAM_REPLIES || !!tgSettings().replies); }
function tgAccess() {
  const s = tgSettings(), { isUserId } = require('./cubicle-telegram.js');
  return { allowEveryone: s.allowEveryone === undefined || s.allowEveryone === true,
    allowedUsers: Array.isArray(s.allowedUsers) ? [...new Set(s.allowedUsers.filter(isUserId))] : [] };
}
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
    ...(local ? { ...tgAccess(), linkedUsers: TELEGRAM ? TELEGRAM.linkedUsers() : [] } : {}),
  };
}
// ---------- turning KPI advice into a Paperclip task (off unless turned on) ----------
// The one other thing Cubicle can write to Paperclip besides Telegram replies: a subtask under a
// slow task, carrying the advice, when the setting is on. The setting is changed from this machine only.
const CUBICLE_SETTINGS = process.env.CUBICLE_SETTINGS || path.join(path.dirname(APPEARANCE_FILE), 'settings.json');
function cubicleSettings() { try { return JSON.parse(fs.readFileSync(CUBICLE_SETTINGS, 'utf8')) || {}; } catch (_) { return {}; } }
const canCreateTasks = () => HAS_PAPERCLIP && !REDACT && cubicleSettings().createTasks === true;
// Writes come from this page only: JSON, the page's own header, and no other site's origin.
function pageRequest(req) {
  if (!/^application\/json/.test(req.headers['content-type'] || '') || req.headers['x-cubicle'] !== '1') return false;
  const origin = req.headers.origin;
  try { if (origin && new URL(origin).host !== req.headers.host) return false; } catch (_) { return false; }
  return true;
}
function readBody(req, max) {
  return new Promise((resolve) => {
    let body = '', over = false;
    req.on('data', (d) => { if (body.length + d.length > max) over = true; else body += d; });
    req.on('end', () => { if (over) return resolve(undefined); try { resolve(JSON.parse(body)); } catch (_) { resolve(undefined); } });
  });
}
// What ⚙ → Cubicle settings shows and changes. Everyone gets the switches the page needs; the values,
// the file and what this process runs with only go to this machine, which alone may change them.
const SETTING_KEYS = {
  lang: (v) => v === '' || v === null ? undefined : ['en', 'tr'].includes(v) ? v : Symbol.for('bad'),
  autostart: (v) => typeof v === 'boolean' ? v : Symbol.for('bad'),
  port: (v) => v === '' || v === null ? undefined : Number.isInteger(v) && v >= 1 && v <= 65535 ? v : Symbol.for('bad'),
  sources: (v) => v === '' || v === null ? undefined : typeof v === 'string' && v.length <= 500 && /^[^\0\n\r"'`$;&|<>]+$/.test(v) ? v.trim() : Symbol.for('bad'),
  paperclipLinks: (v) => typeof v === 'boolean' ? v : Symbol.for('bad'),
  paperclipAgents: (v) => typeof v === 'boolean' ? v : Symbol.for('bad'),
  createTasks: (v) => typeof v === 'boolean' ? v : Symbol.for('bad'),
};
const DISPATCH_KEYS = {
  enabled: (v) => typeof v === 'boolean' ? v : Symbol.for('bad'),
  fixFailures: (v) => typeof v === 'boolean' ? v : Symbol.for('bad'),
  cwd: (v) => v === '' || v === null ? undefined : typeof v === 'string' && v.length <= 500 && !/[\0\n\r]/.test(v) ? v.trim() : Symbol.for('bad'),
  model: (v) => v === '' || v === null ? undefined : typeof v === 'string' && /^[\w.:\-\[\]]{1,80}$/.test(v) ? v : Symbol.for('bad'),
  budget: (v) => v === '' || v === null ? undefined : typeof v === 'number' && v >= 0.01 && v <= 100000 ? Math.round(v * 100) / 100 : Symbol.for('bad'),
  tools: (v) => v === '' || v === null ? undefined : typeof v === 'string' && v.length <= 2000 && !/[\0\n\r]/.test(v) ? v.trim() : Symbol.for('bad'),
  prompt: (v) => v === '' || v === null ? undefined : typeof v === 'string' && v.length <= 8000 ? v : Symbol.for('bad'),
};
function settingsStatus(req) {
  const local = fromThisMachine(req), c = cubicleSettings();
  const out = { createTasks: canCreateTasks(), available: HAS_PAPERCLIP && !REDACT, canEdit: local, paperclip: HAS_PAPERCLIP };
  if (!local) return out;
  const pick = (o, keys) => Object.fromEntries(Object.keys(keys).filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
  return { ...out, file: CUBICLE_SETTINGS, values: { ...pick(c, SETTING_KEYS), dispatch: pick(c.dispatch, DISPATCH_KEYS) },
    defaults: { port: 3200, sources: 'claude-code', dispatch: DISPATCH_DEFAULTS },
    running: { version: VERSION, host: HOST, port: PORT, sources: SOURCES.map((x) => x.kind === 'paperclip' ? `paperclip (${PAPERCLIP.origin})` : x.kind === 'file' ? x.file : x.kind === 'replay' ? 'replay' : x.url ? x.url.href : x.kind),
      autoUpdate: AUTO_UPDATE, updateCheck: UPDATE_CHECK, redact: REDACT, install: UPDATES.installKind(), lang: srvLang() } };
}
async function serveSettings(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, JSON.stringify(settingsStatus(req)));
  if (req.method !== 'PUT') return send(res, 405, '{"error":"GET or PUT"}');
  if (!fromThisMachine(req)) return send(res, 403, '{"error":"only from this machine"}');
  if (!pageRequest(req)) return send(res, 400, '{"error":"bad request"}');
  const data = await readBody(req, 16000);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, '{"error":"bad request"}');
  const next = { ...cubicleSettings() }, changed = [];
  const apply = (target, keys, src, prefix) => {
    for (const [k, v] of Object.entries(src)) {
      if (!keys[k]) return `unknown setting ${prefix}${k}`;
      const val = keys[k](v);
      if (val === Symbol.for('bad')) return `bad value for ${prefix}${k}`;
      if (val === undefined) delete target[k]; else target[k] = val;
      changed.push(prefix + k);
    }
    return null;
  };
  const { dispatch, ...top } = data;
  let err = apply(next, SETTING_KEYS, top, '');
  if (!err && dispatch !== undefined) {
    if (!dispatch || typeof dispatch !== 'object' || Array.isArray(dispatch)) err = 'bad value for dispatch';
    else { next.dispatch = { ...(next.dispatch && typeof next.dispatch === 'object' ? next.dispatch : {}) }; err = apply(next.dispatch, DISPATCH_KEYS, dispatch, 'dispatch.'); if (!Object.keys(next.dispatch).length) delete next.dispatch; }
  }
  if (err) return send(res, 400, JSON.stringify({ error: err }));
  try { fs.mkdirSync(path.dirname(CUBICLE_SETTINGS), { recursive: true }); require('./cubicle-telegram.js').writeFileAtomic(CUBICLE_SETTINGS, JSON.stringify(next, null, 2)); }
  catch (_) { return send(res, 500, JSON.stringify({ error: `cannot write ${CUBICLE_SETTINGS}` })); }
  if (changed.length) console.log(`Cubicle: settings changed from the page: ${changed.join(', ')}.`);
  send(res, 200, JSON.stringify(settingsStatus(req)));
}
// ---------- "Update now": from the page on this machine, or /update from a linked Telegram chat ----------
let updating = false;
function applyUpdate(from) {
  if (!UPDATE) return { ok: false, error: 'none' };
  if (updating) return { ok: true, version: UPDATE.latest };
  const r = UPDATES.prepare({ kind: UPDATE.kind, version: UPDATE.latest, auto: UPDATE.auto, argv: process.argv.slice(2) });
  if (!r.ok) { console.log(`Cubicle: could not update to ${UPDATE.latest} from ${from} (${r.error}); run: ${r.command}`); return { ok: false, error: r.error, command: r.command }; }
  updating = true;
  console.log(`Cubicle: updating to ${UPDATE.latest} (asked from ${from}).`);
  setTimeout(() => {   // let the answer go out first, then let go of the port, then start the new version
    if (TELEGRAM) TELEGRAM.stop();
    process.exitCode = r.exitCode;
    server.close(); server.closeAllConnections?.();
    setTimeout(() => { try { if (r.restart) r.restart(); } catch (e) { console.error(`Cubicle: could not start the new version (${e.message})`); } process.exit(r.exitCode); }, 700);
  }, 300);
  return { ok: true, version: UPDATE.latest };
}
async function serveUpdate(req, res) {
  if (req.method !== 'POST') return send(res, 405, '{"error":"POST"}');
  if (!fromThisMachine(req)) return send(res, 403, '{"error":"only from this machine"}');
  if (!pageRequest(req)) return send(res, 400, '{"error":"bad request"}');
  const r = applyUpdate('the page');
  send(res, r.ok ? 202 : r.error === 'none' ? 404 : 409, JSON.stringify(r));
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
async function serveTasks(req, res) {
  if (req.method !== 'POST') return send(res, 405, '{"error":"POST"}');
  if (!canCreateTasks()) return send(res, 403, '{"error":"turning advice into tasks is off (turn it on under the KPI advice)"}');
  if (!pageRequest(req)) return send(res, 400, '{"error":"bad request"}');
  const d = await readBody(req, 20000);
  if (!d || typeof d !== 'object' || !UUID.test(String(d.parentId || '')) || (d.assigneeAgentId && !UUID.test(String(d.assigneeAgentId)))
    || typeof d.title !== 'string' || !d.title.trim() || typeof (d.description ?? '') !== 'string') return send(res, 400, '{"error":"bad request"}');
  // The parent must be a real issue, and the assignee an agent of the same company.
  const parent = await upstreamJSON('GET', `/api/issues/${d.parentId}`);
  if (parent.status !== 200 || !parent.data || !parent.data.companyId) return send(res, 404, '{"error":"no such task"}');
  if (d.assigneeAgentId) {
    const agents = await upstreamJSON('GET', `/api/companies/${parent.data.companyId}/agents`);
    if (!Array.isArray(agents.data) || !agents.data.some((a) => a && a.id === d.assigneeAgentId)) return send(res, 400, '{"error":"no such agent"}');
  }
  // Paperclip's general create, with the parent set (its /children helper stops at 25 subtasks, and a
  // slow task usually has more); the new task stays in the parent's project and goal.
  const p = parent.data;
  const body = { title: d.title.trim().slice(0, 200), description: String(d.description || '').slice(0, 8000), status: 'todo',
    priority: PRIORITIES.has(d.priority) ? d.priority : 'high', parentId: p.id,
    ...(p.projectId ? { projectId: p.projectId } : {}), ...(p.goalId ? { goalId: p.goalId } : {}), ...(d.assigneeAgentId ? { assigneeAgentId: d.assigneeAgentId } : {}) };
  const r = await upstreamJSON('POST', `/api/companies/${p.companyId}/issues`, body);
  if (r.status < 200 || r.status >= 300 || !r.data) return send(res, r.status || 502, JSON.stringify({ error: String((r.data && r.data.error) || 'Paperclip refused the task').slice(0, 300) }));
  const made = r.data.issue || r.data;
  console.log(`Cubicle: created ${made.identifier || made.id} under ${parent.data.identifier || d.parentId} from KPI advice.`);
  send(res, 200, JSON.stringify({ ok: true, id: made.id, identifier: made.identifier || '' }));
}

// ---------- task box: hand a task to the CEO from the page (off unless turned on) ----------
// Opt-in via ~/.cubicle/settings.json: { "dispatch": { "enabled": true, "cwd": "~/agents" } }.
// A POST starts one headless `claude -p` run named "CEO" (so it shows up in the office), which turns
// the task into a GitHub issue labelled agent:ready, or answers it. Local machine only, this page only.
const DISPATCH_RUNS = [];
const RUNS_FILE = path.join(path.dirname(CUBICLE_SETTINGS), 'dispatch', 'runs.json');
function saveRuns() { try { fs.mkdirSync(path.dirname(RUNS_FILE), { recursive: true }); fs.writeFileSync(RUNS_FILE, JSON.stringify(DISPATCH_RUNS.slice(-30))); } catch (_) {} }
// After a restart: runs that were going keep going (they are detached); show them as running while their process lives.
try {
  for (const r of JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8'))) {
    if (r.state === 'running') { let alive = false; try { process.kill(r.pid, 0); alive = !!r.pid; } catch (_) {} if (alive) r.orphan = true; else { r.state = 'done'; r.ended = Date.now(); } }
    DISPATCH_RUNS.push(r);
  }
} catch (_) {}
// CEO tasks get readable ids (CEO-001, CEO-002, ...) instead of a base-36 timestamp. The counter is kept in a file,
// so it keeps counting after old runs fall off the 30-run list.
const SEQ_FILE = path.join(path.dirname(RUNS_FILE), 'seq.txt');
function nextRunId() {
  let n = 0;
  try { n = parseInt(fs.readFileSync(SEQ_FILE, 'utf8'), 10) || 0; } catch (_) {}
  for (const r of DISPATCH_RUNS) { const m = /^CEO-(\d+)$/.exec(r.id || ''); if (m) n = Math.max(n, Number(m[1])); }
  n++;
  try { fs.mkdirSync(path.dirname(SEQ_FILE), { recursive: true }); fs.writeFileSync(SEQ_FILE, String(n)); } catch (_) {}
  return 'CEO-' + String(n).padStart(3, '0');
}
// the task id on the card and on its questions: readable ids as they are, old timestamp ids keep their T- prefix
const taskRef = (id) => (/^CEO-\d+$/.test(id) ? id : `T-${id}`);
setInterval(() => {   // pick up runs that ended while this server was down
  let changed = false;
  for (const r of DISPATCH_RUNS) if (r.state === 'running' && r.orphan) { let alive = false; try { process.kill(r.pid, 0); alive = true; } catch (_) {} if (!alive) { r.state = 'done'; r.ended = Date.now(); try { r.tail = fs.readFileSync(r.logFile, 'utf8').slice(-1500); } catch (_) {} changed = true; } }
  if (changed) saveRuns();
  nextQueued();
}, 5000).unref();
// Mirror a CEO task into Paperclip (when it is a source) so the KPI board shows it with progress and ETA.
// Workers the CEO starts inherit PC_PARENT and add their runs as subtasks.
async function dispatchTrack(text) {
  if (!HAS_PAPERCLIP) return '';
  try {
    const cs = await upstreamJSON('GET', '/api/companies');
    const co = Array.isArray(cs.data) && cs.data[0];
    if (!co) return '';
    const r = await upstreamJSON('POST', `/api/companies/${co.id}/issues`, { title: `[CEO \u00b7 ${ST().working}] ${text.slice(0, 140)}`, description: text.slice(0, 4000), status: 'todo', priority: 'medium' });
    const made = r.data && (r.data.issue || r.data);
    return made && made.id ? made.id : '';
  } catch (_) { return ''; }
}
// Card text on the board: "[CEO · state] title", plus a comment with the run's final answer.
async function dispatchLabel(id, status, state, note) {
  if (!id) return;
  try {
    const cur = await upstreamJSON('GET', `/api/issues/${id}`);
    const i = (cur.data && (cur.data.issue || cur.data)) || {};
    const base = String(i.title || '').replace(/^\[[^\]]*\]\s*/, '');
    await upstreamJSON('PATCH', `/api/issues/${id}`, { title: `[CEO \u00b7 ${state}] ${base}`.slice(0, 200), ...(status ? { status } : {}) });
    if (note) await upstreamJSON('POST', `/api/issues/${id}/comments`, { body: `**CEO** \u2014 ${state}\n\n${String(note).slice(-1800)}` });
  } catch (_) {}
}
function dispatchFinish(id, state, tail) {
  const decision = /DECISION:\s*(?!none|yok|-)\S/i.test(String(tail || ''));
  const t = ST();
  if (state === 'done' && decision) dispatchLabel(id, 'blocked', t.waiting, tail);
  else if (state === 'done') dispatchLabel(id, 'done', t.done, tail);
  else dispatchLabel(id, 'blocked', t.error, tail);
}
const DISPATCH_DEFAULTS = { cwd: '~/agents', model: 'sonnet', budget: 2,
  tools: 'Read|Glob|Grep|Agent|Bash(gh *)|Bash(git status*)|Bash(git log*)|Bash(cat*)|Bash(ls*)|Bash(bash ~/agents/run-issue.sh*)',
  prompt: 'You are the CEO of a small AI-run company. A human gave you the task below. Decide what it needs. If it is code or content work, pick the right repo from ~/agents/repos.conf (or `gh repo list`), open a GitHub issue there with a clear title and acceptance criteria, label it agent:ready (create the label if missing), and, if it is in repos.conf, start the worker with `bash ~/agents/run-issue.sh <repo> <number>` in the background. If it is just a question, answer it. Finish with 3 lines: what you did, links, what the human must decide. Make the DECISION understandable on its own: never write "the snippet above"; if the human must run something, put the full command in a fenced code block in your answer (it is shown to them as details with a copy button).' };
function dispatchCfg() {
  const d = cubicleSettings().dispatch;
  if (!d || d.enabled !== true) return null;
  const home = require('os').homedir(), D = DISPATCH_DEFAULTS;
  const cwd = String(d.cwd || D.cwd).replace(/^~(?=\/|$)/, home);
  return { cwd, model: String(d.model || D.model), budget: Number(d.budget) > 0 ? Number(d.budget) : D.budget, tools: String(d.tools || D.tools), prompt: String(d.prompt || D.prompt) };
}
// One CEO at a time: a new task waits in the queue (state "queued") and starts when the running one ends.
function nextQueued() {
  if (DISPATCH_RUNS.some((r) => r.state === 'running')) return;
  const n = DISPATCH_RUNS.find((r) => r.state === 'queued');
  if (n) startRun(n);
}
function startRun(run) {
  const cfg = dispatchCfg();
  const { id, logFile, pcId } = run;
  const text = run.fullText || run.text;
  if (!cfg) { run.state = 'failed'; run.ended = Date.now(); saveRuns(); return nextQueued(); }
  run.state = 'running'; run.started = Date.now();
  if (pcId) dispatchLabel(pcId, null, ST().working);
  const out = fs.openSync(logFile, 'a');
  const child = require('child_process').spawn(process.env.CUBICLE_CLAUDE || 'claude', ['-p', `${cfg.prompt}\n\nTASK:\n${text}`, '--model', cfg.model, '--max-budget-usd', String(MORE_BUDGET.test(text) ? Math.max(cfg.budget, Math.min(cfg.budget * 2, 30)) : cfg.budget),
    '--permission-mode', 'dontAsk', '--allowedTools', ...cfg.tools.split('|')], {
    cwd: cfg.cwd, stdio: ['ignore', out, out], detached: true,
    env: { ...process.env, PATH: [path.dirname(process.execPath), path.join(require('os').homedir(), '.local', 'bin'), process.env.PATH || ''].join(path.delimiter), CUBICLE_NAME: 'CEO', CUBICLE_ROLE: 'CEO', CUBICLE_TASK_ID: taskRef(id), CUBICLE_TASK: text.slice(0, 120),
      // workers the CEO starts inherit these, so their alerts can say how far this task has come
      CUBICLE_MAIN_TASK_ID: taskRef(id), CUBICLE_MAIN_TASK: text.slice(0, 160), CUBICLE_LINGER: '1', ...(pcId ? { PC_PARENT: pcId } : {}) } });
  let finished = false;
  const done = (state) => { if (finished) return; finished = true; run.state = state; run.ended = Date.now(); try { run.tail = fs.readFileSync(logFile, 'utf8').slice(-1500); } catch (_) {} dispatchFinish(pcId, state, run.tail); saveRuns(); nextQueued(); };
  run.pid = child.pid || 0; run.orphan = false; saveRuns();
  child.on('error', (e) => { try { fs.appendFileSync(logFile, `spawn error: ${e.message}\n`); } catch (_) {} done('failed'); });
  child.on('exit', (code, sig) => { setTimeout(() => { try { const full = fs.readFileSync(logFile, 'utf8').slice(-14000), tail = full.slice(-2500); const m = /DECISION:\s*([^\n]+(?:\n(?!\s*$)[^\n]*)*)/i.exec(tail); if (code !== 0) { const bud = /Exceeded USD budget/i.test(tail), t = ST(), opts = bud ? t.budgetOpts : t.failOpts; attentionAdd({ agent: 'CEO', taskId: taskRef(id), kind: 'decision', title: bud ? t.budgetTitle(text.slice(0, 70)) : t.failTitle(text.slice(0, 70)), text: bud ? t.budgetText(cfg.budget) : t.failText(tail.replace(/\s+/g, ' ').slice(-300)), options: opts, cancel: opts[opts.length - 1], detail: full.slice(-3000).trim() }); } else if (m && !/^\s*(none|yok|-)\s*\.?\s*$/i.test(m[1].split('\n')[0])) { const om = /^\s*OPTIONS:\s*([^\n]+)/im.exec(tail); attentionAdd({ agent: 'CEO', taskId: taskRef(id), kind: 'decision', title: `CEO: ${text.slice(0, 80)}`, text: m[1].replace(/\n?\s*OPTIONS:[^\n]*/i, '').trim(), options: om ? om[1].split(/\s*\|\s*/) : [], detail: ceoDetail(full) }); } } catch (_) {} }, 300); if (code !== 0) { try { fs.appendFileSync(logFile, `exit code=${code} signal=${sig}\n`); } catch (_) {} } done(code === 0 ? 'done' : 'failed'); });
  console.log(`Cubicle: CEO task ${id} started.`);
}
async function serveDispatch(req, res) {
  if (!(await fromOwner(req))) return send(res, 403, '{"error":"only from this machine or your own devices"}');
  const cfg = dispatchCfg();
  if (req.method === 'GET' || req.method === 'HEAD') {
    return send(res, 200, JSON.stringify({ enabled: !!cfg, runs: DISPATCH_RUNS.slice(-8).reverse().map(({ id, text, state, started, ended, tail }) => ({ id, text, state, started, ended, tail })) }));
  }
  if (req.method !== 'POST') return send(res, 405, '{"error":"GET or POST"}');
  if (!cfg) return send(res, 403, '{"error":"task box is off (set dispatch.enabled in ~/.cubicle/settings.json)"}');
  if (!pageRequest(req)) return send(res, 400, '{"error":"bad request"}');
  return readBody(req, 8000).then(async (d) => {
    const text = d && typeof d.text === 'string' ? d.text.trim().slice(0, 4000) : '';
    if (!text) return send(res, 400, '{"error":"empty task"}');
    const r = await queueCeo(text);
    if (!r) return send(res, 429, '{"error":"queue full (20)"}');
    send(res, 200, JSON.stringify({ ok: true, id: r.id, queued: r.queued }));
  });
}
// A task for the CEO: runs now, or waits its turn. Returns null when the queue is full.
async function queueCeo(text, extra = {}) {
  if (DISPATCH_RUNS.filter((r) => r.state === 'queued').length >= 20) return null;
  const id = nextRunId();
  const dir = path.join(path.dirname(CUBICLE_SETTINGS), 'dispatch');
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, `${id}.log`);
  const busy = DISPATCH_RUNS.some((r) => r.state === 'running');
  const run = { id, text: text.slice(0, 200), fullText: text, state: busy ? 'queued' : 'running', started: Date.now(), ended: 0, tail: '', logFile, pid: 0, pcId: '', ...extra };
  DISPATCH_RUNS.push(run);
  run.pcId = await dispatchTrack(text);
  if (busy) { dispatchLabel(run.pcId, null, ST().queued, ST().busy); saveRuns(); console.log(`Cubicle: CEO task ${id} queued.`); }
  else startRun(run);
  return { id, queued: busy };
}

// ---------- first responder: a failed agent goes to the CEO before it comes to you ----------
// With the task box on (and dispatch.fixFailures not false), an agent that stops with an error is
// handed to the CEO with what is known about the failure. The CEO fixes it (retries, relaunches,
// adjusts the task) or ends with a DECISION, which reaches you as a question like any other. A
// failure is handed over once; at most 2 per agent in 6 hours and 6 in all per hour, the rest wait
// for you as before. The CEO's own failures always come to you.
const FIX = { seen: new Map(), recent: [] };
const failKey = (a) => a.fail ? `${a.id}|run:${a.fail.id}` : `${a.id}|err:${String(a.error || '').slice(0, 80)}|${a.task ? a.task.identifier || a.task.title || '' : ''}`;
const isCeo = (a) => /^ceo\b/i.test(String(a.name || '')) || /CEO-\d+/.test(String(a.task && (a.task.identifier || a.task.title) || ''));
function fixFailuresOn() { const d = cubicleSettings().dispatch; return !!dispatchCfg() && !(d && d.fixFailures === false); }
// true when the CEO has this failure (now or already); false when it stays with you
function ceoTakes(a) {
  if (!a || !(a.fail || a.status === 'error') || isCeo(a) || a.sub || !fixFailuresOn()) return false;
  const key = failKey(a);
  if (FIX.seen.has(key)) return FIX.seen.get(key);
  const now = Date.now();
  FIX.recent = FIX.recent.filter((x) => now - x.t < 6 * 3600000);
  const mine = FIX.recent.filter((x) => x.agent === a.id).length, hour = FIX.recent.filter((x) => now - x.t < 3600000).length;
  if (mine >= 2 || hour >= 6) { FIX.seen.set(key, false); return false; }
  FIX.seen.set(key, true); FIX.recent.push({ agent: a.id, t: now });
  const t = ST(), task = a.task ? [a.task.identifier, a.task.title].filter(Boolean).join(' ') + (a.task.url ? ` (${a.task.url})` : '') : '';
  const text = t.fixTask({ name: a.name, task, error: (a.fail && a.fail.error) || a.error || '', code: a.fail ? a.fail.code : '', steps: (a.steps || []).join(' → ') });
  queueCeo(text, { auto: true, forAgent: a.id }).then((r) => console.log(`Cubicle: ${a.name} failed; ${r ? `handed to the CEO (${r.id})` : 'the CEO queue is full, so it stays with you'}.`)).catch(() => {});
  return true;
}
let fixKnown = null;
async function watchFailures() {
  if (!fixFailuresOn()) { fixKnown = null; return; }
  try {
    const { agents } = await require('./cubicle-telegram.js').snapshot(self);
    if (fixKnown) for (const a of agents) {
      const before = fixKnown.get(a.id);
      if ((a.fail && (!before || before.failId !== a.fail.id)) || (!a.fail && a.status === 'error' && before && before.status !== 'error')) ceoTakes(a);
    }
    fixKnown = new Map([...(fixKnown || []), ...agents.map((a) => [a.id, { failId: a.fail && a.fail.id, status: a.status }])]);
  } catch (_) {}
}

// ---------- "needs you": errors and open decisions from agents ----------
// Scripts and CEO runs POST here; the page shows the list (with a dismiss button) and every linked
// Telegram chat gets a message. Stored in ~/.cubicle/attention.json. Local machine only.
const ATTENTION_FILE = path.join(path.dirname(CUBICLE_SETTINGS), 'attention.json');
function attentionList() { try { const a = JSON.parse(fs.readFileSync(ATTENTION_FILE, 'utf8')); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
// What the CEO wrote before its DECISION line, so the question can be understood on its own (code blocks included).
function ceoDetail(s) { s = String(s || ''); const i = s.search(/^\s*DECISION:/im); return (i > 0 ? s.slice(0, i) : s).trim().slice(-6000); }
function attentionAdd(item) {
  const list = attentionList();
  const it = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), kind: item.kind === 'decision' ? 'decision' : 'error',
    title: String(item.title || '').slice(0, 160), text: String(item.text || '').slice(0, 1500), detail: String(item.detail || '').slice(-6000), url: /^https?:\/\//.test(item.url || '') ? String(item.url).slice(0, 300) : '', agent: String(item.agent || '').slice(0, 80), taskId: String(item.taskId || '').slice(0, 80),
    options: Array.isArray(item.options) ? item.options.map((x) => String(x).trim().slice(0, 160)).filter(Boolean).slice(0, 6) : [], multi: item.multi === true,
    ...(typeof item.cancel === 'string' && item.cancel.trim() ? { cancel: item.cancel.trim().slice(0, 160) } : {}) };
  list.push(it);
  try { require('./cubicle-telegram.js').writeFileAtomic(ATTENTION_FILE, JSON.stringify(list.slice(-50))); } catch (_) {}
  if (TELEGRAM && TELEGRAM.notify) {
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // The longer answer goes along (a question often refers to "the commands above"): its code
    // blocks whole, as much of the rest as fits in one message.
    const detail = (() => {
      const d = String(it.detail || '').trim(); if (!d) return '';
      const parts = d.split(/```[a-zA-Z0-9_-]*\n?/);
      let code = ''; for (const c of parts.filter((_, i) => i % 2)) { const block = `<pre>${esc(c.replace(/\n$/, '').slice(0, 1500))}</pre>`; if (code.length + block.length > 2000) break; code += (code ? '\n' : '') + block; }
      const prose = parts.filter((_, i) => i % 2 === 0).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      const room = Math.max(0, 2600 - code.length);
      const text = prose.length > room ? prose.slice(0, room).replace(/\s+\S*$/, '') + ' …' : prose;
      return `${text ? esc(text).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>') + '\n' : ''}${code}`.trim();
    })();
    // in each chat's own language (Turkish or English)
    TELEGRAM.notify((lang) => { const t = ST(lang === 'tr' ? 'tr' : 'en');
      return `${it.kind === 'decision' ? t.tgDecision : t.tgError}: ${esc(it.title)}\n${detail ? detail + '\n\n' : ''}${esc(it.text.slice(0, 600))}${it.options.length ? '\n' + it.options.map((x, n) => `${n + 1}) ${esc(x)}`).join('\n') : ''}${it.url ? `\n${esc(it.url)}` : ''}\n${it.agent ? `<a href="${esc(`${tgPublicUrl().replace(/\/$/, '')}/?agent=${encodeURIComponent(it.agent)}`)}">${t.tgAnswer}</a>` : t.tgHint}`; });
  }
  console.log(`Cubicle: needs you (${it.kind}): ${it.title}`);
  return it;
}
async function serveAttention(req, res) {
  if (!(await fromOwner(req))) return send(res, 403, '{"error":"only from this machine or your own devices"}');
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, JSON.stringify(attentionList().reverse()));
  if (req.method !== 'POST') return send(res, 405, '{"error":"GET or POST"}');
  if (!pageRequest(req)) return send(res, 400, '{"error":"bad request"}');
  return readBody(req, 8000).then((d) => {
    if (!d || typeof d !== 'object') return send(res, 400, '{"error":"bad request"}');
    if (typeof d.dismiss === 'string') {
      const left = attentionList().filter((x) => x.id !== d.dismiss && d.dismiss !== 'all');
      try { require('./cubicle-telegram.js').writeFileAtomic(ATTENTION_FILE, JSON.stringify(left)); } catch (_) {}
      return send(res, 200, '{"ok":true}');
    }
    if (typeof d.title !== 'string' || !d.title.trim()) return send(res, 400, '{"error":"title needed"}');
    send(res, 200, JSON.stringify({ ok: true, id: attentionAdd(d).id }));
  });
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
    if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, '{"error":"bad request"}');
    const next = { ...tgSettings() };
    if ('allowEveryone' in data) {
      if (typeof data.allowEveryone !== 'boolean') return send(res, 400, '{"error":"access"}');
      next.allowEveryone = data.allowEveryone;
    }
    if ('allowedUsers' in data) {
      if (!Array.isArray(data.allowedUsers) || !data.allowedUsers.every(require('./cubicle-telegram.js').isUserId)) return send(res, 400, '{"error":"users"}');
      next.allowedUsers = [...new Set(data.allowedUsers)];
    }
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
      require('./cubicle-telegram.js').writeFileAtomic(TG_SETTINGS, JSON.stringify(next));
    } catch (e) { return send(res, 500, JSON.stringify({ error: `cannot write ${TG_SETTINGS}` })); }
    if ('token' in data) restartTelegram(); else if (TELEGRAM) { TELEGRAM.setReplies(tgReplies()); TELEGRAM.setPublicUrl(tgPublicUrl()); TELEGRAM.setAccess(tgAccess()); }
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
// The person this machine belongs to, on the phone too: a request `tailscale serve` forwards from a
// device signed in to the same Tailscale account as this machine (your own phone) may answer agents'
// questions and give the CEO a task, like a browser on this machine. Someone else on the tailnet
// (a shared or tagged device) may not. Tailscale vouches for who it is: serve forwards from loopback
// and names the device's tailnet address, which `tailscale whois` turns into its account.
const tsWho = new Map();            // tailnet address -> { at, login }
let tsSelf = { at: 0, login: '' };
async function tsLogin(args, pick) {
  for (const bin of TS_BINS) {
    const raw = await tsRun(bin, args); if (raw == null) continue;
    try { return String(pick(JSON.parse(raw)) || '').toLowerCase(); } catch (_) { return ''; }
  }
  return '';
}
async function fromOwner(req) {
  if (fromThisMachine(req)) return true;
  if (!isLoopback(req.socket.remoteAddress)) return false;
  const ip = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  if (!/^(100\.\d+\.\d+\.\d+|fd7a:115c:a1e0:[0-9a-f:]+)$/i.test(ip)) return false;      // a tailnet address only
  const now = Date.now();
  if (now - tsSelf.at > 600000) tsSelf = { at: now, login: await tsLogin(['status', '--json'], (st) => st.User && st.Self && st.User[String(st.Self.UserID)] && st.User[String(st.Self.UserID)].LoginName) };
  let w = tsWho.get(ip);
  if (!w || now - w.at > 600000) { w = { at: now, login: await tsLogin(['whois', '--json', ip], (x) => x.UserProfile && x.UserProfile.LoginName) }; tsWho.set(ip, w); }
  return !!tsSelf.login && w.login === tsSelf.login;
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
      try { require('./cubicle-telegram.js').writeFileAtomic(TG_SETTINGS, JSON.stringify({ ...tgSettings(), publicUrl: after.url })); } catch (_) {}
      if (TELEGRAM) TELEGRAM.setPublicUrl(tgPublicUrl());
    }
    const { bin, ...pub } = after;
    send(res, 200, JSON.stringify(pub));
  });
}

function startTelegram(token) {
  const bot = require('./cubicle-telegram.js').start({
    token, self, publicUrl: tgPublicUrl(), replies: tgReplies(), ...tgAccess(), version: VERSION, update: () => UPDATE, applyUpdate: () => applyUpdate('Telegram'), ceoTakes,
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
