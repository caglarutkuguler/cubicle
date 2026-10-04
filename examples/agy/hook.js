#!/usr/bin/env node
// Passive Antigravity hook. Never makes permission or continuation decisions.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EVENTS = ['PreInvocation', 'PostInvocation', 'PostToolUse', 'Stop'];
const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
function config() {
  const events = {};
  for (const event of EVENTS) {
    const h = { type: 'command', command: `${quote(process.execPath)} ${quote(__filename)} ${event}`, timeout: 3 };
    events[event] = event === 'PostToolUse' ? [{ matcher: '*', hooks: [h] }] : [h];
  }
  return { 'cubicle-feed': events };
}
function roleOf(input) {
  // Product-specific paths are documented in Antigravity's shared hook contract.
  // Inspect path segments only; never read or export the referenced files.
  const roles = new Set();
  for (const value of [input.transcriptPath, input.artifactDirectoryPath]) {
    if (typeof value !== 'string') continue;
    const parts = value.replace(/\\/g, '/').split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] !== '.gemini') continue;
      const role = { 'antigravity-cli': 'Agy CLI', antigravity: 'Antigravity Desktop', 'antigravity-ide': 'Antigravity IDE' }[parts[i + 1]];
      if (typeof role === 'string') roles.add(role);
    }
  }
  return roles.size === 1 ? [...roles][0] : 'Antigravity';
}
function apply(feed, input, event, now = Date.now()) {
  if (!input || typeof input.conversationId !== 'string' || !input.conversationId || !EVENTS.includes(event)) return feed;
  const agents = (feed.agents || []).filter((a) => now - a.updated < 12 * 60 * 60 * 1000).map((a) => ({ ...a }));
  let a = agents.find((item) => item.id === input.conversationId);
  if (!a) {
    const cwd = input.workspacePaths?.[0];
    a = { id: input.conversationId, name: typeof cwd === 'string' ? path.basename(cwd) || 'Antigravity' : 'Antigravity', role: roleOf(input), since: now };
    agents.push(a);
  }
  const role = roleOf(input);
  // Refresh old Agy-labelled feeds when a later event identifies the surface.
  if (role !== 'Antigravity' || !a.role || a.role === 'Agy') a.role = role;
  let status = 'running'; let task = event === 'PostToolUse' ? 'Tool completed' : 'Working'; let error = null;
  if (event === 'Stop') {
    if (input.error || input.terminationReason === 'error') {
      status = 'error'; task = null; error = 'Execution failed; see Antigravity for details.';
    } else if (input.fullyIdle === false) {
      task = 'Background work remains';
    } else { status = 'idle'; task = null; }
  }
  Object.assign(a, { status, task, error, updated: now });
  return { company: 'Antigravity', agents };
}

function save(input, event, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = file + '.lock'; let fd;
  const deadline = Date.now() + 1000;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, 'wx', 0o600); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock); } catch (_) {}
      if (Date.now() >= deadline) return;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    let feed = { company: 'Antigravity', agents: [] };
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(value.agents)) feed = value; } catch (_) {}
    const next = apply(feed, input, event);
    if (next === feed) return;
    fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 }); fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
    fs.closeSync(fd); fs.unlinkSync(lock);
  }
}
function main() {
  if (process.argv[2] === '--config') { console.log(JSON.stringify(config(), null, 2)); return; }
  let input = ''; let oversized = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (input.length + chunk.length > 2 * 1024 * 1024) { oversized = true; input = ''; }
    if (!oversized) input += chunk;
  });
  process.stdin.on('end', () => {
    try {
      if (!oversized) save(JSON.parse(input), process.argv[2], process.env.CUBICLE_AGY_FEED || path.join(os.homedir(), '.cubicle', 'agy.json'));
    } catch (_) {} // A failed observer cannot affect the agent loop.
    process.stdout.write('{}\n');
  });
}
if (require.main === module) main();
module.exports = { apply, save, config, roleOf };
