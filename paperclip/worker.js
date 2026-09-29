#!/usr/bin/env node
// Paperclip plugin worker for Cubicle. Cubicle's plugin is UI only: the office reads
// Paperclip's API from the browser, so the worker has nothing to do but answer the host's
// lifecycle calls. It speaks Paperclip's worker protocol (JSON-RPC 2.0, one message per
// line on stdin/stdout) directly, so the package stays free of dependencies.
'use strict';
const readline = require('readline');

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const fail = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

const handlers = {
  initialize: () => ({ ok: true, supportedMethods: ['health', 'shutdown'] }),
  health: () => ({ status: 'ok', message: 'Cubicle is UI only; nothing to check' }),
  shutdown: () => { setImmediate(() => process.exit(0)); return null; },
};

function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch (_) { return; }
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return;   // responses, garbage
  if (msg.id === undefined || msg.id === null) return;                            // notifications need no answer
  const fn = handlers[msg.method];
  if (!fn) return fail(msg.id, -32601, `Unknown method: ${msg.method}`);
  try { reply(msg.id, fn(msg.params)); } catch (e) { fail(msg.id, -32603, String(e && e.message || e)); }
}

if (require.main === module) {
  readline.createInterface({ input: process.stdin }).on('line', handle).on('close', () => process.exit(0));
}
module.exports = { handle };
