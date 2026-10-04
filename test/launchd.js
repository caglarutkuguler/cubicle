'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generate } = require('../examples/launchd/plist.js');
function test() {
  const output = generate({ port: 3232, source: '/tmp/a & b/feed.json', logs: '/tmp/logs with spaces' });
  assert.match(output, /<string>3232<\/string>/);
  assert.match(output, /<string>127\.0\.0\.1<\/string>/);
  assert.match(output, /a &amp; b/);
  assert.match(output, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(output, /<key>KeepAlive<\/key><true\/>/);
  for (const port of [0, 65536, 1.2, 'abc']) assert.throws(() => generate({ port }));
  assert.throws(() => generate({ node: 'node' }));
  assert.throws(() => generate({ label: '../other' }));
  assert.throws(() => generate({ source: 'line\nbreak' }));
  if (process.platform === 'darwin') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-plist-'));
    try {
      const file = path.join(dir, 'office.plist'); fs.writeFileSync(file, output);
      const result = spawnSync('plutil', ['-lint', file]); assert.equal(result.status, 0, result.stderr.toString());
      const parsed = spawnSync('plutil', ['-convert', 'json', '-o', '-', file]);
      const plist = JSON.parse(parsed.stdout);
      assert.deepEqual(plist.ProgramArguments.slice(-4), ['--port', '3232', '--source', '/tmp/a & b/feed.json']);
      assert.equal(plist.RunAtLoad, true); assert.equal(plist.KeepAlive, true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}
if (require.main === module) { test(); console.log('LaunchAgent example checks passed.'); }
module.exports = test;
