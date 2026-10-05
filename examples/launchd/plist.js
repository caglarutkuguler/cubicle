#!/usr/bin/env node
// Generate a LaunchAgent on stdout. Does not install, start or stop anything.
'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const xml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function generate({ node = process.execPath, cubicle = path.resolve(__dirname, '../..'),
  source = 'claude-code,codex,gemini', port = 3200, label = 'io.cubicle.office',
  logs = path.join(os.homedir(), 'Library', 'Logs', 'Cubicle') } = {}) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/.test(label)) throw new Error('Label must contain only letters, numbers, dots and hyphens.');
  for (const [name, value] of Object.entries({ node, cubicle, logs })) {
    if (!path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw new Error(`${name} must be an absolute path without control characters.`);
  }
  if (!source || /[\x00-\x1f]/.test(source)) throw new Error('Source must be nonempty and contain no control characters.');
  if (!fs.existsSync(node) || !fs.existsSync(path.join(cubicle, 'bin', 'cubicle.js'))) throw new Error('Node executable and Cubicle checkout must exist.');
  const args = [node, path.join(cubicle, 'bin', 'cubicle.js'), '--host', '127.0.0.1', '--port', String(port), '--source', source];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>
${args.map((s) => `    <string>${xml(s)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(cubicle)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(path.join(logs, label + '.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logs, label + '.error.log'))}</string>
</dict></plist>
`;
}
function main(args) {
  if (args.includes('--help')) { console.log('Usage: node examples/launchd/plist.js [--port 3232] [--source claude-code,codex,gemini] [--label io.cubicle.office] [--node /absolute/node] [--cubicle /absolute/checkout] [--logs /absolute/logs]'); return; }
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (!['--port', '--source', '--label', '--node', '--cubicle', '--logs'].includes(flag) || !args.length) throw new Error('Unknown option or missing value: ' + flag);
    options[flag.slice(2)] = args.shift();
  }
  process.stdout.write(generate(options));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { generate };
