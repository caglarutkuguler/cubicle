'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { apply } = require('../bin/cubicle-hook.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await check()) return; await sleep(15); }
  assert.fail('timed out waiting for the notification fixture');
}
function request(url, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const q = http.request(url, { method, headers: { 'content-type': 'application/json', 'x-cubicle': '1' } }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; });
      r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(b) }));
    });
    q.on('error', reject); q.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('completion alerts follow the existing per-chat filters, mutes and access policy', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-notify-'));
  const stateFile = path.join(dir, 'state.json'), settingsFile = path.join(dir, 'settings.json'), feedFile = path.join(dir, 'feed.json');
  fs.writeFileSync(stateFile, JSON.stringify({ code: '123456', chats: {
    101: { lang: 'en' }, 102: { lang: 'en', only: 'questions' }, 103: { lang: 'en', only: 'failures' },
    104: { lang: 'tr', only: 'all', muted: ['feed agent'] }, 105: { lang: 'en' }, '-900': { lang: 'en' },
  } }));
  const allowedUsers = ['101', '102', '103', '104'];
  fs.writeFileSync(settingsFile, JSON.stringify({ allowEveryone: false, allowedUsers }));
  const run = (id, status, startedAt) => ({ id, agentId: 'p1', status, startedAt, finishedAt: status === 'running' ? null : startedAt });
  let agent = { id: 'f1', name: 'Feed agent', status: 'idle', completedAt: 1000 }, runs = [run('old', 'succeeded', '2026-10-04T11:00:00Z')];
  let watches = 0, uid = 0, child, rejectCompletion = false, releaseCompletion = null;
  const sent = [], attempts = [], updates = [];
  const completed = (messages) => messages.filter((m) => /finished its work|işini tamamladı/.test(m.text));
  const writeFeed = () => fs.writeFileSync(feedFile, JSON.stringify({ agents: [agent] }));
  writeFeed();
  const mock = http.createServer((q, r) => {
    let raw = ''; q.on('data', (d) => { raw += d; }); q.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}, json = (data) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(data)); };
      if (q.url === '/botT0K/getUpdates') return setTimeout(() => json({ ok: true, result: updates.filter((u) => u.update_id >= (body.offset || 0)) }), 15);
      if (q.url === '/botT0K/sendMessage') {
        attempts.push(body);
        if (rejectCompletion && completed([body]).length) {
          rejectCompletion = false;
          releaseCompletion = () => { r.statusCode = 400; json({ ok: false }); };
          return;
        }
        sent.push(body); return json({ ok: true, result: { message_id: sent.length } });
      }
      if (q.url === '/api/companies') return json([{ id: 'c', name: 'Test', issuePrefix: 'T' }]);
      if (q.url === '/api/companies/c/agents') { watches++; return json([{ id: 'p1', name: 'Paperclip agent', status: 'idle' }]); }
      if (q.url === '/api/companies/c/issues') return json([]);
      if (q.url.startsWith('/api/companies/c/heartbeat-runs')) return json(runs);
      return json([]);
    });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise((resolve) => reserve.close(resolve));
  const base = `http://127.0.0.1:${port}`, api = `${base}/api/telegram`;
  const stop = async () => { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } };
  t.after(async () => { if (releaseCompletion) releaseCompletion(); await stop(); await new Promise((resolve) => mock.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const start = async () => {
    child = spawn(process.execPath, [path.join(__dirname, '../bin/cubicle.js'), '--port', String(port), '--source', `paperclip,${feedFile}`, '--paperclip', mockUrl, '--appearance', path.join(dir, 'appearance.json')], {
      stdio: 'ignore', env: { ...process.env, CUBICLE_TELEGRAM_TOKEN: 'T0K', CUBICLE_TELEGRAM_TOKEN_FILE: '', CUBICLE_TELEGRAM_CHAT: '',
        CUBICLE_TELEGRAM_SETTINGS: settingsFile, CUBICLE_TELEGRAM_STATE: stateFile, CUBICLE_TELEGRAM_API: mockUrl, CUBICLE_TELEGRAM_POLL: '0', CUBICLE_TELEGRAM_INTERVAL: '25' },
    });
    await until(async () => { try { return (await request(api)).data.polling === 'ok'; } catch (_) { return false; } });
  };
  const settle = async () => { const before = watches; await until(() => watches >= before + 3); };
  const feed = async (patch) => { const before = sent.length; Object.assign(agent, patch); writeFeed(); await settle(); return sent.slice(before); };
  const deliver = async (id, text) => {
    const before = sent.length;
    updates.push({ update_id: ++uid, message: { chat: { id, type: 'private' }, from: { id, language_code: id === 104 ? 'tr' : 'en' }, text } });
    await until(() => JSON.parse(fs.readFileSync(stateFile, 'utf8')).offset === uid + 1);
    return sent.slice(before);
  };
  const recipients = (messages, expected) => assert.deepEqual(messages.map((m) => String(m.chat_id)).sort(), expected);
  const completion = (messages, expected = ['101']) => {
    const list = completed(messages); recipients(list, expected);
    for (const m of list) assert.match(m.text, /\?agent=/);
  };
  await start(); await settle();

  await t.test('startup is quiet and a new completion reaches only eligible linked chats once', async () => {
    assert.equal(sent.length, 0, 'historical feed and Paperclip completions are not announced');
    completion(await feed({ completedAt: 2000 }));
    assert.equal((await feed({})).length, 0, 'completion is sent once');
  });

  await t.test('all and unmute enable future completions independently for each chat', async () => {
    assert.match((await deliver(102, '/alerts all'))[0].text, /completed work/);
    await deliver(103, '/all'); await deliver(104, '/unmute Feed agent');
    const before = sent.length; await settle(); assert.equal(sent.length, before, 'no replay when enabling');
    completion(await feed({ completedAt: 3000 }), allowedUsers);
    assert.match(sent.at(-1).text, /işini tamamladı/);
  });

  await t.test('questions, failures and mute suppress completions without changing existing alerts or commands', async () => {
    await deliver(102, '/questions'); await deliver(103, '/alerts failures'); await deliver(104, '/mute Feed agent');
    completion(await feed({ completedAt: 4000 }));
    recipients((await feed({ status: 'waiting' })).filter((m) => /needs you/.test(m.text)), ['101', '102']);
    recipients((await feed({ status: 'error', error: 'Failure' })).filter((m) => /in error/.test(m.text)), ['101', '103']);
    assert.equal(completed(await feed({ status: 'idle', error: null })).length, 0);
    assert.match((await deliver(104, '/status'))[0].text, /2 ajan/);
  });

  await t.test('explicit timestamps detect short turns without treating aborted turns as success', async () => {
    completion(await feed({ completedAt: '2026-10-04T12:00:00Z' }));
    assert.equal((await request(`${base}/api/feed/0`)).data.agents[0].completedAt, '2026-10-04T12:00:00.000Z');
    for (const patch of [{ status: 'running' }, { status: 'idle' }, { status: 'paused' }, { status: 'idle', completedAt: 'invalid' }]) {
      assert.equal(completed(await feed(patch)).length, 0);
    }
    assert.equal((await request(`${base}/api/feed/0`)).data.agents[0].completedAt, null);
    completion(await feed({ completedAt: '2026-10-04T12:01:00Z' }));
  });

  await t.test('legacy feeds infer completion only from a clean running-to-idle transition', async () => {
    delete agent.completedAt;
    await feed({ status: 'running' }); completion(await feed({ status: 'finished' }));
    assert.equal((await feed({})).length, 0);
    await feed({ status: 'waiting' }); assert.equal(completed(await feed({ status: 'idle' })).length, 0);
    await feed({ status: 'running' }); assert.equal(completed(await feed({ status: 'idle', error: 'Aborted' })).length, 0);
    await feed({ status: 'running', error: null }); assert.equal(completed(await feed({ status: 'paused' })).length, 0);
    await feed({ status: 'idle', completedAt: null });
  });

  await t.test('Paperclip sends successful runs once, including a success followed by a new running turn', async () => {
    let before = sent.length;
    runs.push(run('r1', 'succeeded', '2026-10-04T12:00:00Z')); await settle();
    completion(sent.slice(before), ['101', '104']); assert.match(sent[before].text, /Paperclip agent/);
    before = sent.length; await settle(); assert.equal(sent.length, before);
    runs.push(run('r2', 'failed', '2026-10-04T12:01:00Z')); await settle();
    assert.equal(completed(sent.slice(before)).length, 0);
    recipients(sent.slice(before).filter((m) => /last run failed|son çalıştırma başarısız/.test(m.text)), ['101', '103', '104']);
    before = sent.length;
    runs.push(run('r3', 'cancelled', '2026-10-04T12:02:00Z')); await settle(); assert.equal(sent.length, before);
    runs.push(run('r4', 'succeeded', '2026-10-04T12:03:00Z'), run('r5', 'running', '2026-10-04T12:04:00Z'));
    await settle(); completion(sent.slice(before), ['101', '104']);
  });

  await t.test('a rejected completion rechecks filters, mutes and access before its plain-text retry', async () => {
    for (const policy of ['filter', 'mute', 'access']) {
      const before = attempts.length;
      rejectCompletion = true; agent.completedAt = Number(agent.completedAt || 0) + 1000; writeFeed();
      await until(() => releaseCompletion !== null);
      if (policy === 'filter') await deliver(101, '/errors');
      else if (policy === 'mute') await deliver(101, '/mute Feed agent');
      else assert.equal((await request(api, 'PUT', { allowedUsers: allowedUsers.slice(1) })).status, 200);
      releaseCompletion(); releaseCompletion = null;
      await settle(); assert.equal(completed(attempts.slice(before)).length, 1, 'no retry after settings changed');
      if (policy === 'filter') await deliver(101, '/all');
      else if (policy === 'mute') await deliver(101, '/unmute Feed agent');
      else assert.equal((await request(api, 'PUT', { allowedUsers })).status, 200);
      const count = sent.length; await settle(); assert.equal(sent.length, count, 'no replay after settings restored');
    }
  });

  await t.test('filters and muted agents survive restart without replaying completions', async () => {
    const before = sent.length; await stop(); await start(); await settle(); assert.equal(sent.length, before);
    const chats = JSON.parse(fs.readFileSync(stateFile, 'utf8')).chats;
    assert.equal(chats['102'].only, 'questions'); assert.equal(chats['103'].only, 'failures');
    assert.deepEqual(chats['104'].muted, ['feed agent']);
    completion(await feed({ completedAt: 10000 }));
  });
});

test('hook feeds record successful Stop events without marking failure, cancellation or duplicate Stop as success', () => {
  let feed = { agents: [] };
  const event = (hook_event_name) => { feed = apply(feed, { session_id: 'a', hook_event_name }); return feed.agents[0]; };
  assert.equal(event('SessionStart').completedAt, null);
  event('UserPromptSubmit'); const completed = event('Stop').completedAt; assert.ok(completed > 0);
  assert.equal(event('Stop').completedAt, completed);
  event('UserPromptSubmit'); event('StopFailure'); assert.equal(event('Stop').completedAt, completed);
  event('UserPromptSubmit'); event('SessionEnd'); assert.equal(feed.agents.length, 0);
});
