#!/usr/bin/env node
// Cubicle hook for Claude Code, Codex CLI and Gemini CLI.
// The CLI runs this on its hook events and pipes the event JSON to stdin. It keeps
// ~/.cubicle/<runtime>.json up to date, one agent per session, in the Cubicle feed
// format (docs/FEED.md). No dependencies, no network.
//
//   cubicle install-hooks [codex|gemini]      then: cubicle --source claude-code|codex|gemini
//
// The runtime is the first argument (default: Claude Code). Codex uses Claude Code's event
// names and fields; Gemini CLI's events are mapped onto them below.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.cubicle');

const RUNTIMES = {
  claude: {
    label: 'Claude Code', file: 'claude-code.json', settings: path.join(os.homedir(), '.claude', 'settings.json'),
    events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
      'Notification', 'PreCompact', 'Stop', 'StopFailure', 'SessionEnd', 'SubagentStart', 'SubagentStop'],
    timeout: () => 5, reply: '',
  },
  codex: {
    label: 'Codex', file: 'codex.json', settings: path.join(os.homedir(), '.codex', 'hooks.json'),
    events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
      'PreCompact', 'Stop', 'SessionEnd', 'SubagentStart', 'SubagentStop'],
    timeout: (ev) => (ev === 'SessionEnd' ? 3 : 5),   // seconds; Codex caps SessionEnd hooks at 3 s
    reply: '{}',                                       // Codex expects JSON on stdout for some events
  },
  gemini: {
    label: 'Gemini CLI', file: 'gemini.json', settings: path.join(os.homedir(), '.gemini', 'settings.json'),
    events: ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'Notification', 'PreCompress', 'AfterAgent', 'SessionEnd'],
    timeout: () => 5000, reply: '{}',                  // milliseconds; Gemini parses stdout as JSON
  },
};
const GEMINI_EVENTS = { BeforeAgent: 'UserPromptSubmit', BeforeTool: 'PreToolUse', AfterTool: 'PostToolUse', AfterAgent: 'Stop', PreCompress: 'PreCompact' };
const runtimeOf = (name) => RUNTIMES[name] ? name : 'claude';

// Gemini CLI events carry the same fields under other names; translate them once.
function normalize(ev, runtime) {
  if (runtime !== 'gemini') return ev;
  // Gemini fires PreCompress on every turn, compressing or not: not worth a bubble.
  if (ev.hook_event_name === 'PreCompress') return { ...ev, hook_event_name: 'Ignored' };
  const out = { ...ev, hook_event_name: GEMINI_EVENTS[ev.hook_event_name] || ev.hook_event_name };
  // Tool confirmations carry the command in `details`; show it like a Claude Code permission prompt.
  const d = ev.details || {};
  if (ev.hook_event_name === 'Notification' && (d.command || d.fileName || d.filePath)) {
    out.message = `allow ${String(d.command || path.basename(String(d.fileName || d.filePath))).slice(0, 60)}?`;
  }
  return out;
}

const STALE_MS = 12 * 60 * 60 * 1000; // drop sessions with no event for 12 h

function summarize(ev) {
  const tool = ev.tool_name || '';
  const inp = ev.tool_input || {};
  const short = (s, n = 48) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const file = inp.file_path || inp.absolute_path || inp.path;
  if (file && typeof file === 'string') return `${tool} ${path.basename(file)}`;
  if (inp.command) return `${tool}: ${short(inp.command)}`;
  if (inp.description) return `${tool}: ${short(inp.description)}`;
  if (inp.pattern) return `${tool} ${short(inp.pattern, 30)}`;
  if (inp.query) return `${tool}: ${short(inp.query)}`;
  return tool || 'working';
}

