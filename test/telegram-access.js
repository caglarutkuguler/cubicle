'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await check()) return; await sleep(20); }
  assert.fail('timed out waiting for the local fixture');
}
function request(base, method = 'GET', body, headers = {}) {
  return new Promise((resolve, reject) => {
    const q = http.request(`${base}/api/telegram`, { method, headers: { 'content-type': 'application/json', 'x-cubicle': '1', ...headers } }, (r) => {
      let text = ''; r.on('data', (d) => { text += d; });
      r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(text) }));
    });
    q.on('error', reject); q.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('Telegram access policy applies to pairing, commands, comments and notifications', { timeout: 20000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubicle-access-'));
  const stateFile = path.join(dir, 'state.json'), settingsFile = path.join(dir, 'settings.json');
  fs.writeFileSync(stateFile, JSON.stringify({ code: '123456', offset: 0, chats: { 101: { lang: 'en' }, 102: { lang: 'en' }, '-900': { lang: 'en' } } }));
  const updates = [], sent = [], comments = [];
  let uid = 0, agentStatus = 'running', watches = 0, polledOffset = 0, child;
  const mock = http.createServer((q, r) => {
    let raw = ''; q.on('data', (d) => { raw += d; }); q.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      r.setHeader('content-type', 'application/json');
      const json = (value) => r.end(JSON.stringify(value));
      if (q.url === '/botT0K/getUpdates') {
        polledOffset = body.offset || 0;
        return setTimeout(() => json({ ok: true, result: updates.filter((u) => u.update_id >= polledOffset) }), 15);
      }
      if (q.url === '/botT0K/sendMessage') { sent.push(body); return json({ ok: true, result: { message_id: sent.length } }); }
      if (q.url === '/api/companies') return json([{ id: 'c1', name: 'Test office', issuePrefix: 'T' }]);
      if (q.url === '/api/companies/c1/agents') { watches++; return json([{ id: 'a1', name: 'Test agent', status: agentStatus }]); }
      if (q.url === '/api/companies/c1/issues') return json([{ id: 'i1', identifier: 'T-1', title: 'Test task', status: 'in_progress', assigneeAgentId: 'a1' }]);
      if (q.url === '/api/issues/T-1/comments' && q.method === 'POST') { comments.push(body); return json({}); }
      return json([]);
    });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  // Reserve a free local port without relying on a developer's usual Cubicle port.
  const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise((resolve) => reserve.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } };
  t.after(async () => { await stop(); await new Promise((resolve) => mock.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const start = async () => {
    child = spawn(process.execPath, [path.join(__dirname, '../bin/cubicle.js'), '--port', String(port), '--paperclip', mockUrl, '--telegram-replies', '--appearance', path.join(dir, 'appearance.json')], {
      stdio: 'ignore', env: { ...process.env, CUBICLE_TELEGRAM_TOKEN: 'T0K', CUBICLE_TELEGRAM_TOKEN_FILE: '', CUBICLE_TELEGRAM_CHAT: '103',
        CUBICLE_TELEGRAM_API: mockUrl, CUBICLE_TELEGRAM_SETTINGS: settingsFile, CUBICLE_TELEGRAM_STATE: stateFile,
        CUBICLE_TELEGRAM_INTERVAL: '30', CUBICLE_TELEGRAM_POLL: '0' },
    });
    await until(async () => { try { return (await request(base)).data.polling === 'ok'; } catch (_) { return false; } });
  };
  const message = (id, text, extra = {}) => ({ chat: { id, type: id < 0 ? 'group' : 'private' }, from: { id, language_code: 'en' }, text, ...extra });
  const deliver = async (...messages) => {
    const before = sent.length;
    for (const m of messages) updates.push({ update_id: ++uid, message: { message_id: uid, ...m } });
    // The bot asks for the next updates only after it has handled (and answered) every one of these.
    await until(() => polledOffset === uid + 1);
    return sent.slice(before);
  };
  const put = async (body) => { const r = await request(base, 'PUT', body); assert.equal(r.status, 200); return r.data; };
  await start();

  await t.test('existing installations default to everyone, with pairing still required', async () => {
    const st = (await request(base)).data;
    assert.equal(st.allowEveryone, true); assert.deepEqual(st.allowedUsers, []);
    assert.deepEqual(st.linkedUsers.sort(), ['101', '102', '103']);
    assert.match((await deliver(message(104, '/status')))[0].text, /not linked yet/);
    assert.match((await deliver(message(104, '/start 123456')))[0].text, /now linked/);
    assert.match((await deliver(message(104, '/status')))[0].text, /1 agents/);
  });

  await t.test('only listed senders in private chats pass the restriction', async () => {
    const st = await put({ allowEveryone: false, allowedUsers: ['101', '102', '106', '101'] });
    assert.deepEqual(st.allowedUsers, ['101', '102', '106']); assert.equal(st.chats, 2);
    const denied = await deliver(
      message(105, '/start 123456'), message(105, '123456'),
      message(104, '/status'), message(103, '/waiting'), message(104, '/kpi'), message(104, '/office'),
      message(104, '/answer T-1 denied'), message(104, 'denied', { reply_to_message: { message_id: 1 } }),
      message(-900, '/status', { from: { id: 101 } }),
      message(101, '/status', { from: { id: 999 } }), message(101, '/status', { from: null }),
      message(101, '/status', { sender_chat: { id: -900 } }), message(101, '/status', { chat: { id: 101, type: 'channel' } }),
      message(101, '/status', { from: { id: 101, is_bot: true } }),
    );
    assert.deepEqual(denied, []); assert.equal(comments.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).chats['105'], undefined);
    assert.match((await deliver(message(106, '/status')))[0].text, /not linked yet/, 'listed users still pair');
    assert.match((await deliver(message(106, '/start 123456')))[0].text, /now linked/);
    const answers = await deliver(message(101, '/status'), message(102, '/status'), message(106, '/status'));
    assert.equal(answers.length, 3); assert.ok(answers.every((m) => /1 agents/.test(m.text)));
    await deliver(message(101, '/answer T-1 approved'));
    assert.equal(comments.length, 1); assert.equal(comments[0].body, 'approved');
  });

  await t.test('removal stops replies and all notifications without restarting', async () => {
    await put({ allowedUsers: ['101'] });
    assert.deepEqual(await deliver(message(102, '/status'), message(106, '/answer T-1 removed')), []);
    assert.equal(comments.length, 1);
    let before = sent.length; agentStatus = 'waiting';
    await until(() => sent.length > before);
    let count = watches; await until(() => watches >= count + 3);
    assert.deepEqual(sent.slice(before).map((m) => String(m.chat_id)), ['101']);
    const note = sent[before], noteId = before + 1;
    assert.match(note.text, /needs you/);
    await deliver(message(101, 'approved reply', { reply_to_message: { message_id: noteId } }));
    assert.equal(comments[1].body, 'approved reply');
    before = sent.length; agentStatus = 'error';
    await until(() => sent.length > before);
    count = watches; await until(() => watches >= count + 3);
    assert.deepEqual(sent.slice(before).map((m) => String(m.chat_id)), ['101']);
    assert.match(sent[before].text, /in error/);
    await put({ allowedUsers: [] });
    assert.equal((await request(base)).data.chats, 0);
    assert.deepEqual(await deliver(message(101, '/start 123456'), message(101, '/answer T-1 blocked'), message(101, 'blocked reply', { reply_to_message: { message_id: noteId } })), []);
    assert.equal(comments.length, 2);
    before = sent.length; agentStatus = 'waiting'; count = watches;
    await until(() => watches >= count + 3); assert.equal(sent.length, before);
  });

  await t.test('invalid settings and remote requests cannot change or reveal the list', async () => {
    await put({ allowedUsers: ['101'] });
    const saved = fs.readFileSync(settingsFile, 'utf8');
    for (const body of [null, [], { allowEveryone: 'false' }, { allowEveryone: null }, { allowedUsers: '101' },
      { allowedUsers: [101] }, { allowedUsers: ['@person'] }, { allowedUsers: ['-900'] }, { allowedUsers: ['0'] },
      { allowedUsers: ['00101'] }, { allowedUsers: ['9007199254740992'] }, { allowEveryone: true, allowedUsers: ['bad'] }]) {
      assert.equal((await request(base, 'PUT', body)).status, 400);
      assert.equal(fs.readFileSync(settingsFile, 'utf8'), saved, 'invalid updates are atomic');
    }
    for (const headers of [{ 'x-forwarded-for': '100.64.0.2' }, { 'tailscale-user-login': 'other@example.com' }, { host: 'pc.tail.ts.net' }, { origin: 'https://example.com' }]) {
      assert.equal((await request(base, 'PUT', { allowEveryone: true }, headers)).status, 403);
    }
    assert.equal((await request(base, 'PUT', { allowEveryone: true }, { 'x-cubicle': '' })).status, 400);
    for (const endpoint of ['/api/telegram', '/config.json']) {
      const remote = await new Promise((resolve) => http.get(`${base}${endpoint}`, { headers: { 'x-forwarded-for': '100.64.0.2' } }, (r) => {
        let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => resolve(JSON.parse(b)));
      }));
      const st = endpoint === '/config.json' ? remote.telegram : remote;
      for (const key of ['allowEveryone', 'allowedUsers', 'linkedUsers', 'code']) assert.equal(key in st, false);
    }
    assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o600);
  });

  await t.test('restrictions survive restart and toggling everyone preserves the list', async () => {
    await stop(); await start();
    const st = (await request(base)).data;
    assert.equal(st.allowEveryone, false); assert.deepEqual(st.allowedUsers, ['101']);
    assert.deepEqual(await deliver(message(102, '/status')), []);
    assert.match((await deliver(message(101, '/status')))[0].text, /1 agents/);
    const enabled = await put({ allowEveryone: true });
    assert.deepEqual(enabled.allowedUsers, ['101']);
    assert.match((await deliver(message(102, '/status')))[0].text, /1 agents/);
    await put({ allowEveryone: false });
    assert.deepEqual(await deliver(message(102, '/status')), []);
  });
});
