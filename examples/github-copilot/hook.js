#!/usr/bin/env node
// Passive GitHub Copilot CLI hook: local status feed, no decisions or model calls.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EVENTS = ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse',
  'postToolUseFailure', 'notification', 'preCompact', 'agentStop', 'errorOccurred', 'sessionEnd'];
const STALE_MS = 12 * 60 * 60 * 1000;
const MAX_INPUT = 2 * 1024 * 1024;
const quoteSh = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
const quotePs = (s) => "'" + s.replace(/'/g, "''") + "'";

function config() {
  // camelCase payloads do not include the event name: pass it explicitly.
  return { version: 1, hooks: Object.fromEntries(EVENTS.map((event) => [event, [{
    type: 'command',
    bash: [process.execPath, __filename, event].map(quoteSh).join(' '),
    powershell: '& ' + [process.execPath, __filename, event].map(quotePs).join(' '),
    timeoutSec: 3,
  }]])) };
}

function apply(feed, event, input, now = Date.now(), sessionOverride) {
  if (!EVENTS.includes(event) || !input || typeof input !== 'object' || Array.isArray(input)) return feed;
  const id = sessionOverride || input.sessionId || input.session_id;
  // Older CLIs omit ids on most events. Require an explicit per-process id;
  // using cwd would merge two independent sessions working in the same repo.
  if (typeof id !== 'string' || !id) return feed;
  // Child lifecycle events cannot reliably be paired by id across CLI versions.
  if (input.agentId || input.agent_id || input.agentName || input.agent_name) return feed;
  const type = input.notification_type;
  if (event === 'notification' && !['permission_prompt', 'elicitation_dialog'].includes(type)) return feed;
  const timestamp = typeof input.timestamp === 'number' ? input.timestamp : Date.parse(input.timestamp);
  const at = Number.isFinite(timestamp) ? timestamp : now;
  let closed = (feed.closed || []).filter((c) => now - c.at < STALE_MS);
  const previous = closed.find((c) => c.id === id);
  if (previous) {
    if (!['sessionStart', 'userPromptSubmitted'].includes(event) || at <= previous.at) return feed;
    closed = closed.filter((c) => c.id !== id);
  }
  const agents = (feed.agents || []).filter((a) => now - a.updated < STALE_MS).map((a) => ({ ...a }));
  let agent = agents.find((a) => a.id === id);
  // Notifications can arrive after the tool or turn already finished.
  if (agent && at < agent.eventAt) return feed;
  if (event === 'sessionEnd') return { company: 'GitHub Copilot',
    agents: agents.filter((a) => a.id !== id), closed: [...closed, { id, at }].slice(-128) };
  if (!agent) {
    const cwd = typeof input.cwd === 'string' ? input.cwd : '';
    agent = { id, name: path.basename(cwd) || 'Copilot', role: 'GitHub Copilot',
      status: 'idle', task: null, error: null, since: now };
    agents.push(agent);
  }
  const tool = typeof (input.toolName || input.tool_name) === 'string'
    ? (input.toolName || input.tool_name).slice(0, 80) : '';
  const result = input.toolResult || input.tool_result || {};
  const failed = event === 'errorOccurred' || event === 'postToolUseFailure'
    || (event === 'postToolUse' && ['failure', 'denied'].includes(result.resultType || result.result_type));
  if (failed) {
    Object.assign(agent, { status: 'error', task: tool || null, error: 'See Copilot for details.' });
  } else if (event === 'notification' || (event === 'preToolUse' && tool === 'ask_user')) {
    Object.assign(agent, { status: 'waiting', task: 'Needs your input', error: null });
  } else if (event === 'agentStop') {
    // A failed turn followed by a stop is still an error, not a success.
    if (agent.status !== 'error') Object.assign(agent, { status: 'idle', task: null, error: null });
  } else if (event !== 'sessionStart') {
    Object.assign(agent, { status: 'running', task: tool || 'Working', error: null });
  }
  // A late startup event must not settle an already active session.
  agent.updated = now;
  agent.eventAt = at;
  return { company: 'GitHub Copilot', agents, closed };
}

function save(event, input, file, sessionOverride) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = file + '.lock';
  const deadline = Date.now() + 1000;
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, 'wx', 0o600); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock); } catch (_) {}
      if (Date.now() >= deadline) return; // drop the event instead of writing without a lock
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    let feed = { company: 'GitHub Copilot', agents: [] };
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(value.agents)) feed = value; } catch (_) {}
    const next = apply(feed, event, input, Date.now(), sessionOverride);
    if (next === feed) return;
    fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function main() {
  const event = process.argv[2];
  if (event === '--config') { console.log(JSON.stringify(config(), null, 2)); return; }
  let input = ''; let oversized = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('error', () => {});
  process.stdin.on('data', (chunk) => {
    if (input.length + chunk.length > MAX_INPUT) { oversized = true; input = ''; }
    if (!oversized) input += chunk;
  });
  process.stdin.on('end', () => {
    try {
      if (!oversized) save(event, JSON.parse(input),
        process.env.CUBICLE_COPILOT_FEED || path.join(os.homedir(), '.cubicle', 'github-copilot.json'),
        process.env.CUBICLE_COPILOT_SESSION);
    } catch (_) {} // Empty stdout/stderr and exit 0: never approve, deny or modify a call.
  });
}
if (require.main === module) main();
module.exports = { apply, save, config };
