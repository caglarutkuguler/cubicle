// The work queue on GitHub, as agent workflows label it: agent:ready (waiting for a worker),
// agent:working, agent:review (a PR is open), agent:blocked-human and agent:failed. Read with the
// GitHub CLI (`gh`) already signed in on this machine; nothing is written from here.
'use strict';
const { execFile, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GH = () => process.env.CUBICLE_GH || 'gh';
function gh(args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(GH(), args, { timeout, maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, out) => {
      if (err) return resolve({ error: String(err.message || err).split('\n')[0].slice(0, 200) });
      try { resolve({ data: JSON.parse(out) }); } catch (_) { resolve({ error: 'gh gave no JSON' }); }
    });
  });
}

// owner/repo for each line of ~/agents/repos.conf ("<name> <local clone>"), from the clone's origin
function reposFromConf(file = path.join(os.homedir(), 'agents', 'repos.conf')) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const [name, dir] = line.trim().split(/\s+/);
    if (!name || name.startsWith('#') || !dir) continue;
    const r = spawnSync('git', ['-C', dir.replace(/^~(?=\/|$)/, os.homedir()), 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 5000 });
    const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/.exec(String(r.stdout || ''));
    if (m) out.push(m[1]);
  }
  return out;
}

const RED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'ERROR', 'STARTUP_FAILURE']);
const OK = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
function ciOf(rollup) {
  const checks = Array.isArray(rollup) ? rollup : [];
  if (!checks.length) return 'none';
  const st = checks.map((c) => String(c.conclusion || c.state || c.status || '').toUpperCase());
  if (st.some((s) => RED.has(s))) return 'red';
  if (st.every((s) => OK.has(s))) return 'green';
  return 'pending';
}
const failing = (rollup) => (Array.isArray(rollup) ? rollup : []).filter((c) => RED.has(String(c.conclusion || c.state || '').toUpperCase())).map((c) => c.name || c.context || '').filter(Boolean).slice(0, 6);

const ORDER = [['agent:blocked-human', 'blocked'], ['agent:failed', 'failed'], ['agent:review', 'review'], ['agent:working', 'working'], ['agent:ready', 'ready']];
async function scan(repos) {
  const items = [], errors = [];
  for (const repo of repos) {
    const [iss, prs] = await Promise.all([
      gh(['issue', 'list', '--repo', repo, '--state', 'open', '--json', 'number,title,labels,url,updatedAt', '--limit', '100']),
      gh(['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number,title,url,headRefName,headRefOid,mergeable,isDraft,statusCheckRollup', '--limit', '100']),
    ]);
    if (iss.error) { errors.push(`${repo}: ${iss.error}`); continue; }
    const prFor = new Map();
    for (const p of prs.data || []) { const m = /issue-(\d+)$/.exec(p.headRefName || ''); if (m) prFor.set(Number(m[1]), p); }
    for (const i of iss.data || []) {
      const names = (i.labels || []).map((l) => l.name);
      const hit = ORDER.find(([l]) => names.includes(l));
      if (!hit) continue;
      const p = prFor.get(i.number);
      items.push({ repo, number: i.number, title: String(i.title || '').slice(0, 200), url: i.url, state: hit[1], updatedAt: i.updatedAt,
        engine: (names.find((n) => n.startsWith('engine:')) || '').slice(7) || undefined,
        pr: p ? { number: p.number, url: p.url, sha: p.headRefOid, ci: ciOf(p.statusCheckRollup), failing: failing(p.statusCheckRollup), mergeable: p.mergeable, draft: !!p.isDraft } : null });
    }
  }
  return { items, errors };
}

module.exports = { scan, reposFromConf, ciOf, gh };
