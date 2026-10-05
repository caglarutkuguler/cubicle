'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { apply, config, roleOf } = require('../examples/agy/hook.js');
async function test() {
  for (const [product, role] of [['antigravity-cli', 'Agy CLI'], ['antigravity', 'Antigravity Desktop'], ['antigravity-ide', 'Antigravity IDE']]) {
    const input = { conversationId: product, workspacePaths: ['/work/shared'], transcriptPath: `/private/work/.gemini/${product}/transcript.jsonl` };
    const feed = apply({ agents: [] }, input, 'PreInvocation');
    assert.equal(feed.agents[0].role, role);
    assert.equal(roleOf({ artifactDirectoryPath: `C:\\work\\.gemini\\${product}\\artifacts` }), role);
    assert.ok(!JSON.stringify(feed).includes('transcript.jsonl'));
    assert.equal(apply(feed, { conversationId: product, fullyIdle: true }, 'Stop').agents[0].role, role);
  }
  assert.equal(roleOf({ transcriptPath: '/work/antigravity/repo.jsonl' }), 'Antigravity');
  assert.equal(roleOf({ transcriptPath: '/work/.gemini/toString/repo.jsonl' }), 'Antigravity');
  assert.equal(roleOf({ transcriptPath: '/work/.gemini/antigravity-cli-extra/repo.jsonl' }), 'Antigravity');
  assert.equal(roleOf({ transcriptPath: '/.gemini/antigravity/x', artifactDirectoryPath: '/.gemini/antigravity-cli/y' }), 'Antigravity');
  let combined = { agents: [] };
  for (const product of ['antigravity', 'antigravity-cli']) combined = apply(combined, { conversationId: product, workspacePaths: ['/work/shared'], transcriptPath: `/.gemini/${product}/t` }, 'PreInvocation');
  assert.equal(combined.agents.length, 2, 'Desktop and CLI conversations in one workspace stay separate');
  let f = { company: 'Agy', agents: [] };
  const input = { conversationId: 'a', workspacePaths: ['/work/project'], transcriptPath: 'PRIVATE' };
  const send = (event, extra = {}) => { f = apply(f, { ...input, ...extra }, event); };
  send('PreInvocation'); assert.equal(f.agents[0].status, 'running'); assert.equal(f.agents[0].name, 'project');
  send('PostInvocation'); assert.equal(f.agents[0].status, 'running');
  send('PostToolUse', { stepIdx: 7, error: 'PRIVATE' }); assert.equal(f.agents[0].task, 'Tool completed');
  send('Stop', { fullyIdle: false }); assert.equal(f.agents[0].status, 'running');
  send('Stop', { fullyIdle: true }); assert.equal(f.agents[0].status, 'idle');
  send('Stop', { terminationReason: 'error' }); assert.equal(f.agents[0].status, 'error');
  send('PreInvocation'); assert.equal(f.agents[0].error, null);
  assert.ok(!JSON.stringify(f).includes('PRIVATE'));
  assert.equal(apply(f, input, 'PreToolUse'), f); assert.equal(apply(f, null, 'Stop'), f);
  const c = config()['cubicle-feed']; assert.equal(c.PreToolUse, undefined);
  assert.equal(c.PostToolUse[0].matcher, '*'); assert.equal(c.Stop[0].type, 'command');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-agy-'));
  const file = path.join(dir, 'feed.json');
  const env = { ...process.env, CUBICLE_AGY_FEED: file };
  const script = path.resolve(__dirname, '../examples/agy/hook.js');
  try {
    await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, 'PreInvocation'], { env }); let out = ''; let err = '';
      child.stdout.on('data', (x) => { out += x; }); child.stderr.on('data', (x) => { err += x; });
      child.on('error', reject); child.on('close', (code) => {
        try { assert.equal(code, 0); assert.equal(out.trim(), '{}'); assert.equal(err, ''); resolve(); } catch (e) { reject(e); }
      }); child.stdin.end(JSON.stringify({ conversationId: 'c' + i }));
    })));
    assert.equal(JSON.parse(fs.readFileSync(file)).agents.length, 8);
    for (const input of ['{', 'null', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      const r = spawnSync(process.execPath, [script, 'Stop'], { env, input });
      assert.equal(r.status, 0); assert.equal(r.stdout.toString().trim(), '{}'); assert.equal(r.stderr.length, 0);
    }
    const failedWrite = spawnSync(process.execPath, [script, 'Stop'], {
      env: { ...env, CUBICLE_AGY_FEED: path.join(file, 'impossible') }, input: JSON.stringify(input),
    }); assert.equal(failedWrite.status, 0); assert.equal(failedWrite.stdout.toString().trim(), '{}');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (require.main === module) test().then(() => console.log('Agy example checks passed.')).catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = test;
