#!/usr/bin/env node
// Cubicle hook for Claude Code.
// Claude Code runs this on hook events and pipes the event JSON to stdin.
// It keeps ~/.cubicle/claude-code.json up to date, one agent per session,
// in the Cubicle feed format (docs/FEED.md). No dependencies, no network.
//
// Wire it up with the snippet in examples/claude-code/settings.json, then run:
//   cubicle --source claude-code
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.cubicle');
const FILE = path.join(DIR, 'claude-code.json');
const STALE_MS = 12 * 60 * 60 * 1000; // drop sessions with no event for 12 h

function summarize(ev) {
  const tool = ev.tool_name || '';
  const inp = ev.tool_input || {};
  const short = (s, n = 48) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  if (inp.file_path) return `${tool} ${path.basename(inp.file_path)}`;
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
  const fresh = () => ({ id, since: now, parent: sid, name: `${base} › ${ev.agent_type || 'subagent'}`, role: 'Claude Code subagent' });

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
    default:
      return null; // not a subagent-specific event: let the session character handle it
  }
  a.updated = now;
  if (!agents.includes(a)) agents.push(a);
  return { ...feed, agents };
}

function apply(feed, ev) {
  const id = ev.session_id || 'unknown';
  const now = Date.now();
  const agents = feed.agents.filter((a) => now - (a.updated || 0) < STALE_MS);

  if (ev.agent_id) {
    const out = applySubagent(feed, agents, ev, now);
    if (out) return out;
  }

  let a = agents.find((x) => x.id === id);
  const name = path.basename(ev.cwd || '') || 'claude';

  switch (ev.hook_event_name) {
    case 'SessionEnd':
      // The session leaves the office together with any subagents still at their desks.
      return { ...feed, agents: agents.filter((x) => x.id !== id && x.parent !== id) };
    case 'SessionStart':
      a = a || { id, since: now };
      Object.assign(a, { name, role: 'Claude Code', status: 'idle', task: null, error: null });
      break;
    case 'UserPromptSubmit':
      a = a || { id, since: now, name, role: 'Claude Code' };
      Object.assign(a, { status: 'running', task: summarizePrompt(ev.prompt), error: null });
      break;
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PreCompact':
      a = a || { id, since: now, name, role: 'Claude Code' };
      Object.assign(a, { status: 'running', task: ev.hook_event_name === 'PreCompact' ? 'compacting context' : summarize(ev), error: null });
      break;
    case 'PermissionRequest':
      a = a || { id, since: now, name, role: 'Claude Code' };
      Object.assign(a, { status: 'waiting', task: ev.tool_name ? `allow ${summarize(ev)}?` : 'needs your permission' });
      break;
    case 'Notification':
      // Only notifications that ask the user for something raise a hand.
      // idle_prompt (~60 s after a turn), auth_success, agent_completed, quota_* etc. are ignored.
      if (!needsUser(ev)) return feed;
      a = a || { id, since: now, name, role: 'Claude Code' };
      Object.assign(a, { status: 'waiting', task: ev.message ? String(ev.message).slice(0, 80) : 'needs your input' });
      break;
    case 'StopFailure':
      a = a || { id, since: now, name, role: 'Claude Code' };
      Object.assign(a, { status: 'error', error: String(ev.error || ev.message || 'turn failed').slice(0, 120) });
      break;
    case 'Stop':
      a = a || { id, since: now, name, role: 'Claude Code' };
      Object.assign(a, { status: 'idle', task: null });
      break;
    default:
      return feed; // SubagentStart/SubagentStop without an agent_id etc.: nothing to draw
  }
  a.updated = now;
  if (!agents.includes(a)) agents.push(a);
  return { ...feed, agents };
}

const ASKS_USER = new Set(['permission_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog']);
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
const LOCK = `${FILE}.lock`;
const LOCK_WAIT_MS = 1000;
const STALE_LOCK_MS = 2000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(fn) {
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

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    let ev;
    try { ev = JSON.parse(input || '{}'); } catch (_) { return; }
    // A visualisation must never get in Claude's way: swallow every error, exit 0.
    try {
      fs.mkdirSync(DIR, { recursive: true });
      withLock(() => {
        let feed = { company: 'Claude Code', agents: [] };
        try { const cur = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (Array.isArray(cur.agents)) feed = cur; } catch (_) {}
        feed = apply(feed, ev);
        const tmp = `${FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(feed));
        fs.renameSync(tmp, FILE); // atomic on the same filesystem: readers never see half a file
      });
    } catch (_) {}
  });
}

// ---------- install / uninstall into Claude Code settings ----------
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
  'Notification', 'PreCompact', 'Stop', 'StopFailure', 'SessionEnd', 'SubagentStart', 'SubagentStop'];
const isOurs = (h) => /cubicle-hook\.js|cubicle"? hook\b/.test(String(h && h.command));

function install({ uninstall = false, settingsFile = path.join(os.homedir(), '.claude', 'settings.json') } = {}) {
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
    const command = `node "${path.resolve(__filename)}"`;
    for (const ev of EVENTS) (hooks[ev] = hooks[ev] || []).push({ hooks: [{ type: 'command', command, timeout: 5 }] });
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
    : `Added Cubicle hooks for ${EVENTS.length} events to ${settingsFile}.\nStart the office with: cubicle --source claude-code  (then open http://127.0.0.1:3200)\nRunning Claude Code sessions pick the hooks up after a restart.`);
}

if (require.main === module) main();
module.exports = { apply, summarize, main, install, EVENTS };
