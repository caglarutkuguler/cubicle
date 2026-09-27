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
    case 'Notification':
      a = a || { id, since: now, name, role: 'Claude Code' };
      Object.assign(a, { status: 'waiting', task: ev.message ? String(ev.message).slice(0, 80) : 'needs your input' });
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
    let feed = { company: 'Claude Code', agents: [] };
    try { const cur = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (Array.isArray(cur.agents)) feed = cur; } catch (_) {}
    feed = apply(feed, ev);
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(feed));
    fs.renameSync(tmp, FILE); // atomic on the same filesystem
  });
}

if (require.main === module) main();
module.exports = { apply, summarize, main };
