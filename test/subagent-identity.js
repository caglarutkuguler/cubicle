#!/usr/bin/env node
// One card per CUBICLE_NAME (a single CEO), subagents named by type and numbered when
// concurrent, and the CUBICLE_LINGER / 12 h stale contract (#31): `node test/subagent-identity.js`
'use strict';
const assert = require('assert');
const { apply } = require('../bin/cubicle-hook.js');

const H = 60 * 60 * 1000;

module.exports = async function subagentIdentity() {
  // two SessionStarts with the same CUBICLE_NAME collapse to the newer card, even while the older runs
  {
    const ceo = { CUBICLE_NAME: 'CEO', CUBICLE_ROLE: 'CEO' };
    let f = { company: 'Claude Code', agents: [] };
    f = apply(f, { session_id: 'c1', hook_event_name: 'SessionStart' }, 'claude', ceo);
    f = apply(f, { session_id: 'c1', hook_event_name: 'UserPromptSubmit', prompt: 'plan the week' }, 'claude', ceo);
    f = apply(f, { session_id: 'c1', hook_event_name: 'SubagentStart', agent_id: 'p', agent_type: 'planner' }, 'claude', ceo);
    assert.strictEqual(f.agents.find((a) => a.id === 'c1').status, 'running');
    f = apply(f, { session_id: 'c2', hook_event_name: 'SessionStart' }, 'claude', ceo);
    assert.deepStrictEqual(f.agents.map((a) => a.id), ['c2'], 'one CEO card, the newer one, without the old subagents');
    // a waiting older card is replaced too
    f = apply(f, { session_id: 'c2', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }, 'claude', ceo);
    f = apply(f, { session_id: 'c3', hook_event_name: 'SessionStart' }, 'claude', ceo);
    assert.deepStrictEqual(f.agents.map((a) => a.id), ['c3']);
    // sessions without CUBICLE_NAME are never collapsed by directory name
    let g = { company: 'Claude Code', agents: [] };
    g = apply(g, { session_id: 'x1', cwd: '/r/app', hook_event_name: 'SessionStart' });
    g = apply(g, { session_id: 'x2', cwd: '/r/app', hook_event_name: 'SessionStart' });
    assert.strictEqual(g.agents.length, 2);
  }

  // subagents: named by type; concurrent same-type siblings numbered from the active ones only
  {
    let f = { company: 'Claude Code', agents: [] };
    const ev = (e) => { f = apply(f, { session_id: 's', cwd: '/r/app', ...e }); };
    const name = (id) => (f.agents.find((a) => a.id === `s:${id}`) || {}).name;
    ev({ hook_event_name: 'SessionStart' });
    ev({ hook_event_name: 'SubagentStart', agent_id: 'p1', agent_type: 'planner' });
    assert.strictEqual(name('p1'), 'Planner', 'a lone planner stays unnumbered');
    assert.strictEqual(f.agents.find((a) => a.id === 's:p1').role, 'Planner · app');
    ev({ hook_event_name: 'SubagentStart', agent_id: 'p2', agent_type: 'planner' });
    assert.strictEqual(name('p1'), 'Planner-1');
    assert.strictEqual(name('p2'), 'Planner-2');
    ev({ hook_event_name: 'SubagentStart', agent_id: 'e1', agent_type: 'Explore' });
    assert.strictEqual(name('e1'), 'Explore', 'other types are counted apart');
    // after a burst the numbers are reused, not climbing
    ev({ hook_event_name: 'SubagentStop', agent_id: 'p1' });
    ev({ hook_event_name: 'SubagentStart', agent_id: 'p3', agent_type: 'planner' });
    assert.strictEqual(name('p3'), 'Planner-1');
    ev({ hook_event_name: 'SubagentStop', agent_id: 'p2' });
    ev({ hook_event_name: 'SubagentStop', agent_id: 'p3' });
    ev({ hook_event_name: 'SubagentStart', agent_id: 'p4', agent_type: 'planner' });
    assert.strictEqual(name('p4'), 'Planner');
    // another session's planners are not siblings
    f = apply(f, { session_id: 't', cwd: '/r/web', hook_event_name: 'SubagentStart', agent_id: 'q1', agent_type: 'planner' });
    assert.strictEqual(f.agents.find((a) => a.id === 't:q1').name, 'Planner');
    assert.strictEqual(name('p4'), 'Planner');
  }

  // stale pruning and CUBICLE_LINGER
  {
    const linger = { CUBICLE_NAME: 'worker #7', CUBICLE_LINGER: '1' };
    let f = { company: 'Claude Code', agents: [] };
    f = apply(f, { session_id: 'idle', cwd: '/r/a', hook_event_name: 'SessionStart' });
    f = apply(f, { session_id: 'w', hook_event_name: 'SessionStart' }, 'claude', linger);
    f = apply(f, { session_id: 'w', hook_event_name: 'Stop' }, 'claude', linger);
    f = apply(f, { session_id: 'w', hook_event_name: 'SessionEnd' }, 'claude', linger);
    assert.ok(f.agents.find((a) => a.id === 'w'), 'a lingering worker survives SessionEnd');
    // (a) a non-linger idle card older than the stale limit is pruned on the next apply
    f.agents.find((a) => a.id === 'idle').updated = Date.now() - 13 * H;
    f.agents.find((a) => a.id === 'w').updated = Date.now() - 11 * H;
    f = apply(f, { session_id: 'other', cwd: '/r/b', hook_event_name: 'SessionStart' });
    assert.ok(!f.agents.find((a) => a.id === 'idle'), 'stale idle card pruned');
    assert.ok(f.agents.find((a) => a.id === 'w'), 'lingering worker still within 12 h');
    // (b) the lingering card goes once the stale limit has passed
    f.agents.find((a) => a.id === 'w').updated = Date.now() - 13 * H;
    f = apply(f, { session_id: 'other', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/r/b/x' } });
    assert.ok(!f.agents.find((a) => a.id === 'w'), 'lingering worker pruned after 12 h');
  }
  console.log('subagent identity ok');
};

if (require.main === module) module.exports().catch((e) => { console.error(e); process.exit(1); });
