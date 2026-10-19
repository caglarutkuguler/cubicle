// The GitHub queue: what waits for you is listed, and with github.autoMerge the CEO gets each
// review PR once: green to review and merge, red to send back; no CI stays with you.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((resolve, reject) => http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(JSON.parse(b))); }).on('error', reject));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-gh-'));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const work = path.join(dir, 'work'); fs.mkdirSync(work);
  const calls = path.join(dir, 'calls.txt');
  const L = (n) => ({ name: n });
  const issues = [
    { number: 1, title: 'Green one', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-10-19T10:00:00Z', labels: [L('agent:review'), L('engine:claude')] },
    { number: 2, title: 'Red one', url: 'https://github.com/o/r/issues/2', updatedAt: '2026-10-19T10:00:00Z', labels: [L('agent:review')] },
    { number: 3, title: 'Needs a call', url: 'https://github.com/o/r/issues/3', updatedAt: '2026-10-19T10:00:00Z', labels: [L('agent:blocked-human')] },
    { number: 4, title: 'No CI', url: 'https://github.com/o/r/issues/4', updatedAt: '2026-10-19T10:00:00Z', labels: [L('agent:review')] },
    { number: 5, title: 'Next up', url: 'https://github.com/o/r/issues/5', updatedAt: '2026-10-19T10:00:00Z', labels: [L('agent:ready')] },
    { number: 6, title: 'Not ours', url: 'https://github.com/o/r/issues/6', updatedAt: '2026-10-19T10:00:00Z', labels: [L('bug')] },
  ];
  const ok = (n) => ({ name: n, conclusion: 'SUCCESS' });
  const prs = [
    { number: 11, title: 'p1', url: 'https://github.com/o/r/pull/11', headRefName: 'agent/issue-1', headRefOid: 'aaa', mergeable: 'MERGEABLE', isDraft: false, statusCheckRollup: [ok('unit'), ok('lint')] },
    { number: 12, title: 'p2', url: 'https://github.com/o/r/pull/12', headRefName: 'agent/issue-2', headRefOid: 'bbb', mergeable: 'MERGEABLE', isDraft: false, statusCheckRollup: [ok('unit'), { name: 'migrations', conclusion: 'FAILURE' }] },
    { number: 14, title: 'p4', url: 'https://github.com/o/r/pull/14', headRefName: 'agent/issue-4', headRefOid: 'ddd', mergeable: 'MERGEABLE', isDraft: false, statusCheckRollup: [] },
  ];
  fs.writeFileSync(path.join(dir, 'issues.json'), JSON.stringify(issues)); fs.writeFileSync(path.join(dir, 'prs.json'), JSON.stringify(prs));
  fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}\nconst a = process.argv.slice(2); process.stdout.write(require('fs').readFileSync(${JSON.stringify(dir)} + (a[0] === 'issue' ? '/issues.json' : '/prs.json'), 'utf8'));\n`);
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}\nconst a = process.argv.slice(2); require('fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify(a[a.indexOf('-p') + 1]) + '\\n'); const t = a[a.indexOf('-p') + 1]; console.log(t.includes('[Prepare a decision]') ? 'It needs a staging DB.\\n1. Open the staging console\\n\\x60\\x60\\x60\\nnpm run seed\\n\\x60\\x60\\x60\\nDECISION: Reseed staging now?\\nOPTIONS: Yes, reseed | Wait until Friday' : 'DECISION: none');\n`);
  for (const f of ['gh', 'claude']) fs.chmodSync(path.join(bin, f), 0o755);
  const settings = path.join(dir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ dispatch: { enabled: true, cwd: work }, github: { repos: 'o/r', autoMerge: true } }));
  const feed = path.join(dir, 'f.json'); fs.writeFileSync(feed, '{"agents":[]}');
  const port = 3900 + Math.floor(Math.random() * 90);
  const p = spawn(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), '--port', String(port), '--source', feed, '--no-update-check'], { stdio: 'ignore',
    env: { ...process.env, HOME: dir, CUBICLE_SETTINGS: settings, CUBICLE_GH: path.join(bin, 'gh'), CUBICLE_CLAUDE: path.join(bin, 'claude'), CUBICLE_GITHUB_FIRST: '300', CUBICLE_GITHUB_INTERVAL: '700', CUBICLE_TELEGRAM_TOKEN: '', CUBICLE_LANG: 'en' } });
  const ran = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  try {
    await sleep(2500);
    const q = await get(`http://127.0.0.1:${port}/api/cubicle/github`);
    assert.ok(q.enabled && q.autoMerge);
    const by = Object.fromEntries(q.items.map((it) => [it.number, it]));
    assert.deepStrictEqual(Object.keys(by).map(Number), [1, 2, 3, 4, 5], 'only agent:* work');
    assert.deepStrictEqual([1, 2, 3, 4, 5].map((n) => by[n].forYou), [false, false, true, true, false], 'yours: the decision and the PR without CI');
    assert.deepStrictEqual([by[1].pr.ci, by[2].pr.ci, by[4].pr.ci], ['green', 'red', 'none']);
    assert.deepStrictEqual(by[2].pr.failing, ['migrations']);
    await sleep(1500);   // more scans: each PR goes to the CEO once
    await sleep(1500);
    const r = ran();
    assert.strictEqual(r.length, 3, r.map((x) => x.slice(0, 40)).join(' | '));
    // the decision waiting on GitHub is prepared by the CEO and comes as a question here
    assert.ok(r.some((x) => x.includes('[Prepare a decision] Issue #3 in o/r') && x.includes('gh issue view 3 --repo o/r --comments')));
    const q2 = await get(`http://127.0.0.1:${port}/api/cubicle/github`);
    const b3 = q2.items.find((it) => it.number === 3);
    assert.strictEqual(b3.brief, 'ready'); assert.ok(b3.question);
    const att = (await get(`http://127.0.0.1:${port}/api/cubicle/attention`)).find((x) => x.id === b3.question);
    assert.ok(att && att.ref === 'o/r#3' && att.url === 'https://github.com/o/r/issues/3' && att.title === 'r#3: Needs a call', JSON.stringify(att));
    assert.deepStrictEqual(att.options, ['Yes, reseed', 'Wait until Friday']); assert.ok(att.detail.includes('npm run seed'));
    assert.ok(r.some((x) => x.includes('[Review and merge] PR #11') && x.includes('gh pr merge 11 --repo o/r --squash --delete-branch')));
    assert.ok(r.some((x) => x.includes('[Fix the PR] PR #12') && x.includes('migrations')));
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'github-handed.json'), 'utf8')).includes('o/r#11@aaa'), 'remembered across restarts');
    console.log('github-queue ok');
  } finally { p.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
