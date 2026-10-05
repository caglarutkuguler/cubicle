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
const isUserId = (id) => typeof id === 'string' && /^[1-9]\d{0,15}$/.test(id) && Number.isSafeInteger(Number(id));

const TEXT = {
  en: {
    needs: (n) => `✋ <b>${n}</b> needs you`, why: 'Reason', open: 'See in Cubicle', inPaperclip: 'Open in Paperclip',
    replyHint: 'Reply to this message to answer; it becomes a comment on the issue.',
    replyHintQ: 'Reply to this message with the option’s number, or write your own answer; it becomes a comment on the issue.', other: 'or write your own answer',
    failed: (n) => `⚠ <b>${n}</b>: the last run failed`, errored: (n) => `⚠ <b>${n}</b> is in error`,
    paired: 'This chat is now linked to the office. You will get a message when an agent needs you.',
    pairFirst: 'This chat is not linked yet. Send the 6-digit code shown in Cubicle (⚙ → Telegram), e.g. /start 123456',
    help: '/status – the office now\n/waiting – who needs you\n/kpi – the tasks you gave\n/office – open Cubicle\n/answer ID text – answer an issue\n/mute name, /unmute name – no alerts for one agent\n/alerts all | questions | failures – which alerts you get (or just /questions, /errors, /all)\n/skip – move on to the next one waiting\nAgents waiting for you come one at a time; just write your answer.',
    muted: (n) => `🔕 No more alerts for <b>${n}</b>. /unmute ${n} turns them back on.`, unmuted: (n) => `🔔 Alerts for <b>${n}</b> are back on.`,
    mutedList: (l) => (l.length ? `🔕 Muted: ${l.join(', ')}` : '🔔 No agent is muted.'), noAgent: (q, l) => `No agent called “${q}”. Agents: ${l.join(', ')}`,
    alerts: { all: '🔔 You get every alert: questions and waiting agents, and failed runs.', questions: '🔔 You get only agents that need you (questions, approvals).', failures: '🔔 You get only failed runs and errors.' },
    alertsHelp: 'Write /alerts all, /alerts questions or /alerts failures.',
    status: (n, run, wait, err) => `${n} agents · ${run} working · ${wait} need you${err ? ` · ${err} in error` : ''}`,
    nobody: 'Nobody is waiting for you.', office: 'Open the office', kpi: 'Tasks you gave',
    kpiLine: (open, avg, done7) => `${open} open · average progress ${avg === null ? '–' : avg + '%'} · ${done7} done in 7 days`,
    sent: (id) => `✓ Sent to ${id}.`, sendFail: (id, e) => `Could not write to ${id}: ${e}`,
    repliesOff: 'Answering from Telegram is off (start Cubicle with --telegram-replies). Open the issue instead:',
    which: 'Reply to a “needs you” message, or write /answer ID text.',
    step: (i, n) => `question ${i} of ${n}`, more: (n) => `${n} more waiting after this one.`, skipHint: '/skip moves on to the next one.',
    answerHere: 'Write your answer here (the option’s number, or your own words).', skipped: 'Skipped.', queued: (n) => `${n} waiting; here is the first. The next one comes when you answer.`,
    elsewhere: (id) => `${id} was answered elsewhere; moving on.`, allDone: '✓ That was the last one; nobody else is waiting for you.',
  },
  tr: {
    needs: (n) => `✋ <b>${n}</b> sizi bekliyor`, why: 'Neden', open: 'Cubicle’da gör', inPaperclip: 'Paperclip’te aç',
    replyHint: 'Yanıtlamak için bu mesajı yanıtlayın; yanıtınız işe yorum olarak yazılır.',
    replyHintQ: 'Bu mesajı seçeneğin numarasıyla ya da kendi cevabınızla yanıtlayın; yanıtınız işe yorum olarak yazılır.', other: 'ya da kendi cevabınızı yazın',
    failed: (n) => `⚠ <b>${n}</b>: son çalıştırma başarısız`, errored: (n) => `⚠ <b>${n}</b> hata durumunda`,
    paired: 'Bu sohbet ofise bağlandı. Bir ajan sizi beklediğinde mesaj gelecek.',
    pairFirst: 'Bu sohbet henüz bağlı değil. Cubicle’da (⚙ → Telegram) görünen 6 haneli kodu gönderin, örneğin: /start 123456',
    help: '/durum – ofisin şu anki hâli\n/bekleyen – sizi bekleyenler\n/kpi – verdiğiniz görevler\n/ofis – Cubicle’ı aç\n/yanit ID metin – bir işi yanıtla\n/sustur ad, /ac ad – bir ajan için bildirim kapat / aç\n/bildirim hepsi | sorular | hatalar – hangi bildirimler gelsin\n/atla – sıradakine geç\nSizi bekleyenler tek tek gelir; cevabınızı yazmanız yeterli.',
    muted: (n) => `🔕 <b>${n}</b> için bildirim gelmeyecek. Yeniden açmak için: /ac ${n}`, unmuted: (n) => `🔔 <b>${n}</b> için bildirimler yeniden açık.`,
    mutedList: (l) => (l.length ? `🔕 Susturulan: ${l.join(', ')}` : '🔔 Susturulan ajan yok.'), noAgent: (q, l) => `“${q}” adında ajan yok. Ajanlar: ${l.join(', ')}`,
    alerts: { all: '🔔 Bütün bildirimler gelir: sizi bekleyen ajanlar, sorular ve başarısız çalıştırmalar.', questions: '🔔 Yalnızca sizi bekleyen ajanlar (sorular, onaylar) bildirilir.', failures: '🔔 Yalnızca başarısız çalıştırmalar ve hatalar bildirilir.' },
    alertsHelp: '/bildirim hepsi, /bildirim sorular ya da /bildirim hatalar yazın.',
    status: (n, run, wait, err) => `${n} ajan · ${run} çalışıyor · ${wait} sizi bekliyor${err ? ` · ${err} hatada` : ''}`,
    nobody: 'Sizi bekleyen yok.', office: 'Ofisi aç', kpi: 'Verdiğiniz görevler',
    kpiLine: (open, avg, done7) => `${open} açık · ortalama ilerleme ${avg === null ? '–' : '%' + avg} · 7 günde ${done7} bitti`,
    sent: (id) => `✓ ${id} işine yazıldı.`, sendFail: (id, e) => `${id} işine yazılamadı: ${e}`,
    repliesOff: 'Telegram’dan yanıt kapalı (Cubicle’ı --telegram-replies ile başlatın). İşi buradan açın:',
    which: '“Sizi bekliyor” mesajını yanıtlayın ya da /yanit ID metin yazın.',
    step: (i, n) => `soru ${i}/${n}`, more: (n) => `Bundan sonra ${n} tane daha sizi bekliyor.`, skipHint: '/atla ile sıradakine geçersiniz.',
    answerHere: 'Cevabınızı buraya yazın (seçeneğin numarası ya da kendi cümleniz).', skipped: 'Geçildi.', queued: (n) => `${n} tane sizi bekliyor; ilki geliyor. Cevapladıkça sıradaki gelir.`,
    elsewhere: (id) => `${id} başka yerden yanıtlanmış; sıradakine geçiliyor.`, allDone: '✓ Sonuncusuydu; sizi bekleyen kalmadı.',
  },
};
// Each agent's newest run, finished or not (by when it started): a failure counts only while no
// later run has begun.
const runTime = (r) => String(r.startedAt || r.createdAt || r.finishedAt || '');
function latestRuns(runs) {
  const latest = new Map();
  for (const r of Array.isArray(runs) ? runs : []) if (r && r.agentId && runTime(r) && (!latest.has(r.agentId) || runTime(r) > runTime(latest.get(r.agentId)))) latest.set(r.agentId, r);
  return latest;
}
// A review path that waits on a person: the board or a user, or an interaction (questions,
// confirmations), whose responder Paperclip gives as the agent.
const asksPerson = (x) => !!x && (/board|user|human/i.test(String(x.responder || '')) || x.kind === 'interaction');
const tr = (lang) => TEXT[lang] || TEXT.en;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CLOSED = new Set(['done', 'cancelled']);
const FAILED_RUNS = new Set(['failed', 'error', 'timed_out']);

