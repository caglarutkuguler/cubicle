// Cubicle on Telegram (optional): a bot that tells you when an agent needs you, links straight to
// that agent in the office (and to the issue in Paperclip), answers /status, /waiting and /kpi, and,
// only when the server runs with --telegram-replies, turns your reply into a Paperclip comment.
//
// Zero dependencies: the Bot API over https with long polling, so it works behind NAT without a
// public address. Only chats that sent the pairing code printed at startup are ever answered.
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = process.env.CUBICLE_TELEGRAM_API || 'https://api.telegram.org';   // tests point this at a fake

const TEXT = {
  en: {
    needs: (n) => `✋ <b>${n}</b> needs you`, why: 'Reason', open: 'See in Cubicle', inPaperclip: 'Open in Paperclip',
    replyHint: 'Reply to this message to answer; it becomes a comment on the issue.',
    failed: (n) => `⚠ <b>${n}</b>: the last run failed`, errored: (n) => `⚠ <b>${n}</b> is in error`,
    paired: 'This chat is now linked to the office. You will get a message when an agent needs you.',
    pairFirst: 'Send the code Cubicle printed when it started: /start 123456',
    help: '/status – the office now\n/waiting – who needs you\n/kpi – the tasks you gave\n/office – open Cubicle\n/answer ID text – answer an issue\nOr reply to a “needs you” message.',
    status: (n, run, wait, err) => `${n} agents · ${run} working · ${wait} need you${err ? ` · ${err} in error` : ''}`,
    nobody: 'Nobody is waiting for you.', office: 'Open the office', kpi: 'Tasks you gave',
    kpiLine: (open, avg, done7) => `${open} open · average progress ${avg === null ? '–' : avg + '%'} · ${done7} done in 7 days`,
    sent: (id) => `✓ Sent to ${id}.`, sendFail: (id, e) => `Could not write to ${id}: ${e}`,
    repliesOff: 'Answering from Telegram is off (start Cubicle with --telegram-replies). Open the issue instead:',
    which: 'Reply to a “needs you” message, or write /answer ID text.',
  },
  tr: {
    needs: (n) => `✋ <b>${n}</b> sizi bekliyor`, why: 'Neden', open: 'Cubicle’da gör', inPaperclip: 'Paperclip’te aç',
    replyHint: 'Yanıtlamak için bu mesajı yanıtlayın; yanıtınız işe yorum olarak yazılır.',
    failed: (n) => `⚠ <b>${n}</b>: son çalıştırma başarısız`, errored: (n) => `⚠ <b>${n}</b> hata durumunda`,
    paired: 'Bu sohbet ofise bağlandı. Bir ajan sizi beklediğinde mesaj gelecek.',
    pairFirst: 'Cubicle’ın başlarken yazdığı kodu gönderin: /start 123456',
    help: '/durum – ofisin şu anki hâli\n/bekleyen – sizi bekleyenler\n/kpi – verdiğiniz görevler\n/ofis – Cubicle’ı aç\n/yanit ID metin – bir işi yanıtla\nYa da “sizi bekliyor” mesajını yanıtlayın.',
    status: (n, run, wait, err) => `${n} ajan · ${run} çalışıyor · ${wait} sizi bekliyor${err ? ` · ${err} hatada` : ''}`,
    nobody: 'Sizi bekleyen yok.', office: 'Ofisi aç', kpi: 'Verdiğiniz görevler',
    kpiLine: (open, avg, done7) => `${open} açık · ortalama ilerleme ${avg === null ? '–' : '%' + avg} · 7 günde ${done7} bitti`,
    sent: (id) => `✓ ${id} işine yazıldı.`, sendFail: (id, e) => `${id} işine yazılamadı: ${e}`,
    repliesOff: 'Telegram’dan yanıt kapalı (Cubicle’ı --telegram-replies ile başlatın). İşi buradan açın:',
    which: '“Sizi bekliyor” mesajını yanıtlayın ya da /yanit ID metin yazın.',
  },
};
const tr = (lang) => TEXT[lang] || TEXT.en;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CLOSED = new Set(['done', 'cancelled']);
const FAILED_RUNS = new Set(['failed', 'error', 'timed_out']);

