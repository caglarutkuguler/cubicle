// Updates for the standalone server: is there a newer Cubicle on npm, how to get it here, and
// --auto-update, which keeps Cubicle running under a small supervisor that restarts it on the
// new version. The only thing sent is a plain GET for the package's latest version (no data
// about this office); --no-update-check or CUBICLE_UPDATE_CHECK=0 turns it off.
'use strict';
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PKG = '@caglarutkuguler/cubicle';
const ROOT = path.join(__dirname, '..');
const VERSION = require('../package.json').version;
// A worker asks its supervisor for an update by exiting with this code.
const UPDATE_EXIT = 75;

const parse = (v) => (/^\d+\.\d+\.\d+$/.test(String(v || '')) ? String(v).split('.').map(Number) : null);
// Whether version a is newer than b (plain x.y.z only; pre-releases are never offered).
function newer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// The latest version on npm, or null (offline, blocked, anything unexpected).
function latest(timeout = 10000) {
  const base = process.env.CUBICLE_REGISTRY || 'https://registry.npmjs.org';
  return new Promise((resolve) => {
    let u; try { u = new URL(`${base.replace(/\/$/, '')}/${PKG.replace('/', '%2f')}/latest`); } catch (_) { return resolve(null); }
    const req = (u.protocol === 'http:' ? http : https).get(u, { timeout, headers: { accept: 'application/json', 'user-agent': `cubicle/${VERSION}` } }, (r) => {
      let b = ''; r.setEncoding('utf8');
      r.on('data', (d) => { b += d; if (b.length > 256 * 1024) req.destroy(); });
      r.on('end', () => { try { const v = JSON.parse(b).version; resolve(r.statusCode === 200 && parse(v) ? v : null); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

// How this copy was installed, which decides how it is updated.
function installKind() {
  if (['git', 'npx', 'npm'].includes(process.env.CUBICLE_INSTALL_KIND)) return process.env.CUBICLE_INSTALL_KIND;
  if (fs.existsSync(path.join(ROOT, '.git'))) return 'git';
  if (/[\\/]_npx[\\/]/.test(ROOT)) return 'npx';
  return 'npm';
}
function command(kind) {
  if (kind === 'git') return `git -C ${JSON.stringify(ROOT)} pull`;
  if (kind === 'npx') return `npx ${PKG}@latest`;
  return `npm install -g ${PKG}@latest`;
}

// Checks now and then; calls onNewer(version) once per newer version found.
function watch({ every, onNewer, log = console.log }) {
  let told = '';
  const skip = process.env.CUBICLE_SKIP_VERSION || '';
  const check = async () => {
    const v = await latest();
    if (v && newer(v, VERSION) && v !== skip && v !== told) { told = v; onNewer(v); }
  };
  const first = setTimeout(check, Number(process.env.CUBICLE_UPDATE_FIRST || 20000)); first.unref();
  const timer = setInterval(check, every); timer.unref();
  return { stop() { clearTimeout(first); clearInterval(timer); } };
}

// --auto-update: run Cubicle as a child and start it again on the new version whenever it asks.
// npm/npx installs run the new version through npx; a git clone fast-forwards and runs again.
// If an update cannot be applied, the same version goes on running and that version is skipped.
function supervise(argv) {
  const args = argv.filter((a) => a !== '--auto-update');
  const kind = installKind();
  let version = null, skip = '', child = null, stopping = false, quick = 0;
  const log = (m) => console.log(`Cubicle auto-update: ${m}`);
  const run = () => {
    const env = { ...process.env, CUBICLE_WORKER: '1', CUBICLE_INSTALL_KIND: kind, ...(skip ? { CUBICLE_SKIP_VERSION: skip } : {}) };
    const viaNpx = version && kind !== 'git';
    const win = process.platform === 'win32';
    child = viaNpx
      ? spawn(process.env.CUBICLE_NPX || (win ? 'npx.cmd' : 'npx'), ['-y', `${PKG}@${version}`, ...args], { stdio: 'inherit', env, shell: win })
      : spawn(process.execPath, [path.join(__dirname, 'cubicle.js'), ...args], { stdio: 'inherit', env });
    const started = Date.now();
    child.on('error', (e) => { log(`could not start (${e.message})`); if (viaNpx) { skip = version; version = null; setTimeout(run, 2000); } else process.exit(1); });
    child.on('exit', async (code, signal) => {
      if (stopping) return process.exit(code ?? 0);
      if (code !== UPDATE_EXIT) {
        // a new version that dies at once: go back to the one that ran before
        if (viaNpx && Date.now() - started < 30000 && ++quick <= 2) { log(`${version} stopped at once; going back`); skip = version; version = null; return setTimeout(run, 2000); }
        return process.exit(code ?? (signal ? 1 : 0));
      }
      const v = await latest();
      if (!v) { log('npm could not be reached; carrying on'); return setTimeout(run, 1000); }
      if (kind === 'git') {
        const dirty = spawnSync('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
        const pull = !dirty.error && !String(dirty.stdout || '').trim() && spawnSync('git', ['-C', ROOT, 'pull', '--ff-only', '--quiet'], { stdio: 'inherit' });
        if (!pull || pull.status !== 0) { log(`could not fast-forward ${ROOT}; staying on this version`); skip = v; }
        else log(`updated the clone (npm has ${v})`);
      } else { log(`starting ${v}`); version = v; skip = ''; }
      quick = 0;
      setTimeout(run, 500);
    });
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = true; if (child) child.kill(sig); else process.exit(0); });
  log(`on (${kind} install); Cubicle restarts on a new version by itself`);
  run();
}

// "Update now", from the page or Telegram. Gets the new version in place and says how this process
// should then go: exit with UPDATE_EXIT for a supervisor (--auto-update) or a service manager that
// starts it again (systemd, launchd), or start the new version itself and exit. Never two at once:
// the replacement starts only after this process has let go of the port.
const managed = () => !!(process.env.INVOCATION_ID || process.env.JOURNAL_STREAM || (process.env.XPC_SERVICE_NAME && process.env.XPC_SERVICE_NAME !== '0') || process.env.CUBICLE_SERVICE === '1');
function canApply(kind, auto) { return auto || !(kind === 'npx' && managed()); }
function prepare({ kind, version, auto, argv, log = console.log }) {
  if (auto) return { ok: true, exitCode: UPDATE_EXIT };
  if (!canApply(kind, auto)) return { ok: false, error: 'service', command: command(kind) };
  const win = process.platform === 'win32';
  const logFile = path.join(require('os').homedir(), '.cubicle', 'server.log');
  const relaunch = (cmd, args) => () => {
    let out = 'ignore';
    try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); out = fs.openSync(logFile, 'a'); } catch (_) {}
    const c = spawn(cmd, args, { detached: true, stdio: ['ignore', out, out], windowsHide: true, shell: win && /npx/.test(cmd), env: { ...process.env, CUBICLE_UPDATE_FIRST: '600000' } });
    c.unref();
  };
  const self = relaunch(process.execPath, [process.argv[1], ...argv]);
  const viaNpx = relaunch(process.env.CUBICLE_NPX || (win ? 'npx.cmd' : 'npx'), ['-y', `${PKG}@${version}`, ...argv]);
  if (kind === 'git') {
    const dirty = spawnSync('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', timeout: 20000 });
    if (dirty.error || String(dirty.stdout || '').trim()) return { ok: false, error: 'git', command: command(kind) };
    const pull = spawnSync('git', ['-C', ROOT, 'pull', '--ff-only', '--quiet'], { encoding: 'utf8', timeout: 120000 });
    if (pull.error || pull.status !== 0) return { ok: false, error: 'git', command: command(kind) };
    log(`Cubicle: updated the clone at ${ROOT}.`);
    return managed() ? { ok: true, exitCode: UPDATE_EXIT } : { ok: true, exitCode: 0, restart: self };
  }
  if (kind === 'npm') {
    const r = spawnSync(win ? 'npm.cmd' : 'npm', ['install', '-g', `${PKG}@${version}`], { encoding: 'utf8', timeout: 300000, shell: win });
    if (!r.error && r.status === 0) { log(`Cubicle: installed ${version} globally.`); return managed() ? { ok: true, exitCode: UPDATE_EXIT } : { ok: true, exitCode: 0, restart: self }; }
    if (managed()) return { ok: false, error: 'npm', command: command(kind) };
    log(`Cubicle: npm install -g failed; starting ${version} through npx instead.`);
    return { ok: true, exitCode: 0, restart: viaNpx };
  }
  return { ok: true, exitCode: 0, restart: viaNpx };   // npx: the new version is fetched as it starts
}

module.exports = { PKG, UPDATE_EXIT, newer, latest, installKind, command, watch, supervise, canApply, prepare };
