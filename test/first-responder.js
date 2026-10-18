// First responder: with the task box on, an agent that fails goes to the CEO (a `claude -p` run)
// before it comes to you; once per failure, never for the CEO itself, and not when turned off.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((resolve, reject) => http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(b)); }).on('error', reject));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-fix-'));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const work = path.join(dir, 'work'); fs.mkdirSync(work);
  const calls = path.join(dir, 'calls.txt');
  // a stand-in for claude: notes the task it was given and says it fixed it
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}\nconst a = process.argv.slice(2); require('fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify(a[a.indexOf('-p') + 1]) + '\\n'); console.log('Relaunched it.\\nDECISION: none');\n`);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const settings = path.join(dir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ dispatch: { enabled: true, cwd: work } }));
  const feed = path.join(dir, 'f.json');
  const write = (agents) => { fs.writeFileSync(feed + '.tmp', JSON.stringify({ agents })); fs.renameSync(feed + '.tmp', feed); };
  const worker = { id: 'w1', name: 'ncu-pch-120', status: 'running', task: { id: 'ncu-pch#120', title: 'Fix the login' } };
  write([worker, { id: 'c1', name: 'CEO', status: 'running', task: 'CEO-001 x' }]);
  const port = 3700 + Math.floor(Math.random() * 200);
  const p = spawn(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), '--port', String(port), '--source', feed, '--no-update-check'], {
    stdio: process.env.DEBUG_FIX ? 'inherit' : 'ignore', env: { ...process.env, HOME: dir, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CUBICLE_SETTINGS: settings, CUBICLE_FIX_INTERVAL: '200', CUBICLE_CLAUDE: path.join(bin, 'claude'), CUBICLE_TELEGRAM_TOKEN: '', CUBICLE_LANG: 'en' } });
  const ran = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  try {
    await sleep(1200);
    // the worker fails: the CEO gets it, with what is known
    write([{ ...worker, status: 'error', error: 'npm test exited with code 1' }, { id: 'c1', name: 'CEO', status: 'running', task: 'CEO-001 x' }]);
    await sleep(1500);
    let r = ran();
    assert.strictEqual(r.length, 1, 'handed to the CEO once');
    assert.ok(r[0].includes('[First responder]') && r[0].includes('ncu-pch-120') && r[0].includes('npm test exited with code 1') && r[0].includes('ncu-pch#120 Fix the login'), r[0]);
    assert.ok(/DECISION: <one question/.test(r[0]), 'it asks you only if it cannot fix it');
    const runs = JSON.parse(await get(`http://127.0.0.1:${port}/api/cubicle/dispatch`)).runs;
    assert.ok(runs.some((x) => /First responder/.test(x.text)), 'shows in the task box');
    // still failing: not handed again; the CEO failing: never handed to itself
    write([{ ...worker, status: 'error', error: 'npm test exited with code 1' }, { id: 'c1', name: 'CEO', status: 'error', error: 'boom', task: 'CEO-001 x' }]);
    await sleep(1200);
    assert.strictEqual(ran().length, 1, 'once per failure, and not for the CEO');
    // turned off: the failure stays with you
    fs.writeFileSync(settings, JSON.stringify({ dispatch: { enabled: true, cwd: work, fixFailures: false } }));
    write([{ ...worker, status: 'running' }]); await sleep(700);
    write([{ ...worker, status: 'error', error: 'another failure' }]); await sleep(1200);
    assert.strictEqual(ran().length, 1, 'off: no CEO run');
    console.log('first-responder ok');
  } finally { p.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
