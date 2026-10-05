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
function request(url, method = 'GET', body, headers = {}) {
  return new Promise((resolve, reject) => {
    const q = http.request(url, { method, headers: { 'content-type': 'application/json', 'x-cubicle': '1', ...headers } }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; });
      r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(b) }));
    });
    q.on('error', reject); q.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('notification preferences filter every event and persist across restarts', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-notify-'));
  const stateFile = path.join(dir, 'state.json'), settingsFile = path.join(dir, 'settings.json'), feedFile = path.join(dir, 'feed.json');
  fs.writeFileSync(stateFile, JSON.stringify({ code: '123456', chats: { 101: { lang: 'en' }, 102: { lang: 'en' }, '-900': { lang: 'en' } } }));
  fs.writeFileSync(settingsFile, JSON.stringify({ allowEveryone: false, allowedUsers: ['101'] }));
  let agent = { id: 'f1', name: 'Feed agent', status: 'idle', completedAt: null }, pcStatus = 'idle', runs = [], watches = 0, child;
  const sent = [], updates = [];
  // Whole or not at all, as the hook writes it: a half-written feed reads as an empty office for a
  // tick, and the agent's next change would then look like its first appearance.
  const writeFeed = () => { fs.writeFileSync(`${feedFile}.tmp`, JSON.stringify({ agents: [agent] })); fs.renameSync(`${feedFile}.tmp`, feedFile); };
  writeFeed();
  let holdQuestions = false, releaseQuestions = null;
  const mock = http.createServer((q, r) => {
    let raw = ''; q.on('data', (d) => { raw += d; }); q.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}, json = (data) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(data)); };
      if (q.url === '/botT0K/getUpdates') return setTimeout(() => json({ ok: true, result: updates.filter((u) => u.update_id >= (body.offset || 0)) }), 15);
      if (q.url === '/botT0K/sendMessage') { sent.push(body); return json({ ok: true, result: { message_id: sent.length } }); }
      if (q.url === '/api/companies') return json([{ id: 'c', name: 'Test', issuePrefix: 'T' }]);
      if (q.url === '/api/companies/c/agents') { watches++; return json([{ id: 'p1', name: 'Paperclip agent', status: pcStatus }]); }
      if (q.url === '/api/companies/c/issues') return json([{ id: 'i1', identifier: 'T-1', title: 'Test task', status: 'in_progress', assigneeAgentId: 'p1' }]);
      if (q.url.startsWith('/api/companies/c/heartbeat-runs')) return json(runs);
      if (q.url === '/api/issues/T-1/interactions' && holdQuestions) { releaseQuestions = () => json([]); return; }
      return json([]);
    });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise((resolve) => reserve.close(resolve));
  const base = `http://127.0.0.1:${port}`, api = `${base}/api/telegram`;
  const stop = async () => { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } };
  t.after(async () => { if (releaseQuestions) releaseQuestions(); await stop(); await new Promise((resolve) => mock.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const start = async () => {
    child = spawn(process.execPath, [path.join(__dirname, '../bin/cubicle.js'), '--port', String(port), '--source', `paperclip,${feedFile}`, '--paperclip', mockUrl, '--appearance', path.join(dir, 'appearance.json')], {
      stdio: 'ignore', env: { ...process.env, CUBICLE_TELEGRAM_TOKEN: 'T0K', CUBICLE_TELEGRAM_TOKEN_FILE: '', CUBICLE_TELEGRAM_CHAT: '',
        CUBICLE_TELEGRAM_SETTINGS: settingsFile, CUBICLE_TELEGRAM_STATE: stateFile, CUBICLE_TELEGRAM_API: mockUrl, CUBICLE_TELEGRAM_POLL: '0', CUBICLE_TELEGRAM_INTERVAL: '25' },
    });
    await until(async () => { try { return (await request(api)).data.polling === 'ok'; } catch (_) { return false; } });
  };
  const settle = async () => { const before = watches; await until(() => watches >= before + 3); };
  const prefs = async (notifications) => { const r = await request(api, 'PUT', { notifications }); assert.equal(r.status, 200); return r.data.notifications; };
  const feed = async (patch) => { const before = sent.length; Object.assign(agent, patch); writeFeed(); await settle(); return sent.slice(before); };
  const kind = (messages, expected) => {
    assert.equal(messages.length, 1); assert.equal(String(messages[0].chat_id), '101', 'only the allowed private chat receives notifications');
    assert.match(messages[0].text, expected); assert.match(messages[0].text, /\?agent=/);
  };
  const allOn = { enabled: true, errors: true, waiting: true, completed: true };
  await start(); await settle();

  await t.test('all switches default to true and all three event types reach only authorized chats', async () => {
    assert.deepEqual((await request(api)).data.notifications, allOn); assert.equal(sent.length, 0, 'no startup notification');
    kind(await feed({ status: 'waiting' }), /needs you/);
    kind(await feed({ status: 'error', error: 'Failure' }), /in error/);
    kind(await feed({ status: 'idle', error: null, completedAt: 1000 }), /finished its work/);
    assert.equal((await feed({ status: 'idle' })).length, 0, 'completion is sent once');
  });

  await t.test('each category can be disabled separately without replaying suppressed events', async () => {
    await prefs({ waiting: false });
    assert.equal((await feed({ status: 'waiting' })).length, 0);
    kind(await feed({ status: 'error' }), /in error/);
    await prefs({ errors: false, completed: false });
    assert.equal((await feed({ status: 'idle', completedAt: 2000 })).length, 0);
    assert.equal((await feed({ status: 'error' })).length, 0);
    const before = sent.length; await prefs(allOn); await settle(); assert.equal(sent.length, before);
    kind(await feed({ status: 'idle', completedAt: 3000 }), /finished its work/);
  });

  await t.test('the master switch preserves category choices and does not block commands', async () => {
    const off = await prefs({ enabled: false, waiting: false }); assert.equal(off.completed, true);
    for (const patch of [{ status: 'waiting' }, { status: 'error' }, { status: 'idle', completedAt: 4000 }]) assert.equal((await feed(patch)).length, 0);
    const before = sent.length;
    updates.push({ update_id: 1, message: { chat: { id: 101, type: 'private' }, from: { id: 101, language_code: 'en' }, text: '/status' } });
    await until(() => sent.length > before); assert.match(sent.at(-1).text, /2 agents/);
    const on = await prefs({ enabled: true }); assert.equal(on.waiting, false); await settle(); assert.equal(sent.length, before + 1);
    await prefs({ waiting: true });
  });

  await t.test('explicit timestamps detect short turns but not aborted or stale idle transitions', async () => {
    kind(await feed({ status: 'idle', completedAt: 5000 }), /finished its work/);
    assert.equal((await feed({ status: 'running' })).length, 0);
    assert.equal((await feed({ status: 'idle' })).length, 0, 'idle without a new completion is not success');
    assert.equal((await feed({ status: 'paused' })).length, 0);
    assert.equal((await feed({ status: 'idle', completedAt: 'invalid' })).length, 0);
    const shaped = (await request(`${base}/api/feed/0`)).data; assert.equal(shaped.agents[0].completedAt, null);
    kind(await feed({ completedAt: '2026-10-04T12:00:00Z' }), /finished its work/);
    delete agent.completedAt;
    await feed({ status: 'running' }); kind(await feed({ status: 'finished' }), /finished its work/);
    await feed({ status: 'waiting' }); assert.equal((await feed({ status: 'idle' })).length, 0, 'waiting to idle is not success');
  });

  await t.test('Paperclip reports successful runs once and excludes failed or cancelled runs', async () => {
    const run = (id, status, startedAt) => ({ id, agentId: 'p1', status, startedAt, finishedAt: status === 'running' ? null : startedAt });
    let before = sent.length;
    runs = [run('r1', 'succeeded', '2026-10-04T12:00:00Z')]; await settle(); kind(sent.slice(before), /Paperclip agent.*finished/);
    before = sent.length; await settle(); assert.equal(sent.length, before);
    runs.push(run('r2', 'failed', '2026-10-04T12:01:00Z')); await settle(); kind(sent.slice(before), /last run failed/);
    before = sent.length; runs.push(run('r3', 'cancelled', '2026-10-04T12:02:00Z')); await settle(); assert.equal(sent.length, before);
    // A successful turn can complete and another can start between two polls.
    runs.push(run('r4', 'succeeded', '2026-10-04T12:03:00Z'), run('r5', 'running', '2026-10-04T12:04:00Z'));
    await settle(); kind(sent.slice(before), /finished its work/);
  });

  await t.test('disabling a notification while its details load cancels the pending send', async () => {
    const before = sent.length; holdQuestions = true; pcStatus = 'waiting';
    await until(() => releaseQuestions !== null);
    await prefs({ enabled: false }); holdQuestions = false; releaseQuestions(); releaseQuestions = null;
    await settle(); assert.equal(sent.length, before);
  });

  await t.test("a chat's /alerts narrows what the page allows and never widens it", async () => {
    let uid = 1;
    const say = async (text) => {
      const before = sent.length;
      updates.push({ update_id: ++uid, message: { chat: { id: 101, type: 'private' }, from: { id: 101, language_code: 'en' }, text } });
      await until(() => sent.length > before); return sent.at(-1).text;
    };
    await prefs(allOn); await settle();
    assert.match(await say('/alerts done'), /only agents that finished/);
    assert.equal((await feed({ status: 'error', error: 'Failure' })).length, 0, 'the chat chose finished work only');
    kind(await feed({ status: 'idle', error: null, completedAt: 6000 }), /finished its work/);
    await prefs({ completed: false });
    const reply = await say('/done');
    assert.match(reply, /only agents that finished/); assert.match(reply, /turned off in Cubicle/);
    assert.equal((await feed({ status: 'idle', completedAt: 7000 })).length, 0, 'the page switch wins over the chat');
    await prefs(allOn);
    assert.doesNotMatch(await say('/alerts all'), /turned off/);
    kind(await feed({ status: 'error', error: 'Failure' }), /in error/);
    await feed({ status: 'idle', error: null });
  });

  await t.test('settings are validated, private, persistent, and restart does not replay completions', async () => {
    const saved = fs.readFileSync(settingsFile, 'utf8');
    for (const notifications of [null, [], true, { enabled: 'false' }, { completed: 0 }, { unknown: true }]) {
      assert.equal((await request(api, 'PUT', { notifications })).status, 400);
      assert.equal(fs.readFileSync(settingsFile, 'utf8'), saved);
    }
    const headers = { 'x-forwarded-for': '100.64.0.2' };
    assert.equal((await request(api, 'PUT', { notifications: allOn }, headers)).status, 403);
    assert.equal('notifications' in (await request(api, 'GET', undefined, headers)).data, false);
    const expected = await prefs({ enabled: true, errors: false });
    const before = sent.length; await stop(); await start(); await settle();
    assert.deepEqual((await request(api)).data.notifications, expected); assert.equal(sent.length, before);
  });
});

test('hook feeds keep an explicit completion timestamp and do not mark failure or duplicate Stop as success', () => {
  let feed = { agents: [] };
  const event = (hook_event_name) => { feed = apply(feed, { session_id: 'a', hook_event_name }); return feed.agents[0]; };
  assert.equal(event('SessionStart').completedAt, null);
  event('UserPromptSubmit'); const completed = event('Stop').completedAt; assert.ok(completed > 0);
  assert.equal(event('Stop').completedAt, completed);
  event('UserPromptSubmit'); event('StopFailure'); assert.equal(event('Stop').completedAt, completed);
});
