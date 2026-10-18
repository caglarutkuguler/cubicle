// The card role says where a Claude Code session was started (VS Code, terminal, desktop app, Agent SDK).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const hook = path.join(__dirname, '..', 'bin', 'cubicle-hook.js');
function run(env, ev) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-origin-'));
  fs.mkdirSync(path.join(home, '.cubicle'), { recursive: true });
  const clean = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_REMOTE', 'CUBICLE_ROLE', 'CUBICLE_NAME']) delete clean[k];
  const r = cp.spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: 's1', hook_event_name: 'UserPromptSubmit', cwd: home, prompt: 'x', ...ev }), env: { ...clean, ...env }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const feed = JSON.parse(fs.readFileSync(path.join(home, '.cubicle', 'claude-code.json'), 'utf8'));
  return feed.agents[0].role;
}
assert.strictEqual(run({ CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' }), 'Claude Code · VS Code');
assert.strictEqual(run({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), 'Claude Code · Terminal');
assert.strictEqual(run({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }), 'Claude Code · Desktop app');
assert.strictEqual(run({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }), 'Claude Code · Agent SDK');
assert.strictEqual(run({}), 'Claude Code');                                   // unknown origin: as before
assert.strictEqual(run({ CLAUDE_CODE_ENTRYPOINT: 'cli', CUBICLE_ROLE: 'Issue worker' }), 'Issue worker');   // explicit role wins
// no env: read it from the transcript
const tp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-tr-')), 't.jsonl');
fs.writeFileSync(tp, '{"type":"summary"}\n{"type":"user","entrypoint":"claude-vscode","message":"hi"}\n');
assert.strictEqual(run({}, { transcript_path: tp }), 'Claude Code · VS Code');
console.log('hook-origin: ok');
