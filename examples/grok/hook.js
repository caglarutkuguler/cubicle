#!/usr/bin/env node
// Passive Grok hook: local feed only, no prompt/tool arguments or decisions.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'Notification', 'PreCompact', 'Stop', 'StopFailure', 'StopCancelled', 'SessionEnd'];
const STALE_MS = 12 * 60 * 60 * 1000;
const MAX_INPUT = 2 * 1024 * 1024;
const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

function config() {
  const command = `${quote(process.execPath)} ${quote(__filename)}`;
  return { hooks: Object.fromEntries(EVENTS.map((event) => [event,
    [{ hooks: [{ type: 'command', command, timeout: 3 }] }]])) };
}

function apply(feed, input, now = Date.now()) {
  if (!input || typeof input !== 'object') return feed;
  const id = input.sessionId || input.session_id;
  // Grok's child events can share the host session id. Do not settle the host.
  if (typeof id !== 'string' || !id || input.subagentType || input.subagent_type) return feed;
  const raw = input.hook_event_name || input.hookEventName;
  const event = EVENTS.find((e) => e === raw || e.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() === raw);
  if (!event) return feed;
  let closed = (feed.closed || []).filter((c) => now - c.at < STALE_MS);
  if (['SessionStart', 'UserPromptSubmit'].includes(event)) closed = closed.filter((c) => c.id !== id);
  else if (closed.some((c) => c.id === id)) return feed;
  const agents = (feed.agents || []).filter((a) => now - a.updated < STALE_MS).map((a) => ({ ...a }));
  if (event === 'SessionEnd') return { company: 'Grok', agents: agents.filter((a) => a.id !== id),
    closed: [...closed, { id, at: now }].slice(-128) };
  let a = agents.find((agent) => agent.id === id);
  const prompt = input.promptId || input.prompt_id;
  const type = input.notificationType || input.notification_type;
  const terminal = ['Stop', 'StopFailure', 'StopCancelled'].includes(event);
  // Reports are queued by Grok: a cancelled turn may report after a new prompt.
  // Remember a bounded set of prior turn ids; a never-started bash turn can still settle.
  if (terminal && prompt && a && a.turns?.includes(prompt) && prompt !== a.promptId) return feed;
  if (event === 'Notification' && !['permission_prompt', 'agent_needs_input',
    'elicitation_dialog', 'elicitation_url_dialog', 'idle_prompt'].includes(type)) return feed;
  if (!a) {
    const cwd = input.cwd || input.workspaceRoot || input.workspace_root;
    a = { id, name: typeof cwd === 'string' ? path.basename(cwd) || 'Grok' : 'Grok',
      role: 'Grok', since: now, status: 'idle' };
    agents.push(a);
  }
  // SessionStart and the initial prompt may be dispatched concurrently.
  if (event === 'SessionStart') { if (!a.updated) Object.assign(a, { status: 'idle', task: null, error: null }); }
  else if (event === 'Notification') {
    if (type === 'idle_prompt') {
      // The backstop also follows failed turns; retain their error until a new run.
      if (a.status !== 'error') Object.assign(a, { status: 'idle', task: null });
    } else Object.assign(a, { status: 'waiting', task: 'Needs your input' });
  } else if (terminal) {
    Object.assign(a, { status: event === 'StopFailure' ? 'error' : 'idle', task: null,
      error: event === 'StopFailure' ? 'Turn failed; see Grok for details.' : null });
  } else {
    const tool = input.toolName || input.tool_name;
    Object.assign(a, { status: 'running', task: typeof tool === 'string' ? tool.slice(0, 80) : 'Working', error: null });
    if (prompt && typeof prompt === 'string') {
      a.promptId = prompt;
      a.turns = [...new Set([...(a.turns || []), prompt])].slice(-64);
    }
  }
  a.updated = now;
  return { company: 'Grok', agents, closed };
}

function save(input, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = file + '.lock';
  let fd;
  const deadline = Date.now() + 1000;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, 'wx', 0o600); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock); } catch (_) {}
      if (Date.now() >= deadline) return; // drop an update rather than block Grok or lose another writer's update
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    let feed = { company: 'Grok', agents: [] };
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(value.agents)) feed = value; } catch (_) {}
    const next = apply(feed, input);
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
  if (process.argv[2] === '--config') { console.log(JSON.stringify(config(), null, 2)); return; }
  let input = ''; let oversized = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (input.length + chunk.length > MAX_INPUT) { oversized = true; input = ''; }
    if (!oversized) input += chunk;
  });
  process.stdin.on('end', () => {
    try {
      if (!oversized) save(JSON.parse(input), process.env.CUBICLE_GROK_FEED || path.join(os.homedir(), '.cubicle', 'grok.json'));
    } catch (_) {} // No stdout, stderr or failure exit: the observer must not influence a tool or turn.
  });
}
if (require.main === module) main();
module.exports = { apply, save, config };