// Subagents (Task/Agent tool) share the parent's session_id; Claude Code tells them
// apart with agent_id / agent_type on their hook events. Each subagent gets its own
// character, keyed "<session_id>:<agent_id>", and leaves when it stops.
function applySubagent(feed, agents, ev, now) {
  const sid = ev.session_id || 'unknown';
  const id = `${sid}:${ev.agent_id}`;
  const parent = agents.find((x) => x.id === sid);
  const base = (parent && parent.name) || path.basename(ev.cwd || '') || 'claude';
  let a = agents.find((x) => x.id === id);
  const fresh = () => ({ id, since: now, parent: sid, name: `${base} › ${ev.agent_type || 'subagent'}`, role: `${feed.company || 'Claude Code'} subagent` });

  switch (ev.hook_event_name) {
    case 'SubagentStop':
      return { ...feed, agents: agents.filter((x) => x.id !== id) };
    case 'SubagentStart':
      a = a || fresh();
      Object.assign(a, { status: 'running', task: 'starting', error: null });
      break;
    case 'PreToolUse':
    case 'PostToolUse':
      a = a || fresh();
      Object.assign(a, { status: 'running', task: summarize(ev), error: null });
      break;
    case 'PermissionRequest':
      a = a || fresh();
      Object.assign(a, { status: 'waiting', task: ev.tool_name ? `allow ${summarize(ev)}?` : 'needs your permission' });
      break;
    case 'Notification':
      // A permission prompt from inside a subagent raises the subagent's hand, not the session's.
      // Other notifications are ignored here too, as they are for sessions.
      if (!needsUser(ev)) return feed;
      a = a || fresh();
      Object.assign(a, { status: 'waiting', task: ev.message ? String(ev.message).slice(0, 80) : 'needs your permission' });
      break;
    default:
      return null; // not a subagent-specific event: let the session character handle it
  }
  a.updated = now;
  if (!agents.includes(a)) agents.push(a);
  return { ...feed, agents };
}

function apply(feed, ev, runtime = 'claude') {
  ev = normalize(ev, runtime);
  const role = RUNTIMES[runtimeOf(runtime)].label;
  const id = ev.session_id || 'unknown';
  const now = Date.now();
  const agents = feed.agents.filter((a) => now - (a.updated || 0) < STALE_MS);

  if (ev.agent_id) {
    const out = applySubagent(feed, agents, ev, now);
    if (out) return out;
  }

  let a = agents.find((x) => x.id === id);
  const name = path.basename(ev.cwd || '') || runtimeOf(runtime);

  switch (ev.hook_event_name) {
    case 'SessionEnd':
      // The session leaves the office together with any subagents still at their desks.
      return { ...feed, agents: agents.filter((x) => x.id !== id && x.parent !== id) };
    case 'SessionStart':
      a = a || { id, since: now };
      Object.assign(a, { name, role, status: 'idle', task: null, error: null });
      break;
    case 'UserPromptSubmit':
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'running', task: summarizePrompt(ev.prompt), error: null });
      break;
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PreCompact':
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'running', task: ev.hook_event_name === 'PreCompact' ? 'compacting context' : summarize(ev), error: null });
      break;
    case 'PermissionRequest':
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'waiting', task: ev.tool_name ? `allow ${summarize(ev)}?` : 'needs your permission' });
      break;
    case 'Notification':
      // Only notifications that ask the user for something raise a hand.
      // idle_prompt (~60 s after a turn), auth_success, agent_completed, quota_* etc. are ignored.
      if (!needsUser(ev)) return feed;
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'waiting', task: ev.message ? String(ev.message).slice(0, 80) : 'needs your input' });
      break;
    case 'StopFailure':
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'error', error: String(ev.error || ev.message || 'turn failed').slice(0, 120) });
      break;
    case 'Stop':
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'idle', task: null });
      break;
    default:
      return feed; // SubagentStart/SubagentStop without an agent_id etc.: nothing to draw
  }
  a.updated = now;
  if (!agents.includes(a)) agents.push(a);
  return { ...feed, agents };
}

const ASKS_USER = new Set(['permission_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog', 'ToolPermission']);
function needsUser(ev) {
  if (ev.notification_type) return ASKS_USER.has(ev.notification_type);
  // Older Claude Code versions send no type; fall back to the message text.
  const m = String(ev.message || '');
  return /permission|needs your|approve/i.test(m) && !/waiting for your input/i.test(m);
}

function summarizePrompt(p) {
  p = String(p || '').replace(/\s+/g, ' ').trim();
  return p ? (p.length > 60 ? p.slice(0, 59) + '…' : p) : 'thinking';
}

