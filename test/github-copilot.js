'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { apply, config } = require('../examples/github-copilot/hook.js');
const hook = path.resolve(__dirname, '../examples/github-copilot/hook.js');
const empty = () => ({ company: 'GitHub Copilot', agents: [] });

async function test() {
  let feed = empty();
  let time = Date.now();
  const send = (event, extra = {}, override) => {
    time += 10;
    feed = apply(feed, event, { sessionId: 's1', cwd: '/work/repo', timestamp: time, ...extra }, time, override);
  };
  send('sessionStart'); assert.equal(feed.agents[0].name, 'repo');
  send('sessionStart', { sessionId: 's2' }); assert.equal(feed.agents.length, 2);
  send('userPromptSubmitted', { prompt: 'PRIVATE PROMPT' });
  send('preToolUse', { toolName: 'bash', toolArgs: '{"command":"PRIVATE COMMAND"}' });
  assert.equal(feed.agents[0].task, 'bash'); assert.equal(feed.agents[0].status, 'running');
  send('sessionStart'); assert.equal(feed.agents[0].status, 'running', 'startup cannot settle an active session');
  send('notification', { notification_type: 'permission_prompt', message: 'PRIVATE MESSAGE' });
  assert.equal(feed.agents[0].status, 'waiting');
  send('postToolUse', { toolName: 'bash', toolResult: { resultType: 'success', textResultForLlm: 'PRIVATE RESULT' } });
  assert.equal(feed.agents[0].status, 'running');
  send('notification', { notification_type: 'permission_prompt', timestamp: time - 100 });
  assert.equal(feed.agents[0].status, 'running', 'late permission notification cannot undo tool completion');
  send('notification', { notification_type: 'agent_completed' });
  assert.equal(feed.agents[0].status, 'running', 'background completion does not finish the parent');
  send('agentStop', { agentId: 'child' });
  assert.equal(feed.agents[0].status, 'running');
  send('subagentStop', { agentName: 'explore' });
  assert.equal(feed.agents[0].status, 'running');
  send('agentStop'); assert.equal(feed.agents[0].status, 'idle');
  send('preToolUse', { toolName: 'ask_user' }); assert.equal(feed.agents[0].status, 'waiting');
  send('postToolUse', { toolName: 'ask_user' }); assert.equal(feed.agents[0].status, 'running');
  for (const resultType of ['failure', 'denied']) {
    send('postToolUse', { toolResult: { resultType, textResultForLlm: 'PRIVATE RESULT' } });
    assert.equal(feed.agents[0].status, 'error');
    send('agentStop'); assert.equal(feed.agents[0].status, 'error');
    send('userPromptSubmitted'); assert.equal(feed.agents[0].error, null);
  }
  send('errorOccurred', { error: { message: 'PRIVATE ERROR', stack: 'PRIVATE STACK' } });
  assert.equal(feed.agents[0].status, 'error');
  send('preCompact'); assert.equal(feed.agents[0].status, 'running');
  send('postToolUseFailure'); assert.equal(feed.agents[0].status, 'error');
  assert.ok(!JSON.stringify(feed).includes('PRIVATE'));
  send('sessionEnd'); assert.deepEqual(feed.agents.map((a) => a.id), ['s2']);
  send('agentStop'); assert.equal(feed.agents.length, 1, 'queued stop cannot recreate a closed session');
  send('sessionStart', { timestamp: time - 100 }); assert.equal(feed.agents.length, 1);
  send('sessionStart'); assert.equal(feed.agents.length, 2, 'a later resume can return');

  for (const input of [null, [], {}, { cwd: '/work/repo' }, { sessionId: 2 }]) {
    assert.equal(apply(feed, 'preToolUse', input), feed);
  }
  let legacy = apply(empty(), 'sessionStart', { cwd: '/work/repo' }, time, 'legacy');
  legacy = apply(legacy, 'preToolUse', { toolName: 'view', toolArgs: { path: 'PRIVATE' } }, time + 10, 'legacy');
  legacy = apply(legacy, 'agentStop', { sessionId: 'native-id' }, time + 20, 'legacy');
  assert.equal(legacy.agents.length, 1); assert.equal(legacy.agents[0].id, 'legacy');
  assert.equal(legacy.agents[0].status, 'idle');
  const snake = apply(empty(), 'preToolUse', { session_id: 'snake', cwd: '/work/repo',
    timestamp: new Date(time).toISOString(), tool_name: 'view', tool_input: { path: 'PRIVATE' } }, time);
  assert.equal(snake.agents[0].id, 'snake'); assert.equal(snake.agents[0].task, 'view');
  const expired = apply(snake, 'sessionStart', { sessionId: 'fresh' }, time + 13 * 60 * 60 * 1000);
  assert.deepEqual(expired.agents.map((a) => a.id), ['fresh']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-copilot-'));
  const file = path.join(dir, 'feed.json');
  const env = { ...process.env, CUBICLE_COPILOT_FEED: file, CUBICLE_COPILOT_SESSION: '' };
  try {
    const run = (event, input, extraEnv = {}) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [hook, event], { env: { ...env, ...extraEnv } });
      let out = ''; let err = '';
      child.stdout.on('data', (x) => { out += x; }); child.stderr.on('data', (x) => { err += x; });
      child.on('error', reject);
      child.on('close', (code) => {
        try { assert.equal(code, 0); assert.equal(out, ''); assert.equal(err, ''); resolve(); } catch (e) { reject(e); }
      });
      child.stdin.end(JSON.stringify(input));
    });
    await Promise.all(Array.from({ length: 12 }, (_, i) => run('sessionStart', { sessionId: 'c' + i })));
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(read().agents.length, 12, 'concurrent writers retain every session');
    fs.writeFileSync(file + '.lock', ''); fs.utimesSync(file + '.lock', 0, 0);
    await run('sessionStart', { sessionId: 'stale-lock' }); assert.equal(read().agents.length, 13);
    fs.writeFileSync(file + '.lock', '');
    const before = fs.readFileSync(file, 'utf8');
    await run('sessionStart', { sessionId: 'contended' });
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'live lock contention drops the update');
    fs.unlinkSync(file + '.lock');
    await run('preToolUse', { toolName: 'view' }, { CUBICLE_COPILOT_SESSION: 'legacy-process' });
    assert.equal(read().agents.find((a) => a.id === 'legacy-process').task, 'view');
    for (const input of ['{', 'null', '[]', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      const result = spawnSync(process.execPath, [hook, 'preToolUse'], { env, input });
      assert.equal(result.status, 0); assert.equal(result.stdout.length, 0); assert.equal(result.stderr.length, 0);
    }
    await run('sessionStart', { sessionId: 'cannot-write' }, { CUBICLE_COPILOT_FEED: path.join(file, 'impossible') });
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.ok(!fs.readdirSync(dir).some((name) => name.endsWith('.lock') || name.endsWith('.tmp')));

    const generated = spawnSync(process.execPath, [hook, '--config'], { encoding: 'utf8' });
    assert.equal(generated.status, 0); assert.deepEqual(JSON.parse(generated.stdout), config());
    assert.equal(config().version, 1);
    // Exercise the actual generated commands, including paths with shell metacharacters.
    const copied = path.join(dir, "space ' $ ` copilot.js");
    fs.copyFileSync(hook, copied);
    const specialConfig = JSON.parse(spawnSync(process.execPath, [copied, '--config'], { encoding: 'utf8' }).stdout);
    for (const [event, entries] of Object.entries(specialConfig.hooks)) {
      const command = entries[0];
      assert.equal(command.timeoutSec, 3); assert.ok(command.powershell.startsWith('& '));
      if (process.platform === 'win32') continue;
      const result = spawnSync('bash', ['-c', command.bash], { env, input: JSON.stringify({ sessionId: 'configured',
        cwd: '/work/repo', toolName: 'view', notification_type: 'permission_prompt' }) });
      assert.equal(result.status, 0, event); assert.equal(result.stdout.length, 0); assert.equal(result.stderr.length, 0);
      const agent = read().agents.find((a) => a.id === 'configured');
      if (event === 'sessionEnd') assert.equal(agent, undefined);
      else assert.ok(agent, event);
    }

    // The existing file source serves the hook's output, without a new server adapter.
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const server = spawn(process.execPath, [path.resolve(__dirname, '../bin/cubicle.js'), '--port', String(port),
      '--source', file], { env: { ...env, CUBICLE_TELEGRAM_TOKEN: '',
        CUBICLE_TELEGRAM_SETTINGS: path.join(dir, 'no-telegram.json') }, stdio: 'ignore' });
    const get = (route) => new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${route}`, (res) => {
        let body = ''; res.on('data', (x) => { body += x; });
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
      }).on('error', reject);
    });
    try {
      let ready = false;
      for (let i = 0; i < 60; i++) {
        try { assert.equal((await get('/config.json')).status, 200); ready = true; break; } catch (_) { await new Promise((r) => setTimeout(r, 50)); }
      }
      assert.ok(ready, 'server starts');
      await run('preToolUse', { sessionId: 'http', cwd: '/work/project', toolName: 'view' });
      const response = await get('/api/feed/0');
      assert.equal(response.status, 200); assert.equal(response.json.company, 'GitHub Copilot');
      assert.equal(response.json.agents.find((a) => a.id === 'http').status, 'running');
      await run('agentStop', { sessionId: 'http' });
      assert.equal((await get('/api/feed/0')).json.agents.find((a) => a.id === 'http').status, 'idle');
    } finally {
      const closed = new Promise((resolve) => server.once('close', resolve));
      server.kill(); await closed;
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test().then(() => console.log('GitHub Copilot example checks passed.')).catch((error) => { console.error(error); process.exitCode = 1; });
