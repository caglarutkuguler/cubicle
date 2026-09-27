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

function apply(feed, ev) {
  const id = ev.session_id || 'unknown';
  const now = Date.now();
  const agents = feed.agents.filter((a) => now - (a.updated || 0) < STALE_MS);
  let a = agents.find((x) => x.id === id);
  const name = path.basename(ev.cwd || '') || 'claude';

  switch (ev.hook_event_name) {
    case 'SessionEnd':
      return { ...feed, agents: agents.filter((x) => x.id !== id) };
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
      return feed; // SubagentStop etc.: nothing to draw
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

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    let ev;
    try { ev = JSON.parse(input || '{}'); } catch (_) { return; }
    // A visualisation must never get in Claude's way: swallow every error, exit 0.
    try {
      let feed = { company: 'Claude Code', agents: [] };
      try { const cur = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (Array.isArray(cur.agents)) feed = cur; } catch (_) {}
      feed = apply(feed, ev);
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(feed));
      fs.renameSync(tmp, FILE); // atomic on the same filesystem
    } catch (_) {}
  });
}

// ---------- install / uninstall into Claude Code settings ----------
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
  'Notification', 'PreCompact', 'Stop', 'StopFailure', 'SessionEnd'];
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
