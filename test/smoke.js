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

async function withServer(args, fn) {
  const port = 3400 + Math.floor(Math.random() * 500);
  const p = spawn(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), '--port', String(port), ...args], { stdio: 'ignore' });
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
  feed = apply(feed, { session_id: 's1', hook_event_name: 'SessionEnd' });
  assert.strictEqual(feed.agents.length, 0);
  assert.strictEqual(summarize({ tool_name: 'Bash', tool_input: { command: 'npm test' } }), 'Bash: npm test');

  // feed mode
  await withServer(['--source', path.join(ROOT, 'examples/feed.json')], async (base) => {
    assert.strictEqual((await get(`${base}/`)).status, 200);
    assert.deepStrictEqual(JSON.parse((await get(`${base}/config.json`)).body), { source: 'feed', label: 'feed.json' });
    const f = JSON.parse((await get(`${base}/api/feed`)).body);
    assert.strictEqual(f.agents.length, 4);
    assert.strictEqual((await get(`${base}/api/companies`)).status, 403);
    assert.strictEqual(await req(`${base}/api/feed`, 'POST'), 405);
  });

  // paperclip mode (no Paperclip running)
  await withServer([], async (base) => {
    assert.deepStrictEqual(JSON.parse((await get(`${base}/config.json`)).body), { source: 'paperclip', paperclipUrl: 'http://127.0.0.1:3100' });
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
