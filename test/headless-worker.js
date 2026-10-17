#!/usr/bin/env node
// Headless worker identity (CUBICLE_NAME / _ROLE / _TASK_ID / _TASK_URL / _TASK / _LINGER): `node test/headless-worker.js`
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { apply, stableScript, isEphemeral } = require('../bin/cubicle-hook.js');

module.exports = async function headlessWorker() {
  const env = { CUBICLE_NAME: 'ncu-pch #42', CUBICLE_ROLE: 'Issue worker', CUBICLE_TASK_ID: '#42',
    CUBICLE_TASK_URL: 'https://github.com/o/r/issues/42', CUBICLE_TASK: 'Add partner export', CUBICLE_LINGER: '1' };
  const run = (f, ev) => apply(f, { session_id: 'w1', cwd: '/home/u/agents/worktrees/ncu-pch-42', ...ev }, 'claude', env);
  const me = (f) => f.agents.find((a) => a.id === 'w1');
  let f = { company: 'Claude Code', agents: [] };

  // name, role and ticket come from the environment, not from the worktree directory
  f = run(f, { hook_event_name: 'SessionStart' });
  assert.strictEqual(me(f).name, 'ncu-pch #42');
  assert.strictEqual(me(f).role, 'Issue worker');
  assert.deepStrictEqual(me(f).task, { id: '#42', title: 'Add partner export', url: 'https://github.com/o/r/issues/42' });

  // the huge prompt is not the bubble: the ticket title is
  f = run(f, { hook_event_name: 'UserPromptSubmit', prompt: 'You are working in an isolated git worktree '.repeat(20) });
  assert.strictEqual(me(f).status, 'running');
  assert.strictEqual(me(f).task.title, 'Add partner export');

  // tools show in the bubble, the card keeps the ticket link
  f = run(f, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/w/a.ts' } });
  assert.deepStrictEqual(me(f).task, { id: '#42', title: 'Edit a.ts', url: 'https://github.com/o/r/issues/42' });

  // permission requests keep the ticket too
  f = run(f, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x' } });
  assert.strictEqual(me(f).status, 'waiting');
  assert.strictEqual(me(f).task.id, '#42');

  // a subagent is named after the worker, not after the directory
  f = run(f, { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'tdd-guide' });
  assert.strictEqual(f.agents.find((a) => a.id === 'w1:a1').name, 'ncu-pch #42 › tdd-guide');

  // Stop -> idle, ticket title remains
  f = run(f, { hook_event_name: 'Stop' });
  assert.strictEqual(me(f).status, 'idle');
  assert.strictEqual(me(f).task.title, 'Add partner export');
  assert.ok(me(f).completedAt);

  // SessionEnd with CUBICLE_LINGER: the worker stays, its subagents leave
  f = run(f, { hook_event_name: 'SessionEnd' });
  assert.ok(me(f), 'worker lingers');
  assert.strictEqual(me(f).status, 'idle');
  assert.ok(!f.agents.find((a) => a.id === 'w1:a1'), 'subagent left');

  // a failed turn stays red after SessionEnd
  f = run(f, { hook_event_name: 'StopFailure', error: 'rate_limit' });
  f = run(f, { hook_event_name: 'SessionEnd' });
  assert.strictEqual(me(f).status, 'error');

  // without LINGER, SessionEnd removes the worker as before
  const plain = { ...env, CUBICLE_LINGER: '' };
  let g = { company: 'Claude Code', agents: [] };
  g = apply(g, { session_id: 'w2', hook_event_name: 'SessionStart' }, 'claude', plain);
  g = apply(g, { session_id: 'w2', hook_event_name: 'SessionEnd' }, 'claude', plain);
  assert.strictEqual(g.agents.length, 0);

  // without any CUBICLE_* variable nothing changes: directory name, string task
  let h = { company: 'Claude Code', agents: [] };
  h = apply(h, { session_id: 'p', cwd: '/x/repo', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/repo/a.md' } });
  assert.strictEqual(h.agents[0].name, 'repo');
  assert.strictEqual(h.agents[0].task, 'Read a.md');
  // install-hooks from npm's throw-away cache points the hooks at a stable copy
  assert.ok(isEphemeral('/home/u/.npm/_npx/ab12/node_modules/@c/cubicle/bin/cubicle-hook.js'));
  assert.ok(isEphemeral('C:\\Users\\u\\AppData\\npm-cache\\_npx\\ab12\\bin\\cubicle-hook.js'));
  assert.ok(!isEphemeral('/home/u/cubicle/bin/cubicle-hook.js'));
  assert.strictEqual(stableScript(__filename.replace('test/headless-worker.js', 'bin/cubicle-hook.js')), path.resolve(__dirname, '../bin/cubicle-hook.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-stable-'));
  const fake = path.join(dir, '_npx', 'ab12', 'bin');
  fs.mkdirSync(fake, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../bin/cubicle-hook.js'), path.join(fake, 'cubicle-hook.js'));
  const copy = stableScript(path.join(fake, 'cubicle-hook.js'), path.join(dir, 'home'));
  assert.strictEqual(copy, path.join(dir, 'home', 'bin', 'cubicle-hook.js'));
  assert.ok(fs.existsSync(copy));
  // a worker the CEO started: its main task, when the turn began, and what it said last (from the transcript)
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-tr-'));
  const transcript = path.join(tdir, 't.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'go' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Opened PR #160; tests pass.' }, { type: 'tool_use', name: 'Bash' }] } }),
    JSON.stringify({ type: 'system', subtype: 'stop' }), ''].join('\n'));
  const wenv = { ...env, CUBICLE_MAIN_TASK_ID: 'T-abc', CUBICLE_MAIN_TASK: 'Make the dashboard resilient' };
  let w = { company: 'Claude Code', agents: [] };
  w = apply(w, { session_id: 'w3', hook_event_name: 'UserPromptSubmit', prompt: 'x' }, 'claude', wenv);
  const started = w.agents[0].turnStart;
  assert.ok(Number.isFinite(started), 'turn start recorded');
  w = apply(w, { session_id: 'w3', hook_event_name: 'Stop', transcript_path: transcript }, 'claude', wenv);
  assert.deepStrictEqual(w.agents[0].main, { id: 'T-abc', title: 'Make the dashboard resilient' });
  assert.strictEqual(w.agents[0].result, 'Opened PR #160; tests pass.');
  // the Stop event's own last message wins; a new turn clears the old result
  w = apply(w, { session_id: 'w3', hook_event_name: 'Stop', last_assistant_message: 'Done.' }, 'claude', wenv);
  assert.strictEqual(w.agents[0].result, 'Done.');
  w = apply(w, { session_id: 'w3', hook_event_name: 'UserPromptSubmit', prompt: 'y' }, 'claude', wenv);
  assert.ok(!('result' in w.agents[0]));
  // the CEO's own task is not its main task
  let c = apply({ company: 'Claude Code', agents: [] }, { session_id: 'c', hook_event_name: 'SessionStart' }, 'claude', { CUBICLE_NAME: 'CEO', CUBICLE_TASK_ID: 'T-abc', CUBICLE_MAIN_TASK_ID: 'T-abc', CUBICLE_MAIN_TASK: 'x' });
  assert.ok(!c.agents[0].main);
  console.log('headless-worker ok');
};

if (require.main === module) module.exports().catch((e) => { console.error(e); process.exit(1); });
