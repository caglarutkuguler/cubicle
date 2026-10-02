#!/usr/bin/env node
// Zero-dependency smoke test: `node test/smoke.js`
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { apply, summarize } = require('../bin/cubicle-hook.js');

const ROOT = path.join(__dirname, '..');
const get = (url) => new Promise((resolve, reject) => {
  http.get(url, (r) => {
    let b = '';
    r.on('data', (d) => (b += d));
    r.on('end', () => resolve({ status: r.statusCode, body: b }));
    r.on('close', () => resolve({ status: r.statusCode, body: b, truncated: !r.complete }));   // cut-off responses
    r.on('error', () => {});
  }).on('error', reject);
});
const req = (url, method) => new Promise((resolve, reject) => {
  const u = new URL(url);
  http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }).on('error', reject).end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withServer(args, fn, env = {}) {
  const port = 3400 + Math.floor(Math.random() * 500);
  const p = spawn(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), '--port', String(port), ...args], { stdio: 'ignore', env: { ...process.env, CUBICLE_TELEGRAM_SETTINGS: path.join(require('os').tmpdir(), 'cubicle-no-telegram.json'), ...env } });
  try { await sleep(500); await fn(`http://127.0.0.1:${port}`); } finally { p.kill(); }
}

// Fail fast instead of hanging CI if a server stops answering.
setTimeout(() => { console.error('smoke test timed out'); process.exit(1); }, 45000).unref();

