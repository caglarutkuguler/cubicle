'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyRecord, createReader, createMonitor, visible } = require('../examples/codex-sessions/monitor.js');
function test() {
  const now = Date.now();
  const record = (type, payload) => JSON.stringify({ type, timestamp: new Date(now).toISOString(), payload }) + '\n';
  for (const [source, originator, role] of [['cli', 'codex_cli_rs', 'Codex CLI'], ['exec', 'Codex Desktop', 'Codex CLI'], ['vscode', 'Codex Desktop', 'Codex Desktop'], ['other', 'other', 'Codex']]) {
    assert.equal(applyRecord({}, { type: 'session_meta', payload: { id: 'id', source, originator } }).role, role);
  }
  let a = { id: 'a', status: 'error', error: 'old', updated: now };
  applyRecord(a, { type: 'event_msg', payload: { type: 'task_started' } }); assert.equal(a.error, null);
  applyRecord(a, { type: 'response_item', payload: { type: 'function_call', name: 'functions.request_user_input' } }); assert.equal(a.status, 'waiting');
  applyRecord(a, { type: 'event_msg', payload: { type: 'turn_aborted' } }); assert.equal(a.status, 'idle');
  assert.equal(visible({ ...a, status: 'running' }, now + 1001, 1000, 2000).status, 'idle');
  assert.equal(visible(a, now + 2001, 1000, 2000), null);
  assert.equal(visible({ ...a, status: 'running' }, now + 999999, 0, 0).status, 'running');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-codex-'));
  try {
    const old = path.join(dir, 'sessions', '2020', '01', '01'); fs.mkdirSync(old, { recursive: true });
    const file = path.join(old, 'session.jsonl');
    const head = record('session_meta', { id: 'large', cwd: '/tmp/çalışma', source: 'exec', originator: 'Codex Desktop', instructions: 'PRIVATE'.repeat(20000) });
    const padding = record('ignored', { data: 'x'.repeat(10000) }).repeat(120);
    fs.writeFileSync(file, head + padding + record('event_msg', { type: 'task_started' }));
    const reader = createReader(); a = reader.read(file);
    assert.equal(a.id, 'codex:large'); assert.equal(a.role, 'Codex CLI'); assert.equal(a.status, 'running');
    const event = Buffer.from(record('response_item', { type: 'function_call', name: 'araç' }));
    const split = event.indexOf(Buffer.from('ç')) + 1;
    fs.appendFileSync(file, event.subarray(0, split)); assert.equal(reader.read(file).task, 'Working');
    fs.appendFileSync(file, event.subarray(split)); assert.equal(reader.read(file).task, 'araç');
    fs.appendFileSync(file, '{broken}\n' + record('response_item', { type: 'message', role: 'assistant', phase: 'final' }));
    assert.equal(reader.read(file).status, 'idle');
    const output = path.join(dir, 'output.json');
    const monitor = createMonitor({ codexHome: dir, output });
    assert.equal(monitor.tick(now).agents[0].id, 'codex:large', 'resumed file in an old date directory');
    assert.ok(!fs.readFileSync(output, 'utf8').includes('PRIVATE'));
    fs.writeFileSync(file, record('session_meta', { id: 'short', source: 'cli' }) + record('event_msg', { type: 'task_started' }));
    assert.equal(reader.read(file).id, 'codex:short');
    const replacement = file + '.tmp'; fs.writeFileSync(replacement, record('session_meta', { id: 'replacement', source: 'cli' })); fs.renameSync(replacement, file);
    assert.equal(reader.read(file).id, 'codex:replacement');
    assert.throws(() => createMonitor({ codexHome: dir, output: path.join(old, 'output.json') }));
    fs.unlinkSync(file); assert.equal(monitor.tick(now + 1).agents.length, 0);
    const partial = path.join(old, 'partial.jsonl'); const h = record('session_meta', { id: 'partial' });
    fs.writeFileSync(partial, h.slice(0, 15)); assert.equal(reader.read(partial).id, undefined);
    fs.appendFileSync(partial, h.slice(15)); assert.equal(reader.read(partial).id, 'codex:partial');
    if (process.platform !== 'win32') assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (require.main === module) { test(); console.log('Codex session example checks passed.'); }
module.exports = test;
