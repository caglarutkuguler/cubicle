'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { apply, config } = require('../examples/grok/hook.js');
const hook = path.resolve(__dirname, '../examples/grok/hook.js');

async function test() {
  let feed = { company: 'Grok', agents: [] };
  const send = (event, extra = {}) => { feed = apply(feed, { sessionId: 's', cwd: '/work/repo', hook_event_name: event, ...extra }); };
  send('SessionStart'); assert.equal(feed.agents[0].name, 'repo');
  send('UserPromptSubmit', { promptId: 'old', prompt: 'PRIVATE PROMPT' });
  send('PreToolUse', { promptId: 'old', toolName: 'read_file', toolInput: { secret: 'PRIVATE INPUT' } });
  assert.equal(feed.agents[0].task, 'read_file');
  send('Notification', { notificationType: 'permission_prompt' }); assert.equal(feed.agents[0].status, 'waiting');
  send('UserPromptSubmit', { promptId: 'new' });
  send('SessionStart'); assert.equal(feed.agents[0].status, 'running', 'late startup cannot settle the first prompt');
  for (const event of ['Stop', 'StopFailure', 'StopCancelled']) {
    send(event, { promptId: 'old' }); assert.equal(feed.agents[0].status, 'running');
  }
  send('SessionEnd', { subagentType: 'explore' }); assert.equal(feed.agents.length, 1);
  send('StopCancelled', { promptId: 'new' }); assert.equal(feed.agents[0].status, 'idle');
  send('StopFailure', { error: 'PRIVATE ERROR' }); assert.equal(feed.agents[0].status, 'error');
  send('Notification', { notificationType: 'idle_prompt' }); assert.equal(feed.agents[0].status, 'error');
  send('UserPromptSubmit', { promptId: 'third' }); assert.equal(feed.agents[0].error, null);
  send('StopCancelled', { promptId: 'unseen-bash' }); assert.equal(feed.agents[0].status, 'idle');
  send('PreToolUse'); send('Notification', { notificationType: 'idle_prompt' }); assert.equal(feed.agents[0].status, 'idle');
  assert.ok(!JSON.stringify(feed).includes('PRIVATE'));
  send('SessionEnd'); assert.equal(feed.agents.length, 0);
  send('Stop'); assert.equal(feed.agents.length, 0, 'a queued stop cannot resurrect a closed session');
  send('UserPromptSubmit', { promptId: 'resume' }); assert.equal(feed.agents[0].status, 'running');
  send('SessionEnd');
  feed = apply(feed, { session_id: 'sdk', hook_event_name: 'pre_tool_use', tool_name: 'Read' });
  assert.equal(feed.agents[0].id, 'sdk'); assert.equal(feed.agents[0].task, 'Read');
  assert.equal(apply(feed, null), feed);
  assert.equal(apply(feed, { hook_event_name: 'Stop' }), feed);
  for (const groups of Object.values(config().hooks)) assert.equal(groups[0].hooks[0].timeout, 3);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-grok-'));
  const file = path.join(dir, 'feed.json');
  const env = { ...process.env, CUBICLE_GROK_FEED: file };
  try {
    const run = (payload) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [hook], { env });
      let out = ''; let err = '';
      child.stdout.on('data', (x) => { out += x; }); child.stderr.on('data', (x) => { err += x; });
      child.on('error', reject); child.on('close', (code) => {
        try { assert.equal(code, 0); assert.equal(out, ''); assert.equal(err, ''); resolve(); } catch (e) { reject(e); }
      });
      child.stdin.end(JSON.stringify(payload));
    });
    await Promise.all(Array.from({ length: 8 }, (_, i) => run({ sessionId: 's' + i, hook_event_name: 'SessionStart' })));
    assert.equal(JSON.parse(fs.readFileSync(file)).agents.length, 8);
    fs.writeFileSync(file + '.lock', ''); fs.utimesSync(file + '.lock', 0, 0);
    await run({ sessionId: 'stale-lock', hook_event_name: 'SessionStart' });
    assert.equal(JSON.parse(fs.readFileSync(file)).agents.length, 9);
    for (const input of ['{', 'null', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      const result = spawnSync(process.execPath, [hook], { env, input });
      assert.equal(result.status, 0); assert.equal(result.stdout.length, 0); assert.equal(result.stderr.length, 0);
    }
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const legacy = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/cubicle-hook.js')], {
      env: { ...env, HOME: dir, USERPROFILE: dir, GROK_SESSION_ID: 'foreign', GROK_HOOK_EVENT: 'pre_tool_use' },
      input: JSON.stringify({ session_id: 'foreign', hook_event_name: 'PreToolUse' }),
    });
    assert.equal(legacy.status, 0);
    assert.equal(fs.existsSync(path.join(dir, '.cubicle', 'claude-code.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (require.main === module) test().then(() => console.log('Grok example checks passed.')).catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = test;
