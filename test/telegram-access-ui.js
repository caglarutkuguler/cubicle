'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const strings = new Function(html.slice(html.indexOf('  const STR = {'), html.indexOf('  const params = new URLSearchParams')) + '; return STR;')();
const script = html.slice(html.indexOf("  const tgDlg = document.getElementById('tg');"), html.indexOf('  // ---------- layout:'));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const status = (ids = []) => ({ on: true, canEdit: true, allowEveryone: false, allowedUsers: ids,
  linkedUsers: ['101'], chats: ids.includes('101') ? 1 : 0, publicUrl: 'http://127.0.0.1:3200', publicFixed: false, polling: 'ok' });

// Run the real dialog code with a small DOM boundary and controllable network responses.
// Requests deliberately complete out of order; no browser or runtime dependency is needed.
function fixture() {
  const error = { textContent: '' }, checkbox = { checked: false, disabled: false }, button = { disabled: false };
  const box = { querySelector: (s) => s.includes('accesserr') ? error : checkbox, querySelectorAll: () => [checkbox, button] };
  const notificationError = { textContent: '' };
  const notificationControls = ['enabled', 'errors', 'waiting', 'completed'].map((key) => ({ dataset: { tgNotify: key }, checked: true, disabled: false }));
  const notificationBox = { querySelector: () => notificationError, querySelectorAll: () => notificationControls };
  const listeners = {}, timers = new Map(), requests = [];
  let timerId = 0;
  const dialog = {
    innerHTML: '', open: false, scrollTop: 180,
    querySelector: (s) => s === '[data-tg-access]' ? box : s === '[data-tg-notifications]' ? notificationBox : null,
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    showModal() { this.open = true; },
    close() { this.open = false; for (const fn of listeners.close || []) fn(); },
  };
  const network = { get: () => status(), put: (change) => ({ ...status(), ...change }), tailscale: () => ({ found: false }) };
  const context = vm.createContext({
    document: { getElementById: () => dialog }, L: strings.en, EMBED: false, DEMO: false,
    esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), qrSvg: () => '',
    setInterval: (fn) => { timers.set(++timerId, fn); return timerId; }, clearInterval: (id) => timers.delete(id),
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET'; requests.push(`${method} ${url}`);
      const data = url === '/api/tailscale' ? await network.tailscale()
        : method === 'PUT' ? await network.put(JSON.parse(opts.body)) : await network.get();
      return { ok: true, json: async () => data };
    },
  });
  vm.runInContext(script, context);
  return { dialog, network, requests, timers, open: () => vm.runInContext('openTelegram()', context),
    save: (change) => vm.runInContext(`saveTgAccess(${JSON.stringify(change)})`, context),
    notify: (change) => vm.runInContext(`saveTgSettings({ notifications: ${JSON.stringify(change)} }, 'notifications')`, context),
    notificationControls, notificationError };
}

test('adding and removing users renders the saved response without another GET or Tailscale wait', async () => {
  const f = fixture(); await f.open();
  f.network.tailscale = () => new Promise(() => {});
  for (const ids of [['101'], []]) {
    f.requests.length = 0;
    let finished = false;
    f.save({ allowedUsers: ids }).then(() => { finished = true; });
    await flush();
    assert.equal(finished, true, 'saving must not wait for unrelated requests');
    assert.deepEqual(f.requests, ['PUT /api/telegram']);
    assert.equal(f.dialog.innerHTML.includes('data-tg="removeuser"'), ids.length > 0);
    assert.equal(f.dialog.innerHTML.includes(strings.en.tgNoUsers), ids.length === 0);
    assert.equal(f.dialog.scrollTop, 180);
  }
});

test('an older dialog refresh cannot overwrite a saved list when its Tailscale lookup finishes', async () => {
  const f = fixture(); await f.open();
  const slow = deferred(); f.network.tailscale = () => slow.promise;
  const oldRefresh = f.open(); await flush();
  const saving = f.save({ allowedUsers: ['101'] }); await flush();
  assert.match(f.dialog.innerHTML, /data-tg="removeuser"/);
  slow.resolve({ found: true, running: false }); await oldRefresh; await saving;
  assert.match(f.dialog.innerHTML, /data-tg="removeuser"/);
  assert.ok(!f.dialog.innerHTML.includes(strings.en.tgNoUsers));
});

test('a polling request started before a save cannot restore stale permissions', async () => {
  const f = fixture(); await f.open();
  const slow = deferred(); f.network.get = () => slow.promise;
  const poll = [...f.timers.values()][0]();
  const saving = f.save({ allowedUsers: ['101'] }); await flush();
  assert.match(f.dialog.innerHTML, /data-tg="removeuser"/);
  slow.resolve({ ...status(), unpaired: true }); await poll; await saving; await flush();
  assert.match(f.dialog.innerHTML, /data-tg="removeuser"/);
});

test('closing the dialog during a save keeps it closed after the response arrives', async () => {
  const f = fixture(); await f.open();
  const slow = deferred(); f.network.put = () => slow.promise;
  const saving = f.save({ allowedUsers: ['101'] });
  f.dialog.close(); slow.resolve(status(['101'])); await saving;
  assert.equal(f.dialog.open, false);
});

test('notification switches default on, preserve category choices, and refresh without Tailscale', async () => {
  const f = fixture(); await f.open();
  for (const key of ['enabled', 'errors', 'waiting', 'completed']) assert.ok(f.dialog.innerHTML.includes(`data-tg-notify="${key}" checked`));
  const notifications = { enabled: true, errors: true, waiting: true, completed: true };
  f.network.put = (body) => ({ ...status(), notifications: { ...Object.assign(notifications, body.notifications) } });
  f.network.tailscale = () => new Promise(() => {});
  f.requests.length = 0;
  await f.notify({ waiting: false }); await f.notify({ enabled: false });
  assert.match(f.dialog.innerHTML, /<fieldset[^>]* disabled>/);
  assert.ok(!f.dialog.innerHTML.includes('data-tg-notify="waiting" checked'));
  assert.ok(f.dialog.innerHTML.includes('data-tg-notify="completed" checked'));
  await f.notify({ enabled: true });
  assert.doesNotMatch(f.dialog.innerHTML, /<fieldset[^>]* disabled>/);
  assert.ok(!f.dialog.innerHTML.includes('data-tg-notify="waiting" checked'));
  assert.deepEqual(f.requests, Array(3).fill('PUT /api/telegram'));
});

test('a failed notification save restores the switch and shows a local error', async () => {
  const f = fixture(); await f.open();
  f.notificationControls[0].checked = false;
  f.network.put = () => { throw new Error('offline'); };
  await f.notify({ enabled: false });
  assert.equal(f.notificationControls[0].checked, true);
  assert.equal(f.notificationError.textContent, strings.en.tgNotifyFailed);
  assert.ok(f.notificationControls.every((c) => !c.disabled));
});
