#!/usr/bin/env node
// Read local Codex JSONL sessions; export only identity, tool name and status.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const MiB = 1024 * 1024;
const MAX_RECORD = 8 * MiB;

function applyRecord(agent, record) {
  const p = record.payload || {};
  const time = Date.parse(record.timestamp) || agent.updated || Date.now();
  if (record.type === 'session_meta' && typeof p.id === 'string') {
    const cli = ['cli', 'exec'].includes(p.source) || /codex[_-](cli|exec)/i.test(p.originator || '');
    const desktop = p.originator === 'Codex Desktop' && !cli;
    const role = cli ? 'Codex CLI' : desktop ? 'Codex Desktop' : 'Codex';
    Object.assign(agent, { id: 'codex:' + p.id, role, name: role + ' · ' + path.basename(p.cwd || 'session'), since: time });
  }
  const set = (status, task = null, error = null) => Object.assign(agent, { status, task, error, updated: time });
  if (record.type === 'event_msg') {
    if (p.type === 'task_started') set('running', 'Working');
    if (['task_complete', 'task_completed', 'turn_aborted'].includes(p.type)) set('idle');
    if (p.type === 'error') set('error', null, 'Session error; see Codex for details.');
  }
  if (record.type === 'response_item') {
    if (['reasoning', 'function_call', 'custom_tool_call'].includes(p.type)) {
      const name = typeof p.name === 'string' ? p.name.slice(0, 100) : '';
      set(/request_user_input/.test(name) ? 'waiting' : 'running', name || 'Thinking');
    }
    if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) set('running', 'Working');
    if (p.type === 'message' && p.role === 'assistant' && ['final', 'final_answer'].includes(p.phase)) set('idle');
  }
  return agent;
}

function metadata(file, agent) {
  const fd = fs.openSync(file, 'r');
  const chunks = []; let size = 0;
  try {
    while (size < MAX_RECORD) {
      const buffer = Buffer.alloc(Math.min(65536, MAX_RECORD - size));
      const n = fs.readSync(fd, buffer, 0, buffer.length, size);
      if (!n) break;
      const newline = buffer.subarray(0, n).indexOf(10);
      chunks.push(buffer.subarray(0, newline < 0 ? n : newline)); size += n;
      if (newline >= 0) {
        try { applyRecord(agent, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) {}
        return;
      }
    }
  } finally { fs.closeSync(fd); }
}

function createReader() {
  const cache = new Map();
  function read(file) {
    const stat = fs.statSync(file);
    let e = cache.get(file);
    if (!e || stat.size < e.offset || e.ino !== stat.ino) {
      const offset = Math.max(0, stat.size - MiB);
      e = { ino: stat.ino, offset, carry: '', skip: offset > 0, decoder: new StringDecoder('utf8'),
        agent: { status: 'idle', updated: stat.mtimeMs } };
      cache.set(file, e);
    }
    if (!e.agent.id) metadata(file, e.agent);
    const fd = fs.openSync(file, 'r');
    // Bound work per poll; subsequent polls catch up if a file grows quickly.
    const end = Math.min(stat.size, e.offset + 4 * MiB);
    try {
      while (e.offset < end) {
        const buffer = Buffer.alloc(Math.min(65536, end - e.offset));
        const n = fs.readSync(fd, buffer, 0, buffer.length, e.offset);
        if (!n) break;
        e.offset += n;
        const parts = e.decoder.write(buffer.subarray(0, n)).split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (!e.skip) {
            e.carry += parts[i];
            if (e.carry.length > MAX_RECORD) { e.skip = true; e.carry = ''; }
          }
          if (i < parts.length - 1) {
            if (!e.skip) { try { applyRecord(e.agent, JSON.parse(e.carry)); } catch (_) {} }
            e.carry = ''; e.skip = false;
          }
        }
      }
    } finally { fs.closeSync(fd); }
    return e.agent;
  }
  return { read, retain(files) { for (const file of cache.keys()) if (!files.has(file)) cache.delete(file); } };
}

function visible(agent, now, idleMs, expireMs) {
  if (!agent.id || (expireMs && now - agent.updated > expireMs)) return null;
  const copy = { ...agent };
  if (copy.status === 'running' && idleMs && now - copy.updated > idleMs) {
    copy.status = 'idle'; copy.task = 'No recent events (inferred idle)';
  }
  return copy;
}

function createMonitor({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  output = path.join(os.homedir(), '.cubicle', 'codex-sessions.json'),
  idleMs = 10 * 60 * 1000, expireMs = 2 * 60 * 60 * 1000, maxSessions = 40 } = {}) {
  const root = path.resolve(codexHome, 'sessions'); output = path.resolve(output);
  if (output === root || output.startsWith(root + path.sep)) throw new Error('Output must be outside the session directory.');
  const reader = createReader(); let known = []; let scanned = -Infinity; let last = '';
  function tick(now = Date.now()) {
    if (now - scanned >= 30000) {
      known = [];
      const walk = (dir) => {
        try { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const file = path.join(dir, item.name);
          if (item.isDirectory()) walk(file);
          else if (item.isFile() && item.name.endsWith('.jsonl')) known.push(file);
        } } catch (_) {}
      };
      walk(root); scanned = now;
    }
    const files = known.flatMap((file) => {
      try { const stat = fs.statSync(file); return !expireMs || now - stat.mtimeMs < expireMs ? [[file, stat.mtimeMs]] : []; } catch (_) { return []; }
    }).sort((a, b) => b[1] - a[1]).slice(0, maxSessions).map(([file]) => file);
    reader.retain(new Set(files));
    const byId = new Map();
    for (const file of files) {
      try { const agent = visible(reader.read(file), now, idleMs, expireMs); if (agent && !byId.has(agent.id)) byId.set(agent.id, agent); } catch (_) {}
    }
    const feed = { company: 'Codex sessions', agents: [...byId.values()].sort((a, b) => a.since - b.since) };
    const json = JSON.stringify(feed);
    if (json !== last) {
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      const tmp = `${output}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, json, { mode: 0o600 }); fs.renameSync(tmp, output); last = json;
    }
    return feed;
  }
  return { tick };
}

function main(args) {
  const options = {}; let once = false; let poll = 3000;
  while (args.length) {
    const key = args.shift();
    if (key === '--once') { once = true; continue; }
    if (key === '--help') { console.log('Usage: node examples/codex-sessions/monitor.js [--once] [--codex-home DIR] [--output FILE] [--poll-ms 3000] [--idle-ms 600000] [--expire-ms 7200000] [--max-sessions 40]'); return; }
    const names = { '--codex-home': 'codexHome', '--output': 'output', '--idle-ms': 'idleMs', '--expire-ms': 'expireMs', '--max-sessions': 'maxSessions', '--poll-ms': 'poll' };
    if (!names[key] || !args.length) throw new Error('Unknown option or missing value: ' + key);
    const value = args.shift();
    if (['--codex-home', '--output'].includes(key)) options[names[key]] = value;
    else {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < (key === '--poll-ms' ? 100 : key === '--max-sessions' ? 1 : 0)) throw new Error('Invalid value for ' + key);
      if (key === '--poll-ms') poll = n; else options[names[key]] = n;
    }
  }
  const monitor = createMonitor(options); monitor.tick();
  if (!once) setInterval(() => { try { monitor.tick(); } catch (e) { console.error(e.message); } }, poll);
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { applyRecord, createReader, createMonitor, visible };
