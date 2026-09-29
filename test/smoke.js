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
  const p = spawn(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), '--port', String(port), ...args], { stdio: 'ignore', env: { ...process.env, ...env } });
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
    assert.ok(['en', 'tr', 'de', 'es', 'fr'].every((c) => STR[c]));
  }

  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
