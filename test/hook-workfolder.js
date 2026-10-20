// A session opened on one project but working in a sibling one is named after that one: edits and
// cd count, reading or temporary folders do not, and working in its own folder brings the name back.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { apply, workFolder } = require('../bin/cubicle-hook.js');

const root = fs.mkdtempSync(path.join(os.homedir(), '.cubicle-work-'));
try {
  const mk = (p, f) => { fs.mkdirSync(path.join(root, p), { recursive: true }); if (f) fs.writeFileSync(path.join(root, p, f), ''); };
  mk('Modules/accountactivation/beta/accountactivation', 'accountactivation.php');
  mk('Modules/squaremeter/beta/squaremeter', 'squaremeter.php');
  mk('Modules/onefee', 'composer.json'); mk('Modules/onefee/src');
  mk('Modules/plain/sub');
  const cwd = path.join(root, 'Modules/accountactivation/beta/accountactivation');
  const ev = (tool, input, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: 's1', cwd, tool_name: tool, tool_input: input, ...extra });
  const at = (...p) => path.join(root, 'Modules', ...p);
  assert.strictEqual(workFolder(ev('Edit', { file_path: at('squaremeter/beta/squaremeter/squaremeter.php') })), 'squaremeter', 'module folder by its <name>.php');
  assert.strictEqual(workFolder(ev('Write', { file_path: at('onefee/src/Fee.php') })), 'onefee', 'project root by a marker file');
  assert.strictEqual(workFolder(ev('Bash', { command: `cd "${at('plain/sub')}" && ls` })), 'plain', 'no marker: the first folder below the shared one');
  assert.strictEqual(workFolder(ev('Edit', { file_path: path.join(cwd, 'x.php') })), null, 'its own folder');
  assert.strictEqual(workFolder(ev('Read', { file_path: at('squaremeter/beta/squaremeter/squaremeter.php') })), undefined, 'reading does not count');
  assert.strictEqual(workFolder(ev('Bash', { command: `cd ${path.join(os.tmpdir(), 'ps16')} && ./run` })), undefined, 'temporary folders do not count');
  assert.strictEqual(workFolder(ev('Edit', { file_path: path.join(os.homedir(), 'Downloads', 'x.txt') })), undefined, 'nothing shared but home');

  // a window opened on the folder of modules: named after the module being worked on
  const top = path.join(root, 'Modules');
  const evTop = (tool, input) => ({ hook_event_name: 'PreToolUse', session_id: 's2', cwd: top, tool_name: tool, tool_input: input });
  assert.strictEqual(workFolder(evTop('Edit', { file_path: at('squaremeter/beta/squaremeter/squaremeter.php') })), 'squaremeter', 'module inside a folder of modules');
  assert.strictEqual(workFolder(evTop('Bash', { command: `cd "${at('plain/sub')}"` })), 'plain', 'first folder below, without a marker');
  assert.strictEqual(workFolder(evTop('Edit', { file_path: path.join(top, 'CLAUDE.md') })), null, 'a file of the folder itself');
  assert.strictEqual(workFolder({ ...evTop('Edit', { file_path: at('onefee/src/Fee.php') }), cwd: at('onefee') }), null, 'a project window stays its own name');

  let feed = { agents: [] };
  feed = apply(feed, { hook_event_name: 'SessionStart', session_id: 's1', cwd });
  assert.strictEqual(feed.agents[0].name, 'accountactivation');
  feed = apply(feed, ev('Edit', { file_path: at('squaremeter/beta/squaremeter/squaremeter.php') }));
  feed = apply(feed, { hook_event_name: 'Stop', session_id: 's1', cwd });
  feed = apply(feed, { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd, prompt: 'next' });
  assert.strictEqual(feed.agents[0].name, 'squaremeter', 'keeps the module name across turns');
  feed = apply(feed, ev('Edit', { file_path: path.join(cwd, 'x.php') }));
  assert.strictEqual(feed.agents[0].name, 'accountactivation', 'back in its own folder');
  feed = apply(feed, ev('Edit', { file_path: at('squaremeter/beta/squaremeter/squaremeter.php') }, { agent_id: 'sub1', agent_type: 'Explore' }));
  assert.ok(feed.agents.some((a) => a.parent === 's1'), 'subagents still get their card');
  console.log('hook-workfolder ok');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
