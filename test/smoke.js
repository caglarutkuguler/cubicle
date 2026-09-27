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
  http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ status: r.statusCode, body: b })); }).on('error', reject);
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

  // paperclip mode (no Paperclip running)
  await withServer([], async (base) => {
    const cfg = JSON.parse((await get(`${base}/config.json`)).body);
    assert.strictEqual(cfg.source, 'paperclip'); assert.strictEqual(cfg.paperclipUrl, 'http://127.0.0.1:3100');
    assert.strictEqual((await get(`${base}/api/feed`)).status, 404);
    assert.strictEqual((await get(`${base}/api/companies/x/secrets`)).status, 403);
    assert.strictEqual((await get(`${base}/api/companies`)).status, 502);
    assert.strictEqual(await req(`${base}/api/companies`, 'DELETE'), 405);
  });

  // page script parses
  const html = require('fs').readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  new Function(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')));

  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
