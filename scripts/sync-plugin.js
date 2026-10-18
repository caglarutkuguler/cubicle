#!/usr/bin/env node
// Keeps the Claude plugin (plugin/) in step with the package: the same hook script, the same
// version, a hook for every event. Run before a release: `node scripts/sync-plugin.js`.
// `--check` only reports differences (the tests use it).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const check = process.argv.includes('--check');
const { EVENTS } = require('../bin/cubicle-hook.js');
const version = require('../package.json').version;
const want = {
  'plugin/hooks/cubicle-hook.js': fs.readFileSync(path.join(ROOT, 'bin/cubicle-hook.js'), 'utf8'),
  'plugin/.claude-plugin/plugin.json': (() => { const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin/.claude-plugin/plugin.json'), 'utf8')); p.version = version; return JSON.stringify(p, null, 2) + '\n'; })(),
  'plugin/hooks/hooks.json': (() => {
    const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin/hooks/hooks.json'), 'utf8'));
    h.hooks = {};
    for (const e of EVENTS) h.hooks[e] = [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/cubicle-hook.js"', timeout: 5 }] }];
    return JSON.stringify(h, null, 2) + '\n';
  })(),
};
const stale = Object.keys(want).filter((f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8') !== want[f]; } catch (_) { return true; } });
if (check) { if (stale.length) { console.error(`plugin/ is out of step with the package: ${stale.join(', ')}. Run: node scripts/sync-plugin.js`); process.exit(1); } console.log('plugin in step'); }
else { for (const f of stale) fs.writeFileSync(path.join(ROOT, f), want[f]); console.log(stale.length ? `updated ${stale.join(', ')}` : 'plugin already in step'); }