// Several Claude Code sessions (and subagents) fire hooks at the same time. Each run reads,
// changes and rewrites the file, so without a lock one run can overwrite another's update.
// The lock is a file created with O_EXCL; waiting is capped so Claude is never held up, and
// a lock left behind by a crashed run is taken over after STALE_LOCK_MS.
const LOCK_WAIT_MS = 1000;
const STALE_LOCK_MS = 2000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(file, fn) {
  const LOCK = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(LOCK, 'wx'); break; } catch (e) { if (e.code !== 'EEXIST') break; }
    try { if (Date.now() - fs.statSync(LOCK).mtimeMs > STALE_LOCK_MS) { fs.unlinkSync(LOCK); continue; } } catch (_) {}
    if (Date.now() > deadline) break;   // give up waiting, write anyway rather than block Claude
    pause(5 + Math.random() * 10);
  }
  try { return fn(); } finally {
    if (fd !== null) { try { fs.closeSync(fd); fs.unlinkSync(LOCK); } catch (_) {} }
  }
}

function main(runtimeName = process.argv[2]) {
  const runtime = runtimeOf(runtimeName);
  const { file, label, reply } = RUNTIMES[runtime];
  const FEED = path.join(DIR, file);
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    // Codex and Gemini read JSON from stdout; an empty object changes nothing.
    if (reply) process.stdout.write(reply + '\n');
    let ev;
    try { ev = JSON.parse(input || '{}'); } catch (_) { return; }
    // A visualisation must never get in Claude's way: swallow every error, exit 0.
    try {
      fs.mkdirSync(DIR, { recursive: true });
      withLock(FEED, () => {
        let feed = { company: label, agents: [] };
        try { const cur = JSON.parse(fs.readFileSync(FEED, 'utf8')); if (Array.isArray(cur.agents)) feed = cur; } catch (_) {}
        feed = apply(feed, ev, runtime);
        const tmp = `${FEED}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(feed));
        fs.renameSync(tmp, FEED); // atomic on the same filesystem: readers never see half a file
      });
    } catch (_) {}
  });
}

// ---------- install / uninstall into the CLI's settings ----------
const EVENTS = RUNTIMES.claude.events;
const isOurs = (h) => /cubicle-hook\.js|cubicle"? hook\b/.test(String(h && h.command));

function install({ uninstall = false, runtime: runtimeName = 'claude', settingsFile } = {}) {
  const runtime = runtimeOf(runtimeName);
  const rt = RUNTIMES[runtime];
  settingsFile = settingsFile || rt.settings;
  let settings = {};
  let existed = false;
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); existed = true; }
  catch (e) { if (e.code !== 'ENOENT') throw new Error(`cannot parse ${settingsFile}: ${e.message}`); }

  const hooks = settings.hooks || {};
  // Drop any earlier Cubicle entries so the result is the same however often this runs.
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = (hooks[ev] || [])
      .map((grp) => ({ ...grp, hooks: (grp.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((grp) => grp.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  if (!uninstall) {
    const command = `node "${path.resolve(__filename)}"${runtime === 'claude' ? '' : ` ${runtime}`}`;
    for (const ev of rt.events) {
      const h = { type: 'command', command, timeout: rt.timeout(ev) };
      if (runtime === 'gemini') h.name = 'cubicle';
      (hooks[ev] = hooks[ev] || []).push(runtime === 'gemini' ? { matcher: '*', hooks: [h] } : { hooks: [h] });
    }
  }
  if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;

  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  if (existed) {
    const backup = `${settingsFile}.bak-cubicle-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(settingsFile, backup);
    console.log(`Backed up ${settingsFile} to ${backup}`);
  }
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  console.log(uninstall
    ? `Removed Cubicle hooks from ${settingsFile}.`
    : `Added Cubicle hooks for ${rt.events.length} events to ${settingsFile}.\nStart the office with: cubicle --source ${runtime === 'claude' ? 'claude-code' : runtime}  (then open http://127.0.0.1:3200)\nRunning ${rt.label} sessions pick the hooks up after a restart.`);
}

if (require.main === module) main();
module.exports = { apply, summarize, main, install, EVENTS, RUNTIMES };
