// The KPI board without Paperclip: a task you give the CEO becomes a row; the GitHub issues its run
// opened are its subtasks, and their state (from gh) makes its progress. Paperclip's tasks can be
// imported once, without the CEO tasks that are kept here.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const req = (url, method = 'GET', body) => new Promise((resolve, reject) => {
  const q = http.request(url, { method, headers: { 'content-type': 'application/json', 'x-cubicle': '1' } }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ status: r.statusCode, data: b ? JSON.parse(b) : null })); });
  q.on('error', reject); q.end(body ? JSON.stringify(body) : undefined);
});

(async () => {
  // the module alone: import keeps Paperclip's history, minus a CEO task that is kept locally
  const { create } = require('../bin/cubicle-kpi.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-kpi-'));
  const k = create({ file: path.join(tmp, 'kpi.json'), gh: async () => ({ data: { title: 'Fix login', state: 'OPEN', labels: [{ name: 'agent:review' }], createdAt: '2026-10-19T10:00:00Z' } }) });
  const n = await k.importPaperclip('http://pc', async (u) => (u.endsWith('/api/companies') ? [{ id: 'c' }]
    : [{ id: 'p1', identifier: 'MEG-1', title: 'Old task', status: 'done', createdByUserId: 'u', createdAt: '2026-10-01T00:00:00Z', completedAt: '2026-10-02T00:00:00Z' },
       { id: 'p2', identifier: 'MEG-2', title: '[CEO · done] Mirror', status: 'done', createdByUserId: 'u' },
       { id: 'p3', identifier: 'MEG-3', title: 'Still open there', status: 'in_progress', createdByUserId: 'u' }]));
  assert.strictEqual(n, 3);
  fs.writeFileSync(path.join(tmp, 'CEO-001.log'), 'Opened https://github.com/o/r/issues/7 and started a worker.\nDECISION: none\n');
  k.record({ id: 'CEO-001', text: 'Fix the login page', state: 'done', started: Date.now() - 3600000, ended: Date.now() - 1800000, logFile: path.join(tmp, 'CEO-001.log'), pcId: 'p2' });
  await k.refresh();
  const rows = k.list();
  const root = rows.find((r) => r.id === 'ceo:CEO-001'), kid = rows.find((r) => r.id === 'gh:o/r#7');
  assert.ok(root && root.human && root.status === 'in_progress', JSON.stringify(root));
  assert.ok(kid && kid.parentId === 'ceo:CEO-001' && kid.status === 'in_review' && kid.identifier === 'r#7', JSON.stringify(kid));
  assert.ok(rows.some((r) => r.id === 'p1' && r.imported), 'Paperclip history kept');
  assert.ok(!rows.some((r) => r.id === 'p3'), 'work left open in Paperclip cannot move any more: not shown');
  assert.ok(!rows.some((r) => r.id === 'p2'), 'the CEO mirror is shown from here, not twice');
  // an answer to its question adds what it opened to the same task, and a later answer too
  fs.writeFileSync(path.join(tmp, 'CEO-002.log'), 'Relaunched https://github.com/o/r/issues/8\nDECISION: Merge now?\n');
  k.record({ id: 'CEO-002', text: 'Daha önce sana bir karar soruldu. SORU/DURUM: x', answerTo: 'CEO-001', state: 'done', started: Date.now(), ended: Date.now(), logFile: path.join(tmp, 'CEO-002.log') });
  fs.writeFileSync(path.join(tmp, 'CEO-003.log'), 'Merged https://github.com/o/r/issues/9\nDECISION: none\n');
  k.record({ id: 'CEO-003', text: 'Daha önce sana bir karar soruldu. SORU/DURUM: y', answerTo: 'CEO-002', state: 'done', started: Date.now(), ended: Date.now(), logFile: path.join(tmp, 'CEO-003.log') });
  k.record({ id: 'CEO-004', text: 'You were asked for a decision earlier. QUESTION/SITUATION: z', state: 'done', started: Date.now(), ended: Date.now() });
  await k.refresh(0);
  const rows3 = k.list(), roots3 = rows3.filter((r) => r.human && !r.parentId && !r.imported);
  assert.deepStrictEqual(roots3.map((r) => r.identifier), ['CEO-001'], 'answers are not tasks of their own');
  assert.deepStrictEqual(rows3.filter((r) => r.parentId === 'ceo:CEO-001').map((r) => r.identifier).sort(), ['r#7', 'r#8', 'r#9']);

  // through the server: no Paperclip, the task box on: the page gets kpiLocal and the rows
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-kpis-'));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}\nconsole.log('Created https://github.com/o/r/issues/9\\nDECISION: none');\n`);
  fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}\nconst a = process.argv.slice(2); if (a[0] === 'issue' && a[1] === 'view') console.log(JSON.stringify({ title: 'Ship it', state: 'CLOSED', stateReason: 'COMPLETED', labels: [], createdAt: '2026-10-20T08:00:00Z', closedAt: '2026-10-20T09:00:00Z' })); else console.log('[]');\n`);
  for (const f of ['gh', 'claude']) fs.chmodSync(path.join(bin, f), 0o755);
  const settings = path.join(dir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ dispatch: { enabled: true, cwd: dir }, github: { enabled: false } }));
  const feed = path.join(dir, 'f.json'); fs.writeFileSync(feed, '{"agents":[]}');
  const port = 4000 + Math.floor(Math.random() * 90);
  const p = spawn(process.execPath, [path.join(ROOT, 'bin/cubicle.js'), '--port', String(port), '--source', feed, '--no-update-check'], { stdio: 'ignore',
    env: { ...process.env, HOME: dir, CUBICLE_SETTINGS: settings, CUBICLE_GH: path.join(bin, 'gh'), CUBICLE_CLAUDE: path.join(bin, 'claude'), CUBICLE_TELEGRAM_TOKEN: '', CUBICLE_LANG: 'en' } });
  try {
    await sleep(1200);
    const base = `http://127.0.0.1:${port}`;
    assert.strictEqual((await req(`${base}/config.json`)).data.kpiLocal, true, 'the page shows the KPI button');
    const r = await req(`${base}/api/cubicle/dispatch`, 'POST', { text: 'Ship the release' });
    assert.ok(r.status === 200 || r.status === 202, JSON.stringify(r));
    await sleep(1500);
    const rows2 = (await req(`${base}/api/kpi/local`)).data;
    const t = rows2.find((x) => x.human), c = rows2.find((x) => x.parentId === (t && t.id));
    assert.ok(t && /Ship the release/.test(t.title) && t.status === 'done', JSON.stringify(rows2));
    assert.ok(c && c.status === 'done' && c.title === 'Ship it', JSON.stringify(rows2));
    console.log('kpi-local ok');
  } finally { p.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