(async () => {
  // hook logic
  let feed = { company: 'Claude Code', agents: [] };
  feed = apply(feed, { session_id: 's1', cwd: '/x/repo', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/repo/a.ts' } });
  assert.strictEqual(feed.agents[0].status, 'running');
  assert.strictEqual(feed.agents[0].task, 'Edit a.ts');
  assert.strictEqual(feed.agents[0].name, 'repo');
  feed = apply(feed, { session_id: 's1', hook_event_name: 'Notification', message: 'permission?' });
  assert.strictEqual(feed.agents[0].status, 'waiting');
  feed = apply(feed, { session_id: 's1', hook_event_name: 'Stop' });
  assert.strictEqual(feed.agents[0].status, 'idle');
  feed = apply(feed, { session_id: 's1', hook_event_name: 'Notification', message: 'Claude is waiting for your input' });
  assert.strictEqual(feed.agents[0].status, 'idle', 'idle reminder must not raise a hand');
  feed = apply(feed, { session_id: 's1', hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'x' });
  assert.strictEqual(feed.agents[0].status, 'idle');
  feed = apply(feed, { session_id: 's1', hook_event_name: 'Notification', notification_type: 'auth_success', message: 'ok' });
  assert.strictEqual(feed.agents[0].status, 'idle');
  feed = apply(feed, { session_id: 's1', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
  assert.strictEqual(feed.agents[0].status, 'waiting');
  assert.strictEqual(feed.agents[0].task, 'allow Bash: rm -rf build?');
  feed = apply(feed, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
  assert.strictEqual(feed.agents[0].status, 'running');
  feed = apply(feed, { session_id: 's1', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.strictEqual(feed.agents[0].status, 'waiting');
  feed = apply(feed, { session_id: 's1', hook_event_name: 'Stop' });
  feed = apply(feed, { session_id: 's1', hook_event_name: 'SessionEnd' });
  assert.strictEqual(feed.agents.length, 0);
  assert.strictEqual(summarize({ tool_name: 'Bash', tool_input: { command: 'npm test' } }), 'Bash: npm test');

  // subagents: one character each, next to the session that started them
  {
    let f = { company: 'Claude Code', agents: [] };
    const find = (id) => f.agents.find((x) => x.id === id);
    f = apply(f, { session_id: 's2', cwd: '/x/app', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { description: 'scan repo' } });
    f = apply(f, { session_id: 's2', cwd: '/x/app', hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' });
    f = apply(f, { session_id: 's2', cwd: '/x/app', hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'Plan' });
    assert.strictEqual(f.agents.length, 3);
    assert.strictEqual(find('s2:a1').name, 'app › Explore');
    assert.strictEqual(find('s2:a1').role, 'Claude Code subagent');
    assert.strictEqual(find('s2').task, 'Agent: scan repo', 'the session keeps its own task');
    f = apply(f, { session_id: 's2', hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Read', tool_input: { file_path: '/x/app/b.ts' } });
    assert.strictEqual(find('s2:a1').task, 'Read b.ts');
    assert.strictEqual(find('s2').task, 'Agent: scan repo', 'subagent tool calls do not move the session bubble');
    f = apply(f, { session_id: 's2', hook_event_name: 'PermissionRequest', agent_id: 'a2', agent_type: 'Plan', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.strictEqual(find('s2:a2').status, 'waiting');
    assert.strictEqual(find('s2').status, 'running');
    // a permission_prompt notification from inside a subagent raises the subagent's hand (#7)
    f = apply(f, { session_id: 's2', hook_event_name: 'Notification', agent_id: 'a1', agent_type: 'Explore', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    assert.strictEqual(find('s2:a1').status, 'waiting');
    assert.strictEqual(find('s2').status, 'running', 'the session keeps working');
    f = apply(f, { session_id: 's2', hook_event_name: 'Notification', agent_id: 'a1', notification_type: 'idle_prompt', message: 'waiting' });
    assert.strictEqual(find('s2:a1').status, 'waiting', 'other notifications change nothing');
    assert.strictEqual(find('s2').status, 'running');
    f = apply(f, { session_id: 's2', hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.strictEqual(find('s2:a1').status, 'running');
    f = apply(f, { session_id: 's2', hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Explore' });
    assert.ok(!find('s2:a1'));
    assert.ok(find('s2:a2'));
    // a subagent seen first mid-run (hooks installed while it was running) still gets a character
    f = apply(f, { session_id: 's2', cwd: '/x/app', hook_event_name: 'PostToolUse', agent_id: 'a3', tool_name: 'Grep', tool_input: { pattern: 'TODO' } });
    assert.strictEqual(find('s2:a3').name, 'app › subagent');
    // SubagentStop without an agent_id (older Claude Code) is a no-op
    f = apply(f, { session_id: 's2', hook_event_name: 'SubagentStop' });
    assert.strictEqual(f.agents.length, 3);
    // SessionEnd takes the session's remaining subagents with it, and only those
    f = apply(f, { session_id: 's3', cwd: '/x/other', hook_event_name: 'SubagentStart', agent_id: 'b1', agent_type: 'Explore' });
    f = apply(f, { session_id: 's2', hook_event_name: 'SessionEnd' });
    assert.deepStrictEqual(f.agents.map((x) => x.id), ['s3:b1']);
  }

  // concurrent hook runs don't lose each other's updates, and a stale lock doesn't block
  {
    const fs = require('fs');
    const os = require('os');
    const { spawn: sp } = require('child_process');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-lock-'));
    const run = (ev) => new Promise((ok) => {
      const c = sp(process.execPath, [path.join(ROOT, 'bin/cubicle-hook.js')], { env: { ...process.env, HOME: home, USERPROFILE: home } });
      c.on('exit', ok); c.stdin.end(JSON.stringify(ev));
    });
    const N = 25;
    await Promise.all(Array.from({ length: N }, (_, i) => run({ session_id: `c${i}`, cwd: `/w/r${i}`, hook_event_name: 'SessionStart' })));
    const file = path.join(home, '.cubicle', 'claude-code.json');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).agents.length, N, 'no lost updates under concurrency');
    assert.ok(!fs.existsSync(file + '.lock'), 'lock released');
    fs.writeFileSync(file + '.lock', ''); const old = (Date.now() - 60000) / 1000; fs.utimesSync(file + '.lock', old, old);
    const t0 = Date.now();
    await run({ session_id: 'late', cwd: '/w/late', hook_event_name: 'SessionStart' });
    assert.ok(Date.now() - t0 < 1500, 'stale lock taken over quickly');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).agents.length, N + 1);
    fs.rmSync(home, { recursive: true, force: true });
  }

  // install-hooks keeps user settings, is idempotent, and uninstalls cleanly
  {
    const fs = require('fs');
    const os = require('os');
    const { install, EVENTS } = require('../bin/cubicle-hook.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-'));
    const f = path.join(dir, 'settings.json');
    const mine = { type: 'command', command: 'echo mine' };
    fs.writeFileSync(f, JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [mine] }] } }));
    const log = console.log; console.log = () => {};
    try {
      install({ settingsFile: f }); install({ settingsFile: f });
      let s = JSON.parse(fs.readFileSync(f, 'utf8'));
      assert.strictEqual(s.theme, 'dark');
      for (const ev of EVENTS) assert.strictEqual(s.hooks[ev].flatMap((g) => g.hooks).filter((h) => /cubicle-hook/.test(h.command)).length, 1, ev);
      assert.deepStrictEqual(s.hooks.Stop[0].hooks[0], mine);
      install({ settingsFile: f, uninstall: true });
      s = JSON.parse(fs.readFileSync(f, 'utf8'));
      assert.deepStrictEqual(s, { theme: 'dark', hooks: { Stop: [{ hooks: [mine] }] } });
    } finally { console.log = log; fs.rmSync(dir, { recursive: true, force: true }); }
  }

  // the hook keeps the last steps with their duration; the server passes them on, redacted if asked
  {
    const { apply: hookApply } = require('../bin/cubicle-hook.js');
    let f = { company: 'C', agents: [] };
    f = hookApply(f, { session_id: 'r1', cwd: '/x/app', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    f = hookApply(f, { session_id: 'r1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    f = hookApply(f, { session_id: 'r1', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/app/a.ts' } });
    for (let i = 0; i < 12; i++) f = hookApply(f, { session_id: 'r1', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: `/x/f${i}.ts` } });
    const r = f.agents[0].recent;
    assert.strictEqual(r.length, 8, 'only the last few steps are kept');
    assert.strictEqual(r[r.length - 1][1], 'Read f11.ts');
    let g = hookApply({ company: 'C', agents: [] }, { session_id: 'r2', cwd: '/x/app', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    g = hookApply(g, { session_id: 'r2', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.strictEqual(g.agents[0].recent[0].length, 3, 'a finished step has a duration');
    const fs = require('fs'); const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-steps-'));
    const feedFile = path.join(dir, 'f.json');
    fs.writeFileSync(feedFile, JSON.stringify({ agents: [{ id: 's', name: 'app', status: 'running', parent: 'p1', recent: [[1, 'Bash: curl -H "Authorization: x" https://secret', 900], [2, 'Edit /secret/a.ts'], ['bad']] }] }));
    await withServer(['--source', feedFile], async (base) => {
      const a = JSON.parse((await get(`${base}/api/feed/0`)).body).agents[0];
      assert.strictEqual(a.parent, 'p1'); assert.strictEqual(a.recent.length, 2); assert.strictEqual(a.recent[0][2], 900);
    });
    await withServer(['--source', feedFile, '--redact'], async (base) => {
      const body = (await get(`${base}/api/feed/0`)).body;
      assert.ok(!body.includes('secret') && !body.includes('Authorization'), 'redact strips step details');
      assert.deepStrictEqual(JSON.parse(body).agents[0].recent.map((x) => x[1]), ['Bash', 'Edit']);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Codex CLI and Gemini CLI through the same hook (#3)
  {
    const fs = require('fs'); const os = require('os');
    const { apply: hookApply, install, RUNTIMES } = require('../bin/cubicle-hook.js');
    // Gemini: its own event names, mapped onto the office
    let g = { company: 'Gemini CLI', agents: [] };
    g = hookApply(g, { session_id: 'g1', cwd: '/w/site', hook_event_name: 'SessionStart', source: 'startup' }, 'gemini');
    assert.strictEqual(g.agents[0].role, 'Gemini CLI'); assert.strictEqual(g.agents[0].status, 'idle');
    g = hookApply(g, { session_id: 'g1', hook_event_name: 'BeforeAgent', prompt: 'fix the footer' }, 'gemini');
    assert.strictEqual(g.agents[0].status, 'running'); assert.strictEqual(g.agents[0].task, 'fix the footer');
    g = hookApply(g, { session_id: 'g1', hook_event_name: 'BeforeTool', tool_name: 'run_shell_command', tool_input: { command: 'npm test' } }, 'gemini');
    assert.strictEqual(g.agents[0].task, 'run_shell_command: npm test');
    g = hookApply(g, { session_id: 'g1', hook_event_name: 'BeforeTool', tool_name: 'read_file', tool_input: { absolute_path: '/w/site/a.css' } }, 'gemini');
    assert.strictEqual(g.agents[0].task, 'read_file a.css');
    g = hookApply(g, { session_id: 'g1', hook_event_name: 'PreCompress', trigger: 'auto' }, 'gemini');
    assert.strictEqual(g.agents[0].task, 'read_file a.css', 'PreCompress fires every turn; it changes nothing');
    // as recorded from Gemini CLI 0.61: a shell command waiting for confirmation
    g = hookApply(g, { session_id: 'g1', hook_event_name: 'Notification', notification_type: 'ToolPermission', message: 'Tool Confirm Shell Command requires execution',
      details: { type: 'exec', title: 'Confirm Shell Command', command: 'rm a.txt', rootCommand: 'rm' } }, 'gemini');
    assert.strictEqual(g.agents[0].status, 'waiting'); assert.strictEqual(g.agents[0].task, 'allow rm a.txt?');
    g = hookApply(g, { session_id: 'g1', hook_event_name: 'AfterAgent' }, 'gemini');
    assert.strictEqual(g.agents[0].status, 'idle');
    g = hookApply(g, { session_id: 'g1', hook_event_name: 'SessionEnd', reason: 'exit' }, 'gemini');
    assert.strictEqual(g.agents.length, 0);
    // Codex: Claude Code's event names
    let c = { company: 'Codex', agents: [] };
    c = hookApply(c, { session_id: 'c1', cwd: '/w/api', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } }, 'codex');
    assert.strictEqual(c.agents[0].role, 'Codex'); assert.strictEqual(c.agents[0].status, 'waiting'); assert.strictEqual(c.agents[0].name, 'api');

    // the hook writes ~/.cubicle/<runtime>.json and answers {} on stdout for Codex and Gemini
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-home-'));
    for (const [rt, ev, out] of [['codex', { session_id: 'c9', cwd: '/x/app', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, '{}'],
      ['gemini', { session_id: 'g9', cwd: '/x/app', hook_event_name: 'BeforeTool', tool_name: 'write_file', tool_input: { file_path: '/x/app/b.ts' } }, '{}'],
      ['', { session_id: 's9', cwd: '/x/app', hook_event_name: 'Stop' }, '']]) {
      const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), 'hook', ...(rt ? [rt] : [])],
        { input: JSON.stringify(ev), env: { ...process.env, HOME: home, USERPROFILE: home } });
      assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout.toString().trim(), out, `${rt || 'claude'} stdout`);
      const feed = JSON.parse(fs.readFileSync(path.join(home, '.cubicle', RUNTIMES[rt || 'claude'].file), 'utf8'));
      assert.strictEqual(feed.company, RUNTIMES[rt || 'claude'].label);
      assert.strictEqual(feed.agents[0].name, 'app');
    }
    // install writes each CLI's own config shape
    const log = console.log; console.log = () => {};
    try {
      const cf = path.join(home, 'codex-hooks.json'), gf = path.join(home, 'gemini-settings.json');
      fs.writeFileSync(gf, JSON.stringify({ theme: 'Dracula' }));
      install({ runtime: 'codex', settingsFile: cf }); install({ runtime: 'gemini', settingsFile: gf }); install({ runtime: 'gemini', settingsFile: gf });
      const cs = JSON.parse(fs.readFileSync(cf, 'utf8')), gs = JSON.parse(fs.readFileSync(gf, 'utf8'));
      assert.ok(cs.hooks.PermissionRequest[0].hooks[0].command.endsWith(' codex'));
      assert.strictEqual(cs.hooks.SessionEnd[0].hooks[0].timeout, 3);
      assert.strictEqual(gs.theme, 'Dracula');
      assert.strictEqual(gs.hooks.BeforeTool.length, 1, 'idempotent');
      assert.strictEqual(gs.hooks.BeforeTool[0].matcher, '*'); assert.strictEqual(gs.hooks.BeforeTool[0].hooks[0].timeout, 5000);
      assert.ok(gs.hooks.BeforeTool[0].hooks[0].command.endsWith(' gemini'));
      install({ runtime: 'gemini', settingsFile: gf, uninstall: true });
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(gf, 'utf8')), { theme: 'Dracula' });
    } finally { console.log = log; fs.rmSync(home, { recursive: true, force: true }); }
  }

  // feed mode
  await withServer(['--source', path.join(ROOT, 'examples/feed.json')], async (base) => {
    assert.strictEqual((await get(`${base}/`)).status, 200);
    const cfg = JSON.parse((await get(`${base}/config.json`)).body);
    assert.strictEqual(cfg.source, 'feed'); assert.strictEqual(cfg.label, 'feed.json'); assert.ok(cfg.build);
    const f = JSON.parse((await get(`${base}/api/feed`)).body);
    assert.strictEqual(f.agents.length, 4);
    assert.strictEqual((await get(`${base}/api/companies`)).status, 403);
    assert.strictEqual(await req(`${base}/api/feed`, 'POST'), 405);
  });

  // claude-code source before any hook has run: empty office, not an error
  {
    const home = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'cubicle-home-'));
    await withServer(['--source', 'claude-code'], async (base) => {
      const r = await get(`${base}/api/feed`);
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(JSON.parse(r.body), { company: 'Claude Code', agents: [] });
    }, { HOME: home, USERPROFILE: home });
  }

  // several sources in one office
  await withServer(['--source', `paperclip,${path.join(ROOT, 'examples/feed.json')}`], async (base) => {
    const cfg = JSON.parse((await get(`${base}/config.json`)).body);
    assert.deepStrictEqual(cfg.sources.map((x) => x.kind), ['paperclip', 'feed']);
    assert.strictEqual(cfg.sources[1].path, '/api/feed/0');
    assert.strictEqual(JSON.parse((await get(`${base}/api/feed/0`)).body).agents.length, 4);
    assert.strictEqual((await get(`${base}/api/feed/1`)).status, 404);
    assert.strictEqual((await get(`${base}/api/companies/x/secrets`)).status, 403);
  });

  // authenticated Paperclip: the proxy adds the key; browser credentials never pass through
  {
    const seen = [];
    const fake = http.createServer((q, r) => {
      seen.push({ path: q.url, method: q.method, auth: q.headers.authorization, cookie: q.headers.cookie });
      r.writeHead(200, { 'content-type': 'application/json' }); r.end('[]');
    });
    await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
    const upstream = `http://127.0.0.1:${fake.address().port}`;
    const withHeaders = (url, headers) => new Promise((resolve, reject) => {
      const u = new URL(url);
      http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }).on('error', reject);
    });
    try {
      await withServer(['--paperclip', upstream], async (base) => {
        assert.strictEqual(await withHeaders(`${base}/api/companies`, { authorization: 'Bearer from-browser', cookie: 'sid=browser' }), 200);
        assert.strictEqual(await withHeaders(`${base}/api/companies/x/secrets`, {}), 403);
      }, { PAPERCLIP_TOKEN: 'pcp_test_key' });
      await withServer(['--paperclip', upstream], async (base) => {
        assert.strictEqual(await withHeaders(`${base}/api/companies`, { authorization: 'Bearer from-browser' }), 200);
      }, { PAPERCLIP_TOKEN: '' });
      assert.deepStrictEqual(seen, [
        { path: '/api/companies', method: 'GET', auth: 'Bearer pcp_test_key', cookie: undefined },
        { path: '/api/companies', method: 'GET', auth: undefined, cookie: undefined },
      ]);
      const cfg = await new Promise((resolve) => withServer(['--paperclip', upstream], async (base) => resolve((await get(`${base}/config.json`)).body), { PAPERCLIP_TOKEN: 'pcp_test_key' }));
      assert.ok(!cfg.includes('pcp_test_key'), 'key must never reach the browser');
    } finally { fake.close(); }
  }

  // an upstream that dies mid-response must not take the server down
  {
    const net = require('net');
    const flaky = net.createServer((sock) => {
      sock.once('data', () => {
        sock.write('HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 1000\r\n\r\n[{"id":');
        setTimeout(() => sock.destroy(), 50);   // headers sent, body cut off
      });
    });
    await new Promise((ok) => flaky.listen(0, '127.0.0.1', ok));
    try {
      await withServer(['--paperclip', `http://127.0.0.1:${flaky.address().port}`], async (base) => {
        for (let i = 0; i < 3; i++) await get(`${base}/api/companies`).catch(() => {});
        await sleep(200);
        assert.strictEqual((await get(`${base}/config.json`)).status, 200, 'server must survive a truncated upstream response');
      });
    } finally { flaky.close(); }
  }

  // only the fields the page needs leave the server; --redact also drops titles, commands, errors
  {
    const secretIssue = { identifier: 'X-1', title: 'rotate AWS key AKIA123', description: 'secret body', status: 'in_progress', assigneeAgentId: 'a1',
      executionWorkspaceSettings: { env: 'TOKEN=abc' }, reviewAttention: { paths: [{ kind: 'interaction', responder: 'Board', label: 'Pending ask user questions', ref: 'r' }] } };
    const up = http.createServer((q, r) => {
      r.writeHead(200, { 'content-type': 'application/json' });
      if (q.url.endsWith('/issues')) return r.end(JSON.stringify([secretIssue, { ...secretIssue, identifier: 'X-2', status: 'done' }]));
      if (q.url.endsWith('/agents')) return r.end(JSON.stringify([{ id: 'a1', name: 'Dev', status: 'error', errorReason: 'ssh key /home/me/.ssh/id_rsa denied', adapterConfig: { apiKey: 'sk-live' } }]));
      r.end(JSON.stringify([{ id: 'c', name: 'Co', issuePrefix: 'X', budgetMonthlyCents: 1 }]));
    });
    await new Promise((ok) => up.listen(0, '127.0.0.1', ok));
    const upstream = `http://127.0.0.1:${up.address().port}`;
    const fs = require('fs'); const os = require('os');
    const feedFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-red-')), 'f.json');
    fs.writeFileSync(feedFile, JSON.stringify({ company: 'CC', agents: [{ id: 's', name: 'repo', status: 'running', task: 'Bash: curl -H "Authorization: Bearer sk-live" api', error: 'boom at /secret/path' }] }));
    try {
      await withServer(['--source', `paperclip,${feedFile}`, '--paperclip', upstream], async (base) => {
        const issues = JSON.parse((await get(`${base}/api/companies/c/issues`)).body);
        assert.deepStrictEqual(issues.map((i) => i.identifier), ['X-1'], 'closed issues are not forwarded');
        assert.strictEqual(issues[0].title, 'rotate AWS key AKIA123');
        assert.ok(!('description' in issues[0]) && !('executionWorkspaceSettings' in issues[0]), 'unused fields are dropped');
        const agents = (await get(`${base}/api/companies/c/agents`)).body;
        assert.ok(!agents.includes('sk-live'), 'adapter config never forwarded');
      });
      await withServer(['--source', `paperclip,${feedFile}`, '--paperclip', upstream, '--redact'], async (base) => {
        const all = [(await get(`${base}/api/companies/c/issues`)).body, (await get(`${base}/api/companies/c/agents`)).body, (await get(`${base}/api/feed/0`)).body].join('\n');
        for (const secret of ['AKIA123', 'secret body', 'id_rsa', 'sk-live', 'curl', 'Authorization', '/secret/path']) assert.ok(!all.includes(secret), `redacted output leaks ${secret}`);
        const issue = JSON.parse((await get(`${base}/api/companies/c/issues`)).body)[0];
        assert.strictEqual(issue.identifier, 'X-1'); assert.strictEqual(issue.reviewAttention.paths[0].responder, 'Board');
        assert.strictEqual(JSON.parse((await get(`${base}/api/feed/0`)).body).agents[0].task, 'Bash');
        assert.strictEqual(JSON.parse((await get(`${base}/config.json`)).body).redact, true);
      });
    } finally { up.close(); }
  }

  // heartbeat runs and the KPI board: only shaped fields leave the server; --redact keeps codes only
  {
    const run = { id: 'r1', agentId: 'a1', status: 'failed', errorCode: 'adapter_failed', error: 'token sk-live refused', stderrExcerpt: 'trace /secret/path', finishedAt: '2026-10-01T10:00:00Z', logRef: 'x', contextSnapshot: { prompt: 'secret prompt' } };
    const issues = [
      { id: 'i1', identifier: 'K-1', title: 'Launch page', status: 'in_progress', createdByUserId: 'u1', createdAt: '2026-10-01T08:00:00Z', startedAt: '2026-10-01T09:00:00Z', description: 'secret body' },
      { id: 'i2', identifier: 'K-2', title: 'sub', status: 'done', parentId: 'i1', createdByAgentId: 'a1', completedAt: new Date().toISOString() },
      { id: 'i3', identifier: 'K-3', title: 'old', status: 'done', createdByUserId: 'u1', completedAt: '2020-01-01T00:00:00Z' },
      { id: 'i4', identifier: 'K-4', title: 'chat', status: 'todo', createdByUserId: 'u1', conversationAgentId: 'a1' },
    ];
    const up = http.createServer((q, r) => {
      r.writeHead(200, { 'content-type': 'application/json' });
      if (q.url.startsWith('/api/companies/c/heartbeat-runs')) { assert.ok(q.url.includes('limit=60'), 'runs are limited upstream'); return r.end(JSON.stringify([run])); }
      if (q.url.endsWith('/issues')) return r.end(JSON.stringify(issues));
      r.end('[]');
    });
    await new Promise((ok) => up.listen(0, '127.0.0.1', ok));
    const upstream = `http://127.0.0.1:${up.address().port}`;
    try {
      await withServer(['--paperclip', upstream], async (base) => {
        const runs = JSON.parse((await get(`${base}/api/companies/c/heartbeat-runs`)).body);
        assert.deepStrictEqual(Object.keys(runs[0]).sort(), ['agentId', 'error', 'errorCode', 'finishedAt', 'id', 'status', 'stderrExcerpt']);
        const kpi = JSON.parse((await get(`${base}/api/kpi/c`)).body);
        assert.deepStrictEqual(kpi.map((i) => i.identifier), ['K-1', 'K-2', 'K-4'], 'finished issues older than 90 days are left out');
        assert.strictEqual(kpi[0].human, true); assert.strictEqual(kpi[1].human, false); assert.strictEqual(kpi[2].convo, true);
        assert.ok(!JSON.stringify(kpi).includes('secret body'));
        assert.strictEqual((await get(`${base}/api/kpi/../../etc`)).status !== 200, true);
      });
      await withServer(['--paperclip', upstream, '--redact'], async (base) => {
        const all = (await get(`${base}/api/companies/c/heartbeat-runs`)).body + (await get(`${base}/api/kpi/c`)).body;
        for (const secret of ['sk-live', '/secret/path', 'secret prompt', 'Launch page']) assert.ok(!all.includes(secret), `redacted output leaks ${secret}`);
        assert.ok(all.includes('adapter_failed'));
      });
    } finally { up.close(); }
  }

  // Telegram (optional): pairing by code, status from the office, a message when an agent starts
  // needing you; nothing is answered for chats that did not pair
  {
    const fs = require('fs'); const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-tg-'));
    const feed = path.join(dir, 'a.json');
    fs.writeFileSync(feed, JSON.stringify({ agents: [{ id: 'f1', name: 'Feeder', status: 'working' }] }));
    const updates = [], sent = []; let uid = 1;
    const tg = http.createServer((q, r) => {
      let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
        const body = b ? JSON.parse(b) : {}; r.writeHead(200, { 'content-type': 'application/json' });
        if (q.url === '/botT0K/getUpdates') return setTimeout(() => r.end(JSON.stringify({ ok: true, result: updates.filter((u) => u.update_id >= (body.offset || 0)) })), 150);
        if (q.url === '/botT0K/sendMessage') { sent.push(body); return r.end(JSON.stringify({ ok: true, result: { message_id: sent.length } })); }
        r.end('{"ok":false}');
      });
    });
    await new Promise((ok) => tg.listen(0, '127.0.0.1', ok));
    const push = (chat, text) => updates.push({ update_id: uid++, message: { message_id: 1, chat: { id: chat }, from: { language_code: 'en' }, text } });
    const port = 3400 + Math.floor(Math.random() * 500);
    let log = '';
    const p = spawn(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), '--port', String(port), '--source', feed], { env: { ...process.env, CUBICLE_TELEGRAM_TOKEN: 'T0K',
      CUBICLE_TELEGRAM_API: `http://127.0.0.1:${tg.address().port}`, CUBICLE_TELEGRAM_STATE: path.join(dir, 'tg.json'), CUBICLE_TELEGRAM_INTERVAL: '300', CUBICLE_TELEGRAM_POLL: '0' } });
    p.stdout.on('data', (d) => (log += d));
    try {
      await sleep(700);
      const code = (log.match(/\/start (\d{6})/) || [])[1];
      assert.ok(code, 'a pairing code is printed');
      push(5, '/status'); await sleep(500);
      assert.ok(/not linked yet/.test(sent.at(-1).text), 'an unpaired chat only gets the pairing hint');
      assert.ok(!sent.at(-1).text.includes(code), 'the hint never gives the code away');
      push(7, '/start'); await sleep(500);
      assert.ok(/not linked yet/.test(sent.at(-1).text), '/start without the code does not link');
      push(6, code); await sleep(500);
      assert.strictEqual(String(sent.at(-1).chat_id), '6'); assert.ok(/linked/.test(sent.at(-1).text), 'the six digits alone link too');
      push(6, '/status'); await sleep(500);
      assert.ok(/1 agents · 1 working · 0 need you/.test(sent.at(-1).text), sent.at(-1).text);
      fs.writeFileSync(feed, JSON.stringify({ agents: [{ id: 'f1', name: 'Feeder', status: 'waiting', task: { id: 'T-1', title: 'Docs' } }] }));
      await sleep(900);
      const note = sent.find((m) => /Feeder<\/b> needs you/.test(m.text));
      assert.ok(note && String(note.chat_id) === '6' && note.text.includes('?agent='), 'a needs-you message with a link to the agent');
      assert.ok(!sent.some((m) => String(m.chat_id) === '5' && /needs you/.test(m.text)), 'unpaired chats get no notifications');
      assert.strictEqual((fs.statSync(path.join(dir, 'tg.json')).mode & 0o777).toString(8), '600');
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tg.json'), 'utf8')).code, code, 'the code is kept for the next start');
    } finally { p.kill(); tg.close(); }
  }

  // Telegram set up from the page: the token is checked with Telegram, saved privately, and the bot
  // starts without a restart; only JSON from this page on this machine is accepted
  {
    const fs = require('fs'); const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-tgset-'));
    const TOK = '1234567890:AAHabcdefghijklmnopqrstuvwxyz';
    const tg = http.createServer((q, r) => {
      q.resume(); q.on('end', () => {
        r.writeHead(q.url.startsWith(`/bot${TOK}/`) ? 200 : 401, { 'content-type': 'application/json' });
        if (q.url === `/bot${TOK}/getMe`) return r.end('{"ok":true,"result":{"username":"OfficeBot"}}');
        if (q.url === `/bot${TOK}/getUpdates`) return setTimeout(() => r.end('{"ok":true,"result":[]}'), 100);
        r.end('{"ok":false}');
      });
    });
    await new Promise((ok) => tg.listen(0, '127.0.0.1', ok));
    const put = (base, body, headers = { 'content-type': 'application/json', 'x-cubicle': '1' }) => new Promise((resolve) => {
      const u = new URL(`${base}/api/telegram`), data = JSON.stringify(body);
      const q = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'PUT', headers }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ status: r.statusCode, body: b })); });
      q.end(data);
    });
    try {
      await withServer(['--source', path.join(dir, 'none.json')], async (base) => {
        assert.strictEqual(JSON.parse((await get(`${base}/api/telegram`)).body).on, false);
        assert.strictEqual((await put(base, { token: TOK }, { 'content-type': 'text/plain' })).status, 400, 'needs the page header');
        assert.strictEqual(JSON.parse((await put(base, { token: 'nope' })).body).error, 'format');
        assert.strictEqual(JSON.parse((await put(base, { token: '1234567890:AAHwrongwrongwrongwrongwrong' })).body).error, 'refused');
        const ok = await put(base, { token: TOK });
        assert.strictEqual(ok.status, 200, ok.body);
        const st = JSON.parse(ok.body);
        assert.ok(st.on && st.username === 'OfficeBot' && /^\d{6}$/.test(st.code), ok.body);
        assert.ok(!(await get(`${base}/api/telegram`)).body.includes(TOK), 'the token is never sent back');
        // the phone address: checked, saved, used; and a request through a local proxy is not "this machine"
        assert.strictEqual(JSON.parse((await put(base, { publicUrl: 'javascript:alert(1)' })).body).error, 'url');
        const ph = JSON.parse((await put(base, { publicUrl: 'http://pc.tail1.ts.net:3200/' })).body);
        assert.strictEqual(ph.publicUrl, 'http://pc.tail1.ts.net:3200');
        for (const h of [{ 'x-forwarded-for': '100.64.0.2' }, { 'tailscale-user-login': 'me@example.com' }, { host: 'pc.tail1.ts.net:3200' }]) {
          assert.strictEqual((await put(base, { replies: true }, { 'content-type': 'application/json', 'x-cubicle': '1', ...h })).status, 403, JSON.stringify(h));
        }
        const proxied = await new Promise((resolve) => http.get(`${base}/api/telegram`, { headers: { 'x-forwarded-for': '100.64.0.2' } }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(JSON.parse(b))); }));
        assert.ok(!proxied.canEdit && !proxied.code, 'a phone through the proxy sees neither the code nor the settings');
        assert.strictEqual(JSON.parse((await put(base, { publicUrl: '' })).body).publicUrl.startsWith('http://127.0.0.1:'), true);
        const file = path.join(dir, 'tg.json');
        assert.strictEqual((fs.statSync(file).mode & 0o777).toString(8), '600');
        await put(base, { token: null });
        assert.strictEqual(JSON.parse((await get(`${base}/api/telegram`)).body).on, false);
      }, { CUBICLE_TELEGRAM_API: `http://127.0.0.1:${tg.address().port}`, CUBICLE_TELEGRAM_SETTINGS: path.join(dir, 'tg.json'), CUBICLE_TELEGRAM_STATE: path.join(dir, 'state.json'), CUBICLE_TELEGRAM_POLL: '0' });
    } finally { tg.close(); }
  }

  // Tailscale (for the phone): found and read with `tailscale status`; `tailscale serve` only on a PUT
  // from this machine, after which the links in messages use the tailnet address
  {
    const fs = require('fs'); const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-ts-'));
    const port = 3400 + Math.floor(Math.random() * 500);
    const bin = path.join(dir, 'tailscale');
    fs.writeFileSync(bin, `#!/bin/sh
case "$1 $2" in
  "status --json") echo '{"BackendState":"Running","Self":{"DNSName":"pc.tail1.ts.net."},"Peer":{"x":{"OS":"android"}}}';;
  "serve status") [ -f ${dir}/served ] && echo '{"Web":{"pc.tail1.ts.net:${port}":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:${port}"}}}}}' || echo '{}';;
  "serve --bg") echo "$@" > ${dir}/served;;
esac
`, { mode: 0o755 });
    const p = spawn(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), '--port', String(port), '--source', path.join(dir, 'none.json')], { stdio: 'ignore',
      env: { ...process.env, CUBICLE_TAILSCALE: bin, CUBICLE_TELEGRAM_SETTINGS: path.join(dir, 'tg.json') } });
    const base = `http://127.0.0.1:${port}`;
    const req = (method, headers = {}) => new Promise((resolve) => {
      const q = http.request(`${base}/api/tailscale`, { method, headers }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ status: r.statusCode, body: b ? JSON.parse(b) : {} })); });
      q.end(method === 'PUT' ? '{}' : undefined);
    });
    try {
      await sleep(700);
      const st = (await req('GET')).body;
      assert.ok(st.found && st.running && !st.served && st.phones === 1 && st.dns === 'pc.tail1.ts.net', JSON.stringify(st));
      assert.strictEqual((await req('GET', { 'x-forwarded-for': '100.64.0.9' })).status, 403, 'not through the proxy');
      assert.strictEqual((await req('PUT', { 'content-type': 'application/json' })).status, 400, 'needs the page header');
      assert.ok(!fs.existsSync(path.join(dir, 'served')));
      const ok = await req('PUT', { 'content-type': 'application/json', 'x-cubicle': '1' });
      assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.url, `http://pc.tail1.ts.net:${port}`);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'served'), 'utf8').trim(), `serve --bg --http ${port} http://127.0.0.1:${port}`);
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tg.json'), 'utf8')).publicUrl, `http://pc.tail1.ts.net:${port}`);
    } finally { p.kill(); }
  }

  // --record writes what the page would read; replay:<file> serves it back (#4)
  {
    const fs = require('fs'); const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-rec-'));
    const feedFile = path.join(dir, 'feed.json'), rec = path.join(dir, 'day.jsonl');
    fs.writeFileSync(feedFile, JSON.stringify({ company: 'Rec Co', agents: [{ id: 'r1', name: 'Recorder', status: 'running', task: 'Edit a.ts' }] }));
    await withServer(['--source', feedFile, '--record', rec], async () => { await sleep(700); });
    const lines = fs.readFileSync(rec, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(lines[0].type, 'config');
    assert.strictEqual(lines[0].sources[0].path, '/api/feed/0');
    assert.ok(lines.some((l) => l.path === '/api/feed/0' && l.body.agents[0].name === 'Recorder'));
    // a second document later in the "day"
    fs.appendFileSync(rec, JSON.stringify({ t: lines[1].t + 3600e3, path: '/api/feed/0', body: { company: 'Rec Co', agents: [{ id: 'r1', name: 'Recorder', status: 'idle' }] } }) + '\n');
    await withServer(['--source', `replay:${rec}`, '--speed', '1'], async (base) => {
      const cfg = JSON.parse((await get(`${base}/config.json`)).body);
      assert.ok(cfg.replay && cfg.replay.speed === 1 && cfg.replay.to - cfg.replay.from >= 3600e3);
      assert.strictEqual(cfg.sources[0].path, '/api/feed/0');
      assert.strictEqual(JSON.parse((await get(`${base}/api/feed/0`)).body).agents[0].status, 'running', 'the start of the day');
      assert.strictEqual((await get(`${base}/api/feed/1`)).status, 404);
      assert.strictEqual((await get(`${base}/themes/index.json`)).status, 200, 'static files still served');
      assert.strictEqual((await get(`${base}/`)).status, 200);
    });
    await withServer(['--source', `replay:${rec}`, '--speed', '100000'], async (base) => {
      await sleep(200);
      const seen = new Set();
      for (let i = 0; i < 20; i++) { seen.add(JSON.parse((await get(`${base}/api/feed/0`)).body).agents[0].status); await sleep(25); }
      assert.ok(seen.has('idle'), 'a fast replay reaches the later document');
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // the appearance file: readable by every screen, writable only by this page on this machine
  {
    const fs = require('fs'); const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-look-'));
    const file = path.join(dir, 'appearance.json');
    await withServer(['--source', path.join(ROOT, 'examples/feed.json'), '--appearance', file], async (base) => {
      assert.deepStrictEqual(JSON.parse((await get(`${base}/api/appearance`)).body), { agents: {}, names: {} });
      const put = (body, headers) => new Promise((resolve, reject) => {
        const u = new URL(`${base}/api/appearance`);
        const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'PUT', headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        r.on('error', reject); r.end(body);
      });
      const good = { 'content-type': 'application/json', 'x-cubicle': '1' };
      const look = { agents: { a1: { hair: 'bun', photo: 'data:image/jpeg;base64,AAAA' } }, names: { Ada: { hair: 'bun' } }, logo: 'data:image/png;base64,iVBOR', extra: 'dropped' };
      assert.strictEqual(await put(JSON.stringify(look), { 'content-type': 'text/plain' }), 400, 'a plain form post cannot write it');
      assert.strictEqual(await put(JSON.stringify(look), { ...good, origin: 'http://evil.example' }), 403, 'another site cannot write it');
      assert.strictEqual(await put('[1]', good), 400);
      assert.strictEqual(await put(JSON.stringify(look), good), 200);
      const saved = JSON.parse((await get(`${base}/api/appearance`)).body);
      assert.strictEqual(saved.agents.a1.hair, 'bun'); assert.strictEqual(saved.logo, look.logo); assert.ok(!('extra' in saved));
      assert.strictEqual(await put(JSON.stringify({ ...look, logo: 'javascript:alert(1)' }), good), 200);
      assert.ok(!('logo' in JSON.parse((await get(`${base}/api/appearance`)).body)), 'only image data URLs are kept as a logo');
      assert.strictEqual(await req(`${base}/api/feed`, 'PUT'), 405, 'everything else stays read-only');
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // paperclip mode: defaults
  await withServer([], async (base) => {
    const cfg = JSON.parse((await get(`${base}/config.json`)).body);
    assert.strictEqual(cfg.source, 'paperclip'); assert.strictEqual(cfg.paperclipUrl, 'http://127.0.0.1:3100');
  });
  // paperclip mode, Paperclip not reachable (port 9 is never served)
  await withServer(['--paperclip', 'http://127.0.0.1:9'], async (base) => {
    assert.strictEqual((await get(`${base}/api/feed`)).status, 404);
    assert.strictEqual((await get(`${base}/api/companies/x/secrets`)).status, 403);
    assert.strictEqual((await get(`${base}/api/companies`)).status, 502);
    assert.strictEqual(await req(`${base}/api/companies`, 'DELETE'), 405);
    // theme files are served, nothing else under /themes/
    const th = await get(`${base}/themes/military.js`);
    assert.strictEqual(th.status, 200); assert.ok(th.body.includes('CubicleThemes.register'));
    assert.strictEqual((await get(`${base}/themes/nope.js`)).status, 404);
    assert.ok(JSON.parse((await get(`${base}/themes/index.json`)).body).some((t) => t.id === 'military'));
    assert.strictEqual((await get(`${base}/themes/kit.js`)).status, 200);
    assert.strictEqual((await get(`${base}/themes/other.json`)).status, 404);
    assert.strictEqual((await get(`${base}/themes/..%2Fbin%2Fcubicle.js`)).status, 404);
    assert.strictEqual((await get(`${base}/themes/Military.js`)).status, 404);
  });

  // every theme in themes/index.json exists, registers, and draws every option with every
  // status and many different agents (so every outfit branch runs) without throwing
  {
    const fs = require('fs'); const vm = require('vm');
    const dir = path.join(ROOT, 'public/themes');
    const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const ids = catalog.map((e) => e.id);
    assert.ok(ids.includes('military') && new Set(ids).size === ids.length, 'unique theme ids');
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'kit.js')) assert.ok(ids.includes(f.slice(0, -3)), `${f} is listed in themes/index.json`);
    const kit = fs.readFileSync(path.join(dir, 'kit.js'), 'utf8');
    const ctx = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'measureText' ? () => ({ width: 10 }) : String(k).startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
    const people = [];
    for (let i = 0; i < 24; i++) for (const status of ['running', 'waiting', 'idle', 'error']) for (const seated of [true, false]) {
      people.push({ id: `agent-${i}`, name: i ? `Agent ${i}` : 'CEO', role: i % 5 ? 'engineer' : 'ceo', status, ask: status === 'waiting', x: 40, y: 60, dir: (i % 3) - 1, seed: i / 7,
        walking: !seated && i % 2 === 0, seated, typing: seated && status === 'running', shirt: '#335577', skin: '#c68642', hair: '#222', desk: [1, 3] });
    }
    for (const entry of catalog) {
      assert.match(entry.id, /^[a-z0-9-]+$/); assert.ok(entry.name && entry.name.en, `${entry.id} has an English name`);
      const registered = [];
      let photos = 0;
      const sandbox = { window: { CubicleThemes: { register: (t) => registered.push(t), T: 16, photoHead: (g, s) => { if (s.photoSrc) photos++; return !!s.photoSrc; } } }, Math, Date, String, Object, Array, Set, Map, Number };
      vm.createContext(sandbox);
      vm.runInContext(kit, sandbox);
      vm.runInContext(fs.readFileSync(path.join(dir, `${entry.id}.js`), 'utf8'), sandbox);
      const t = registered[0];
      assert.ok(t && t.id === entry.id && t.scale >= 1, `${entry.id} registers itself`);
      const combos = [{}];
      for (const o of entry.options || []) for (const [v] of o.values) combos.push({ [o.key]: v });
      for (const opts of combos) {
        if (t.setup) t.setup(opts);
        for (const [anyError, night, n] of [[false, false, 0], [true, true, 30], [false, true, 5]]) {
          const sprites = new Map(people.slice(0, n).map((s) => [s.id, s]));
          const c = { g: ctx(), t: 12345.6, T: 16, CW: 352, CH: 264, night, opts, sprites, desks: [[1, 3], [4, 3]], lounge: [[17, 5]], anyError, company: n ? 'Demo Co.' : '' };
          t.drawRoom(c); const list = []; t.props(c, list); list.forEach((o) => o.f());
          for (const s of people) { t.drawDesk(c, [1, 3], s); t.drawChar(c, s); }
          // what the appearance dialog can set: hair, skirt, heels, and a photo instead of the head
          for (const look of [{ hair: 'long', bottom: 'skirt', shoes: 'heels' }, { hair: 'bald', bottom: 'trousers', shoes: 'flats' }]) {
            t.drawChar(c, { ...people[1], look }); t.drawChar(c, { ...people[3], look, photoSrc: 'data:image/jpeg;base64,x' });
          }
          t.drawDesk(c, [4, 3], undefined);
          if (t.overlay) t.overlay(c);
          if (typeof t.logoSpot === 'function') assert.strictEqual(t.logoSpot(c).length, 4);
          else if (t.logoSpot) assert.strictEqual(t.logoSpot.length, 4, `${entry.id}: logoSpot is [x, y, w, h]`);
        }
      }
      assert.ok(photos > 0, `${entry.id} draws photo heads through CubicleThemes.photoHead`);
    }
  }

  // --version prints the package version
  {
    const out = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), '--version']).toString().trim();
    assert.strictEqual(out, require('../package.json').version);
  }

  // Paperclip plugin: manifest matches the package, the worker answers the host's lifecycle calls
  {
    const fs = require('fs');
    const pkg = require('../package.json');
    const { pathToFileURL } = require('url');
    const manifest = (await import(pathToFileURL(path.join(ROOT, 'paperclip/manifest.mjs')).href)).default;
    // Paperclip re-imports the manifest after an upgrade; the new version must show up then.
    {
      const os = require('os');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-pkg-'));
      fs.mkdirSync(path.join(dir, 'paperclip'));
      fs.copyFileSync(path.join(ROOT, 'paperclip/manifest.mjs'), path.join(dir, 'paperclip/manifest.mjs'));
      const url = pathToFileURL(path.join(dir, 'paperclip/manifest.mjs'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0', author: 'x' }));
      assert.strictEqual((await import(`${url.href}?m=1`)).default.version, '1.0.0');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.1.0', author: 'x' }));
      assert.strictEqual((await import(`${url.href}?m=2`)).default.version, '1.1.0');
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.strictEqual(manifest.version, pkg.version);
    assert.match(manifest.id, /^[a-z0-9][a-z0-9._-]*$/);
    for (const key of ['manifest', 'worker', 'ui']) assert.ok(fs.existsSync(path.join(ROOT, pkg.paperclipPlugin[key])), `paperclipPlugin.${key} exists`);
    assert.strictEqual(path.resolve(ROOT, manifest.entrypoints.worker), path.resolve(ROOT, pkg.paperclipPlugin.worker));
    for (const f of ['paperclip', ...pkg.paperclipPlugin.ui.replace('./', '').split('/')]) assert.ok(pkg.files.includes(f) || f === '', `${f} is published`);
    const ui = fs.readFileSync(path.join(ROOT, 'public/index.js'), 'utf8');
    for (const slot of manifest.ui.slots) assert.ok(ui.includes(`export function ${slot.exportName}(`), `UI exports ${slot.exportName}`);
    new Function('React', ui.replace(/^import .*$/m, '').replace(/^export /gm, ''));   // parses

    const w = spawn(process.execPath, [path.join(ROOT, 'paperclip/worker.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
    const replies = [];
    let buf = '';
    w.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const send = (m) => w.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    send({ id: 1, method: 'initialize', params: { manifest, config: {} } });
    send({ method: 'someNotification', params: {} });
    send({ id: 2, method: 'health', params: {} });
    send({ id: 3, method: 'getData', params: {} });
    send({ id: 4, method: 'shutdown', params: {} });
    const code = await new Promise((r) => w.on('exit', r));
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(replies.map((m) => m.id), [1, 2, 3, 4], 'one reply per request, none for notifications');
    assert.strictEqual(replies[0].result.ok, true);
    assert.strictEqual(replies[1].result.status, 'ok');
    assert.strictEqual(replies[2].error.code, -32601);
  }

  // page script parses
  const html = require('fs').readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  new Function(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')));

  // every UI language has every string English has, with the same kind (text or function)
  {
    const src = html.slice(html.indexOf('  const STR = {'), html.indexOf('  const params = new URLSearchParams'));
    const STR = new Function(`${src}; return STR;`)();
    for (const [code, block] of Object.entries(STR)) {
      for (const [k, v] of Object.entries(STR.en)) {
        assert.ok(k in block, `${code} is missing "${k}"`);
        assert.strictEqual(typeof block[k], typeof v, `${code}.${k} should be a ${typeof v}`);
      }
      assert.ok(block.summary(3, 1).includes('3') && block.needYou(2).includes('2'));
    }
    assert.ok(['en', 'tr', 'de', 'es', 'fr', 'zh', 'ar'].every((c) => STR[c]));
  }

  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