function request(url, { method = 'GET', headers = {}, body = null, timeout = 70000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method, timeout,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers },
    }, (r) => {
      const chunks = []; let size = 0;
      r.on('data', (c) => { size += c.length; if (size < 4 * 1024 * 1024) chunks.push(c); });
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: r.statusCode, json, text });
      });
      r.on('error', (e) => resolve({ status: 0, error: e.message }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

// What the office looks like now, read through this server's own (already shaped) endpoints.
async function snapshot(self) {
  const getJSON = async (p) => { const b = await self(p); if (b == null) return null; try { return JSON.parse(b); } catch (_) { return null; } };
  const cfg = (await getJSON('/config.json')) || { sources: [] };
  const agents = [];
  for (const src of cfg.sources || []) {
    if (src.kind === 'paperclip') {
      const companies = (await getJSON('/api/companies')) || [];
      for (const c of companies.slice(0, 5)) {
        const [as, issues, runs] = await Promise.all([
          getJSON(`/api/companies/${c.id}/agents`), getJSON(`/api/companies/${c.id}/issues`), getJSON(`/api/companies/${c.id}/heartbeat-runs`)]);
        const latest = new Map();
        for (const r of runs || []) if (r && r.agentId && r.finishedAt && (!latest.has(r.agentId) || r.finishedAt > latest.get(r.agentId).finishedAt)) latest.set(r.agentId, r);
        for (const a of as || []) {
          const mine = (issues || []).filter((i) => i.assigneeAgentId === a.id && !CLOSED.has(i.status));
          const ask = mine.find((i) => ((i.reviewAttention && i.reviewAttention.paths) || []).some((x) => /board|user|human/i.test(String(x && x.responder || ''))));
          const task = mine.find((i) => i.status === 'in_progress') || mine[0] || null;
          const run = latest.get(a.id);
          const askPath = ask && ask.reviewAttention.paths.find((x) => /board|user|human/i.test(String(x && x.responder || '')));
          agents.push({
            id: a.id, name: a.name, status: a.status, company: c, paperclip: cfg.paperclipUrl || src.paperclipUrl,
            needs: a.status === 'waiting' || (!!ask && a.status !== 'error'), issue: ask || (a.status === 'waiting' ? task : null), reason: askPath ? askPath.label : '',
            task, error: a.errorReason || '', fail: run && FAILED_RUNS.has(run.status) ? { id: run.id, code: run.errorCode || run.status, error: run.error || '' } : null,
          });
        }
      }
    } else if (src.path) {
      const data = await getJSON(src.path);
      const list = Array.isArray(data) ? data : (data && data.agents) || [];
      list.forEach((a, i) => {
        const st = String(a.status || '').toLowerCase();
        const waiting = /wait|blocked|needs|input|approval|permission/.test(st);
        const status = waiting ? 'waiting' : /error|fail/.test(st) ? 'error' : /work|run|busy|active/.test(st) ? 'running' : st;
        const task = a.task ? { identifier: a.task.identifier || a.task.id || '', title: a.task.title || '' } : null;
        // The page names feed agents "<feed path>#<id>", so links select the same one.
        agents.push({ id: `${src.path}#${a.id ?? a.name ?? i}`, name: a.name || a.id, status, needs: waiting, issue: task, reason: '', task, error: a.error || '', fail: null });
      });
    }
  }
  return { agents };
}

// The same numbers as the page's KPI board, for /kpi: open tasks people gave, their average
// progress and how many were done in the last 7 days.
async function kpiSummary(self) {
  const getJSON = async (p) => { const b = await self(p); try { return b == null ? null : JSON.parse(b); } catch (_) { return null; } };
  const companies = (await getJSON('/api/companies')) || [];
  if (!companies.length) return null;
  const list = ((await getJSON(`/api/kpi/${companies[0].id}`)) || []).filter((i) => !i.convo);
  const PCT = { backlog: 0, todo: 5, in_progress: 40, in_review: 80, blocked: 40, done: 100, cancelled: 100 };
  const kids = new Map();
  for (const i of list) if (i.parentId) { if (!kids.has(i.parentId)) kids.set(i.parentId, []); kids.get(i.parentId).push(i); }
  const under = (id) => { const out = [], seen = new Set([id]), st = [id]; while (st.length) for (const k of kids.get(st.pop()) || []) if (!seen.has(k.id)) { seen.add(k.id); out.push(k); st.push(k.id); } return out; };
  const roots = list.filter((i) => i.human && !i.parentId);
  const open = roots.filter((i) => !CLOSED.has(i.status)).map((i) => { const sub = under(i.id); return sub.length ? Math.min(95, Math.round(sub.reduce((a, k) => a + (PCT[k.status] ?? 0), 0) / sub.length)) : (PCT[i.status] ?? 0); });
  const week = Date.now() - 7 * 86400000;
  return { open: open.length, avg: open.length ? Math.round(open.reduce((a, b) => a + b, 0) / open.length) : null, done7: roots.filter((i) => i.status === 'done' && Date.parse(i.completedAt) >= week).length };
}

function start(opts) {
  const { token, self, log = console.log } = opts;
  const stateFile = opts.stateFile;
  let state = { chats: {}, offset: 0 };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch (_) {}
  for (const id of String(process.env.CUBICLE_TELEGRAM_CHAT || '').split(',').map((x) => x.trim()).filter(Boolean)) state.chats[id] = state.chats[id] || { lang: 'tr' };
  const saveState = () => {
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 }); } catch (_) {}
  };
  const code = String(crypto.randomInt(100000, 1000000));
  const call = (method, body) => request(`${API}/bot${token}/${method}`, { method: 'POST', body, timeout: method === 'getUpdates' ? 70000 : 20000 });
  const sent = new Map();          // telegram message id -> { issue, prefix }  (for replies)
  let stopped = false;

  const cubicleLink = (q = '') => `${opts.publicUrl.replace(/\/$/, '')}/${q}`;
  const issueLink = (a, i) => (a.company && a.paperclip && i && i.identifier ? `${(opts.paperclipPublicUrl || a.paperclip).replace(/\/$/, '')}/${encodeURIComponent(a.company.issuePrefix)}/issues/${encodeURIComponent(i.identifier)}` : '');
  const agentLink = (a) => cubicleLink(`?agent=${encodeURIComponent(a.id)}${a.company ? `&company=${encodeURIComponent(a.company.issuePrefix)}` : ''}`);

  async function send(chatId, html, extra = {}) {
    let r = await call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
    // Some links (e.g. 127.0.0.1) can be refused: send it again as plain text, links written out.
    if (r.status === 400) r = await call('sendMessage', { chat_id: chatId, text: html.replace(/<a href="([^"]*)">([^<]*)<\/a>/g, '$2: $1').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), disable_web_page_preview: true, ...extra });
    return r.json && r.json.ok ? r.json.result : null;
  }
  const links = (pairs) => pairs.filter(([, u]) => u).map(([t, u]) => `<a href="${esc(u)}">${esc(t)}</a>`).join(' · ');

  function needsText(a, lang) {
    const t = tr(lang), i = a.issue;
    return [t.needs(esc(a.name)),
      i && (i.identifier || i.title) ? `<b>${esc(i.identifier || '')}</b> ${esc(i.title || '')}` : '',
      a.reason ? `${t.why}: ${esc(a.reason)}` : '',
      '', links([[t.open, agentLink(a)], [t.inPaperclip, issueLink(a, i)]]),
      opts.replies && issueLink(a, i) ? `<i>${esc(t.replyHint)}</i>` : ''].filter((x, k) => x || k === 3).join('\n');
  }
  async function notifyNeeds(a) {
    for (const [chat, c] of Object.entries(state.chats)) {
      const m = await send(chat, needsText(a, c.lang));
      if (m && a.issue && a.issue.identifier && a.company) sent.set(`${chat}:${m.message_id}`, { issue: a.issue.identifier, name: a.name });
    }
    if (sent.size > 500) sent.delete(sent.keys().next().value);
  }
  async function notifyFail(a) {
    for (const [chat, c] of Object.entries(state.chats)) {
      const t = tr(c.lang), f = a.fail;
      await send(chat, [f ? t.failed(esc(a.name)) : t.errored(esc(a.name)), esc((f && f.error) || a.error), f && f.code ? `<code>${esc(f.code)}</code>` : '', '', links([[t.open, agentLink(a)]])].filter((x, k, all) => x || k === all.length - 2).join('\n'));
    }
  }

  // Watch the office: tell paired chats when an agent starts needing you or fails.
  let known = null;
  async function watch() {
    if (stopped) return;
    try {
      const { agents } = await snapshot(self);
      const now = new Map(agents.map((a) => [a.id, a]));
      if (known && Object.keys(state.chats).length) {
        for (const a of agents) {
          const before = known.get(a.id);
          const needKey = a.needs ? `${a.issue && a.issue.identifier || ''}` : null;
          if (needKey !== null && (!before || before.needKey !== needKey)) await notifyNeeds(a);
          if (a.fail && (!before || before.failId !== a.fail.id)) await notifyFail(a);
          else if (!a.fail && a.status === 'error' && before && before.status !== 'error') await notifyFail(a);
        }
      }
      known = new Map([...now].map(([id, a]) => [id, { needKey: a.needs ? `${a.issue && a.issue.identifier || ''}` : null, failId: a.fail && a.fail.id, status: a.status }]));
    } catch (e) { log(`Telegram: ${e.message}`); }
    if (!stopped) setTimeout(watch, opts.interval || 10000).unref();
  }

  async function answer(chatId, lang, identifier, text) {
    const t = tr(lang);
    if (!opts.replies || !opts.postComment) return send(chatId, `${esc(t.repliesOff)}`);
    const r = await opts.postComment(identifier, text);
    return send(chatId, r.ok ? esc(t.sent(identifier)) : esc(t.sendFail(identifier, r.error || r.status)));
  }

  async function onMessage(m) {
    const chatId = String(m.chat && m.chat.id);
    const text = String(m.text || '').trim();
    const lang = /^tr/i.test((m.from && m.from.language_code) || '') ? 'tr' : 'en';
    const paired = !!state.chats[chatId];
    const [cmd, ...rest] = text.split(/\s+/);
    const command = cmd.startsWith('/') ? cmd.slice(1).split('@')[0].toLowerCase() : '';
    if (command === 'start') {
      if (paired || rest[0] === code) {
        if (!paired) { state.chats[chatId] = { lang }; saveState(); log(`Telegram: chat ${chatId} linked`); }
        return send(chatId, `${esc(tr(lang).paired)}\n\n${esc(tr(lang).help)}`);
      }
      return send(chatId, esc(tr(lang).pairFirst));
    }
    if (!paired) return send(chatId, esc(tr(lang).pairFirst));
    if (state.chats[chatId].lang !== lang) { state.chats[chatId].lang = lang; saveState(); }
    const t = tr(lang);
    if (m.reply_to_message && !command) {
      const ref = sent.get(`${chatId}:${m.reply_to_message.message_id}`);
      if (!ref) return send(chatId, esc(t.which));
      return answer(chatId, lang, ref.issue, text);
    }
    if (command === 'answer' || command === 'yanit' || command === 'yanıt') {
      if (rest.length < 2) return send(chatId, esc(t.which));
      return answer(chatId, lang, rest[0].toUpperCase(), rest.slice(1).join(' '));
    }
    if (command === 'status' || command === 'durum') {
      const { agents } = await snapshot(self);
      const n = agents.length, run = agents.filter((a) => a.status === 'running').length, wait = agents.filter((a) => a.needs).length, err = agents.filter((a) => a.status === 'error').length;
      return send(chatId, `${esc(t.status(n, run, wait, err))}\n${links([[t.office, cubicleLink()]])}`);
    }
    if (command === 'waiting' || command === 'bekleyen') {
      const { agents } = await snapshot(self);
      const w = agents.filter((a) => a.needs);
      if (!w.length) return send(chatId, esc(t.nobody));
      for (const a of w.slice(0, 10)) {
        const msg = await send(chatId, needsText(a, lang));
        if (msg && a.issue && a.issue.identifier) sent.set(`${chatId}:${msg.message_id}`, { issue: a.issue.identifier, name: a.name });
      }
      return null;
    }
    if (command === 'kpi') {
      const k = await kpiSummary(self).catch(() => null);
      return send(chatId, `📊 <b>${esc(t.kpi)}</b>\n${k ? esc(t.kpiLine(k.open, k.avg, k.done7)) : ''}\n${links([[t.kpi, cubicleLink('?kpi')]])}`);
    }
    if (command === 'office' || command === 'ofis' || command === 'cubicle') return send(chatId, links([[t.office, cubicleLink()]]));
    return send(chatId, esc(t.help));
  }

  let warned409 = false;
  async function poll() {
    while (!stopped) {
      const r = await call('getUpdates', { offset: state.offset, timeout: opts.pollTimeout ?? 50, allowed_updates: ['message'] });
      if (r.status === 409) {
        if (!warned409) { log('Telegram: another program is reading this bot’s updates (Paperclip’s own Telegram connection?). Give Cubicle a bot of its own; messages are still sent.'); warned409 = true; }
        await new Promise((res) => setTimeout(res, 60000).unref());
        continue;
      }
      if (!r.json || !r.json.ok) { await new Promise((res) => setTimeout(res, r.status === 401 ? 300000 : 5000).unref()); if (r.status === 401) log('Telegram: the bot token was refused'); continue; }
      for (const u of r.json.result || []) {
        state.offset = u.update_id + 1;
        if (u.message) { try { await onMessage(u.message); } catch (e) { log(`Telegram: ${e.message}`); } }
      }
      if ((r.json.result || []).length) saveState();
    }
  }

  log(Object.keys(state.chats).length
    ? `Telegram: on, ${Object.keys(state.chats).length} linked chat(s). To link another, send the bot: /start ${code}`
    : `Telegram: on. To link your chat, send the bot: /start ${code}`);
  poll();
  watch();
  return { code, chats: () => Object.keys(state.chats).length, stop() { stopped = true; }, snapshot: () => snapshot(self) };
}

module.exports = { start, snapshot, kpiSummary };