function request(url, { method = 'GET', headers = {}, body = null, timeout = 70000, onRequest = null } = {}) {
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
    if (onRequest) onRequest(req);
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
        const latest = latestRuns(runs);
        for (const a of as || []) {
          const mine = (issues || []).filter((i) => i.assigneeAgentId === a.id && !CLOSED.has(i.status));
          const ask = mine.find((i) => ((i.reviewAttention && i.reviewAttention.paths) || []).some(asksPerson));
          const task = mine.find((i) => i.status === 'in_progress') || mine[0] || null;
          const run = latest.get(a.id);
          const askPath = ask && ask.reviewAttention.paths.find(asksPerson);
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

// Checks a token with Telegram: { ok, username } or { ok: false, error }.
async function getMe(token) {
  if (!/^\d{5,}:[\w-]{20,}$/.test(String(token || ''))) return { ok: false, error: 'format' };
  const r = await request(`${API}/bot${token}/getMe`, { method: 'POST', body: {}, timeout: 15000 });
  if (r.json && r.json.ok && r.json.result) return { ok: true, username: r.json.result.username };
  return { ok: false, error: r.status === 401 || r.status === 404 ? 'refused' : r.status ? `http ${r.status}` : 'unreachable' };
}

function start(opts) {
  const { token, self, log = console.log } = opts;
  const stateFile = opts.stateFile;
  let allowEveryone = opts.allowEveryone !== false;
  let allowedUsers = new Set((opts.allowedUsers || []).filter(isUserId));
  const canSend = (chatId) => allowEveryone || allowedUsers.has(String(chatId));
  let state = { chats: {}, offset: 0 };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch (_) {}
  for (const id of String(process.env.CUBICLE_TELEGRAM_CHAT || '').split(',').map((x) => x.trim()).filter(Boolean)) state.chats[id] = state.chats[id] || { lang: 'tr' };
  const saveState = () => {
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 }); } catch (_) {}
  };
  // The pairing code stays the same across restarts (it lives in the state file), so a link or QR
  // code made before an update still works.
  if (!/^\d{6}$/.test(String(state.code || ''))) { state.code = String(crypto.randomInt(100000, 1000000)); saveState(); }
  const code = state.code;
  const seen = { any: 0, unpaired: 0 };   // when a message last came in, and an unlinked /start
  let pending = null;               // the long poll in flight, cancelled by stop()
  const call = (method, body) => request(`${API}/bot${token}/${method}`, { method: 'POST', body, timeout: method === 'getUpdates' ? 70000 : 20000,
    onRequest: method === 'getUpdates' ? (q) => { pending = q; } : null });
  let stopped = false;

  const cubicleLink = (q = '') => `${opts.publicUrl.replace(/\/$/, '')}/${q}`;
  // A Paperclip on 127.0.0.1 cannot be opened from a phone: when Cubicle has a phone address, such
  // links are left out (answer by replying in Telegram instead).
  const local = (u) => { try { return /^(127\.|localhost$|\[::1\]$)/.test(new URL(u).hostname); } catch (_) { return true; } };
  const issueLink = (a, i) => (a.company && a.paperclip && i && i.identifier && !(local(opts.paperclipPublicUrl || a.paperclip) && !local(opts.publicUrl)) ? `${(opts.paperclipPublicUrl || a.paperclip).replace(/\/$/, '')}/${encodeURIComponent(a.company.issuePrefix)}/issues/${encodeURIComponent(i.identifier)}` : '');
  const agentLink = (a) => cubicleLink(`?agent=${encodeURIComponent(a.id)}${a.company ? `&company=${encodeURIComponent(a.company.issuePrefix)}` : ''}`);

  async function send(chatId, html, extra = {}) {
    // Check here too: a linked chat may have been removed while a snapshot was loading.
    if (stopped || !canSend(chatId)) return null;
    let r = await call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
    // Some links (e.g. 127.0.0.1) can be refused: send it again as plain text, links written out.
    if (r.status === 400 && !stopped && canSend(chatId)) r = await call('sendMessage', { chat_id: chatId, text: html.replace(/<a href="([^"]*)">([^<]*)<\/a>/g, '$2: $1').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), disable_web_page_preview: true, ...extra });
    return r.json && r.json.ok ? r.json.result : null;
  }
  const links = (pairs) => pairs.filter(([, u]) => u).map(([t, u]) => `<a href="${esc(u)}">${esc(t)}</a>`).join(' · ');

  // The questions an agent asks (Paperclip interactions), to read and answer right in the chat.
  async function questionsOf(i) {
    if (!i || !i.identifier) return [];
    try { const b = await self(`/api/issues/${encodeURIComponent(i.identifier)}/interactions`); const list = JSON.parse(b || '[]'); return Array.isArray(list) ? list : []; } catch (_) { return []; }
  }
  function questionsText(list, lang) {
    const out = [];
    for (const x of list.slice(0, 3)) {
      if (x.title) out.push(`❓ <b>${esc(x.title)}</b>`);
      for (const [n, q] of (x.questions || []).slice(0, 4).entries()) {
        if (q.prompt) out.push(`${(x.questions.length > 1) ? `<b>${n + 1})</b> ` : ''}${esc(q.prompt)}`);
        (q.options || []).forEach((o, k) => out.push(`   <b>${k + 1}.</b> ${esc(o.label)}${o.description ? ` · <i>${esc(o.description.slice(0, 160))}</i>` : ''}`));
        if (q.allowOther && (q.options || []).length) out.push(`   <i>${esc(tr(lang).other)}</i>`);
      }
    }
    return out.join('\n').slice(0, 3200);
  }
  function needsText(a, lang, qs = []) {
    const t = tr(lang), i = a.issue, q = qs.length ? questionsText(qs, lang) : '';
    return [t.needs(esc(a.name)),
      i && (i.identifier || i.title) ? `<b>${esc(i.identifier || '')}</b> ${esc(i.title || '')}` : '',
      a.reason && !q ? `${t.why}: ${esc(a.reason)}` : '',
      q, '', links([[t.open, agentLink(a)], [t.inPaperclip, issueLink(a, i)]]),
      opts.replies && a.company && i && i.identifier ? `<i>${esc(q ? t.replyHintQ : t.replyHint)}</i>` : ''].filter((x, k) => x || k === 4).join('\n');
  }
  // A reply of just a number picks that option.
  function pickOption(q, text) {
    const m = /^\s*(\d{1,2})\s*[.)]?\s*$/.exec(text);
    const o = m && q && (q.options || [])[Number(m[1]) - 1];
    return o ? o.label : text;
  }
  // Per chat: agents muted by name, and which kinds of alerts it wants (all, questions, failures).
  const wants = (c, a, kind) => !(c.muted || []).includes(String(a.name).toLowerCase()) && (!c.only || c.only === 'all' || c.only === kind);

  // One thing at a time. Each chat has a queue of agents waiting for it; only the first is sent,
  // and each of its questions comes as its own message. Your answer (a reply, or just the next
  // message you write) goes to that question; when all of an issue's questions are answered they
  // are posted as one comment, and the next agent in the queue comes. Kept in the state file, so a
  // restart picks up where it was. Without replies turned on, nothing can be answered here: the
  // messages simply come as they happen.
  const compact = (qs) => qs.slice(0, 3).flatMap((x) => (x.questions || []).slice(0, 6).map((q, n) => ({
    title: n === 0 ? String(x.title || '').slice(0, 200) : '', prompt: String(q.prompt || '').slice(0, 1500), other: !!q.allowOther,
    options: (q.options || []).slice(0, 12).map((o) => ({ label: String(o.label || '').slice(0, 200), description: String(o.description || '').slice(0, 200) })) })));
  function stepText(c, cur) {
    const t = tr(c.lang), a = cur.agent, q = cur.steps[cur.at];
    const head = [t.needs(esc(a.name)), cur.issue ? `<b>${esc(cur.issue)}</b> ${esc(cur.title || '')}` : ''];
    let body = [];
    if (q) {
      if (q.title) body.push(`❓ <b>${esc(q.title)}</b>`);
      if (cur.steps.length > 1) body.push(`<i>${esc(t.step(cur.at + 1, cur.steps.length))}</i>`);
      if (q.prompt) body.push(esc(q.prompt));
      q.options.forEach((o, k) => body.push(`   <b>${k + 1}.</b> ${esc(o.label)}${o.description ? ` · <i>${esc(o.description.slice(0, 160))}</i>` : ''}`));
      if (q.other && q.options.length) body.push(`   <i>${esc(t.other)}</i>`);
    } else if (cur.reason) body.push(`${t.why}: ${esc(cur.reason)}`);
    const tail = ['', links([[t.open, agentLink(a)], [t.inPaperclip, issueLink(a, { identifier: cur.issue })]])];
    if (opts.replies && cur.issue) tail.push(`<i>${esc(t.answerHere)}</i>`);
    const left = (c.queue || []).length;
    if (left) tail.push(`<i>${esc(t.more(left))} ${esc(t.skipHint)}</i>`);
    return [...head.filter(Boolean), ...body, ...tail].join('\n').slice(0, 3900);
  }
  async function showCurrent(chat) {
    const c = state.chats[chat], cur = c && c.current; if (!cur) return;
    const m = await send(chat, stepText(c, cur));
    if (m) { cur.msg = m.message_id; saveState(); }
  }
  async function nextFor(chat) {
    const c = state.chats[chat]; if (!c) return;
    c.current = null;
    while ((c.queue || []).length) {
      const item = c.queue.shift();
      const qs = item.issue ? await questionsOf({ identifier: item.issue }) : [];
      c.current = { ...item, steps: compact(qs), at: 0, answers: [] };
      break;
    }
    saveState();
    if (c.current) await showCurrent(chat);
  }
  function enqueue(chat, a) {
    const c = state.chats[chat]; c.queue = c.queue || [];
    const key = a.issue && a.issue.identifier ? a.issue.identifier : `agent:${a.id}`;
    if ((c.current && c.current.key === key) || c.queue.some((x) => x.key === key)) return false;
    c.queue.push({ key, issue: a.issue && a.issue.identifier ? a.issue.identifier : '', title: a.issue && a.issue.title ? String(a.issue.title).slice(0, 200) : '',
      reason: String(a.reason || '').slice(0, 300), agent: { id: a.id, name: a.name, company: a.company ? { issuePrefix: a.company.issuePrefix } : null, paperclip: a.paperclip } });
    return true;
  }
  async function notifyNeeds(a) {
    for (const [chat, c] of Object.entries(state.chats)) {
      if (!wants(c, a, 'questions')) continue;
      if (!opts.replies) { const qs = await questionsOf(a.issue); await send(chat, needsText(a, c.lang, qs)); continue; }
      if (enqueue(chat, a) && !c.current) await nextFor(chat);
      else saveState();
    }
  }
  // An answer to the question on screen: one step at a time, posted once the issue's last question is answered.
  async function answerCurrent(chat, text) {
    const c = state.chats[chat], cur = c.current, t = tr(c.lang);
    if (!cur.issue) { await nextFor(chat); return; }
    const q = cur.steps[cur.at];
    cur.answers.push(q ? pickOption(q, text) : text);
    if (q && cur.at + 1 < cur.steps.length) { cur.at++; saveState(); return showCurrent(chat); }
    const body = cur.steps.length > 1
      ? cur.steps.map((s2, k) => `**${(s2.prompt || s2.title || `${k + 1}`).replace(/\s+/g, ' ').slice(0, 140)}**\n${cur.answers[k]}`).join('\n\n')
      : cur.answers[0];
    const r = opts.postComment ? await opts.postComment(cur.issue, body) : { ok: false, error: 'off' };
    if (!r.ok) { cur.answers.pop(); saveState(); return send(chat, esc(t.sendFail(cur.issue, r.error || r.status))); }
    await send(chat, esc(t.sent(cur.issue)));
    await nextFor(chat);
    if (!c.current) await send(chat, esc(t.allDone));
  }
  async function notifyFail(a) {
    for (const [chat, c] of Object.entries(state.chats)) {
      if (!wants(c, a, 'failures')) continue;
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
      // Answered in Paperclip (or no longer waiting): drop it from the queues, move on if it was on screen.
      const open = new Set(agents.filter((a) => a.needs).map((a) => (a.issue && a.issue.identifier ? a.issue.identifier : `agent:${a.id}`)));
      for (const [chat, c] of agents.length ? Object.entries(state.chats) : []) {      // nothing read: change nothing
        const before2 = (c.queue || []).length;
        c.queue = (c.queue || []).filter((x) => open.has(x.key));
        if (c.current && !open.has(c.current.key) && !(c.current.answers || []).length) {
          const id = c.current.issue || c.current.agent.name;
          c.current = null; await send(chat, esc(tr(c.lang).elsewhere(id))); await nextFor(chat);
        } else if (before2 !== c.queue.length) saveState();
      }
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
    // In restricted mode, check the sender before pairing or handling any command. Group chats
    // cannot be authorized by adding a member: replies there would disclose data to everyone.
    if (!allowEveryone && (m.chat?.type !== 'private' || m.sender_chat || m.from?.is_bot
      || String(m.from?.id) !== chatId || !allowedUsers.has(chatId))) return;
    const text = String(m.text || '').trim();
    const lang = /^tr/i.test((m.from && m.from.language_code) || '') ? 'tr' : 'en';
    const paired = !!state.chats[chatId];
    const [cmd, ...rest] = text.split(/\s+/);
    const command = cmd.startsWith('/') ? cmd.slice(1).split('@')[0].toLowerCase() : '';
    seen.any = Date.now();
    // "/start 123456", or just the six digits
    const given = command === 'start' ? rest[0] : (!command && /^\d{6}$/.test(cmd) ? cmd : null);
    if (command === 'start' || (!paired && given)) {
      if (paired || given === code) {
        if (!paired) { state.chats[chatId] = { lang }; saveState(); log(`Telegram: chat ${chatId} linked`); }
        return send(chatId, `${esc(tr(lang).paired)}\n\n${esc(tr(lang).help)}`);
      }
      seen.unpaired = Date.now();
      return send(chatId, esc(tr(lang).pairFirst));
    }
    if (!paired) { seen.unpaired = Date.now(); return send(chatId, esc(tr(lang).pairFirst)); }
    if (state.chats[chatId].lang !== lang) { state.chats[chatId].lang = lang; saveState(); }
    const t = tr(lang);
    const me0 = state.chats[chatId];
    // Any message that is not a command answers the question on screen (a reply works too).
    if (!command && text && me0.current && opts.replies) return answerCurrent(chatId, text);
    if (!command && m.reply_to_message) return send(chatId, esc(t.which));
    if (command === 'skip' || command === 'atla' || command === 'gec' || command === 'geç') {
      if (!me0.current) return send(chatId, esc(t.nobody));
      if (me0.current.answers && me0.current.answers.length) me0.current.answers = [];
      await send(chatId, esc(t.skipped));
      await nextFor(chatId);
      if (!me0.current) return send(chatId, esc(t.allDone));
      return null;
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
      if (!opts.replies) {
        for (const a of w.slice(0, 10)) await send(chatId, needsText(a, lang, await questionsOf(a.issue)));
        return null;
      }
      for (const a of w) enqueue(chatId, a);
      saveState();
      if (me0.current) return showCurrent(chatId);           // show again what is waiting for an answer
      const n = me0.queue.length;
      if (n > 1) await send(chatId, esc(t.queued(n)));
      return nextFor(chatId);
    }
    if (command === 'kpi') {
      const k = await kpiSummary(self).catch(() => null);
      return send(chatId, `📊 <b>${esc(t.kpi)}</b>\n${k ? esc(t.kpiLine(k.open, k.avg, k.done7)) : ''}\n${links([[t.kpi, cubicleLink('?kpi')]])}`);
    }
    if (command === 'office' || command === 'ofis' || command === 'cubicle') return send(chatId, links([[t.office, cubicleLink()]]));
    const me = state.chats[chatId];
    if (['mute', 'unmute', 'muted', 'sustur', 'ac', 'aç', 'susturulan'].includes(command)) {
      const off = ['mute', 'sustur'].includes(command), on = ['unmute', 'ac', 'aç'].includes(command);
      me.muted = me.muted || [];
      const q = rest.join(' ').trim().toLowerCase();
      if (!q || (!off && !on)) return send(chatId, esc(t.mutedList(me.muted)));
      const { agents } = await snapshot(self);
      const names = [...new Set(agents.map((a) => String(a.name)))];
      const hit = names.find((n) => n.toLowerCase() === q) || names.find((n) => n.toLowerCase().startsWith(q))
        || (on ? me.muted.find((n) => n === q || n.startsWith(q)) : null);
      if (!hit) return send(chatId, esc(t.noAgent(rest.join(' '), names)));
      const key = hit.toLowerCase();
      me.muted = off ? [...new Set([...me.muted, key])] : me.muted.filter((n) => n !== key);
      saveState();
      return send(chatId, off ? t.muted(esc(hit)) : t.unmuted(esc(hit)));
    }
    // /alerts questions, or the short forms /questions, /errors, /all
    const short = { questions: 'questions', sorular: 'questions', errors: 'failures', failures: 'failures', hatalar: 'failures', all: 'all', hepsi: 'all' }[command];
    if (command === 'alerts' || command === 'bildirim' || short) {
      const pick = short || { all: 'all', hepsi: 'all', questions: 'questions', sorular: 'questions', failures: 'failures', errors: 'failures', hatalar: 'failures' }[String(rest[0] || '').toLowerCase()];
      if (!pick) return send(chatId, `${esc(t.alerts[me.only || 'all'])}\n${esc(t.alertsHelp)}`);
      me.only = pick; saveState();
      return send(chatId, esc(t.alerts[pick]));
    }
    return send(chatId, esc(t.help));
  }

  let warned409 = false, conflicts = 0, polling = 'starting';   // 'ok' | 'conflict' | 'refused' | 'unreachable'
  async function poll() {
    while (!stopped) {
      const r = await call('getUpdates', { offset: state.offset, timeout: opts.pollTimeout ?? 50, allowed_updates: ['message'] });
      if (stopped) return;
      if (r.status === 409) {
        // Right after a restart the previous poll may still be open for a moment; after that it is
        // another program (Paperclip's own Telegram connection?) reading this bot.
        polling = 'conflict';
        if (++conflicts > 3 && !warned409) { log('Telegram: another program is reading this bot’s updates (Paperclip’s own Telegram connection?). Give Cubicle a bot of its own; messages are still sent.'); warned409 = true; }
        await new Promise((res) => setTimeout(res, conflicts > 3 ? 60000 : 3000).unref());
        continue;
      }
      conflicts = 0;
      polling = r.json && r.json.ok ? 'ok' : r.status === 401 ? 'refused' : 'unreachable';
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
  const bot = {
    code, username: '', chats: () => Object.keys(state.chats).filter(canSend).length, seen: () => ({ ...seen }), polling: () => polling,
    linkedUsers: () => Object.keys(state.chats).filter(isUserId),
    setAccess(access) { allowEveryone = access.allowEveryone !== false; allowedUsers = new Set((access.allowedUsers || []).filter(isUserId)); },
    setReplies(v) { opts.replies = !!v; },
    setPublicUrl(u) { opts.publicUrl = u; },
    stop() { stopped = true; if (pending) pending.destroy(new Error('stopped')); },
    snapshot: () => snapshot(self),
  };
  getMe(token).then((m) => { if (m.ok) bot.username = m.username; });
  return bot;
}

module.exports = { start, snapshot, kpiSummary, getMe, isUserId };
