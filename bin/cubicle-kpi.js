// The KPI board without Paperclip: the tasks you gave the CEO (the task box) and the GitHub issues
// each one turned into, kept in ~/.cubicle/kpi.json. A task's progress comes from its issues:
// queued, a worker on it, a PR in review, waiting for you, closed. Issues are read with `gh`.
// What Paperclip held before can be imported once (`cubicle kpi-import`), so the history stays.
'use strict';
const fs = require('fs');
const path = require('path');

const ISSUE_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/g;
const DAY = 86400000;

function create({ file, gh, readLog = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } }, now = () => Date.now() }) {
  let db = { tasks: {}, issues: {}, imported: [] };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (_) {}
  let dirty = false;
  const save = () => {
    if (!dirty) return; dirty = false;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, file); } catch (_) {}
  };

  // a CEO run you started (not one Cubicle started itself): keep its text, times, state and issues
  function record(run) {
    if (!run || !run.id || run.auto) return;
    const t = db.tasks[run.id] || { id: run.id, createdAt: run.created || run.started || now(), issues: [] };
    const text = String(run.fullText || run.text || '').trim();
    t.title = (t.title || text.split('\n')[0]).slice(0, 200);
    t.state = run.state;
    if (run.state !== 'queued' && run.started) t.startedAt = t.startedAt || run.started;
    if (run.ended) t.endedAt = run.ended;
    if (run.pcId) t.pcId = run.pcId;
    if (run.logFile && run.state !== 'queued') {
      const log = readLog(run.logFile);
      const seen = new Set(t.issues);
      for (const m of log.matchAll(ISSUE_URL)) seen.add(`${m[1]}#${m[2]}`);
      t.issues = [...seen].slice(0, 40);
      const tail = log.slice(-2500);
      t.decision = /DECISION:\s*(?!none\b|yok\b|-)\S/i.test(tail);
    }
    db.tasks[run.id] = t; dirty = true; save();
  }

  // GitHub issue states, refreshed a few at a time; closed ones are not read again
  const LABELS = [['agent:blocked-human', 'blocked'], ['agent:failed', 'blocked'], ['agent:review', 'in_review'], ['agent:working', 'in_progress'], ['agent:ready', 'todo']];
  let refreshing = null;
  function refresh(maxAgeMs = 180000) {
    if (refreshing || !gh) return refreshing || Promise.resolve();
    const due = [...new Set(Object.values(db.tasks).flatMap((t) => t.issues || []))]
      .filter((k) => { const s = db.issues[k]; return !s || (!s.closed && now() - (s.at || 0) > maxAgeMs); }).slice(0, 12);
    if (!due.length) return Promise.resolve();
    refreshing = (async () => {
      for (const key of due) {
        const [repo, n] = key.split('#');
        const r = await gh(['issue', 'view', n, '--repo', repo, '--json', 'title,state,stateReason,labels,createdAt,closedAt']);
        if (!r || !r.data) { db.issues[key] = { ...(db.issues[key] || {}), at: now() }; continue; }
        const d = r.data, names = (d.labels || []).map((l) => l.name);
        const closed = d.state === 'CLOSED';
        const status = closed ? (d.stateReason === 'NOT_PLANNED' ? 'cancelled' : 'done') : ((LABELS.find(([l]) => names.includes(l)) || [])[1] || 'todo');
        db.issues[key] = { title: String(d.title || '').slice(0, 200), status, closed, createdAt: d.createdAt, closedAt: d.closedAt || null, at: now() };
        dirty = true;
      }
      save(); refreshing = null;
    })().catch(() => { refreshing = null; });
    return refreshing;
  }

  // the board's rows, in the shape the page's KPI reads (the same as Paperclip's issues)
  function list() {
    const out = [], pcIds = new Set();
    const since = now() - 120 * DAY;
    for (const t of Object.values(db.tasks)) {
      if (t.pcId) pcIds.add(t.pcId);
      const kids = (t.issues || []).map((k) => [k, db.issues[k]]).filter(([, s]) => s);
      const open = kids.filter(([, s]) => !s.closed);
      let status, completedAt = null;
      if (t.state === 'queued') status = 'todo';
      else if (t.state === 'running') status = 'in_progress';
      else if (t.state === 'failed') status = 'blocked';
      else if (kids.length && open.length) status = t.decision ? 'blocked' : 'in_progress';
      else if (t.decision && !kids.length) status = 'blocked';
      else { status = 'done'; completedAt = new Date(Math.max(t.endedAt || 0, ...kids.map(([, s]) => Date.parse(s.closedAt) || 0)) || now()).toISOString(); }
      if (completedAt && Date.parse(completedAt) < since) continue;
      const id = `ceo:${t.id}`;
      out.push({ id, identifier: t.id, title: t.title, status, parentId: null, human: true, createdAt: new Date(t.createdAt).toISOString(),
        startedAt: t.startedAt ? new Date(t.startedAt).toISOString() : null, completedAt, asksYou: !!t.decision && status === 'blocked' });
      for (const [k, s] of kids) {
        out.push({ id: `gh:${k}`, identifier: k.replace(/^[^/]+\//, ''), title: s.title, status: s.status, parentId: id, human: false,
          createdAt: s.createdAt, startedAt: s.createdAt, completedAt: s.closed ? s.closedAt : null, ...(s.status === 'blocked' ? { asksYou: true } : {}) });
      }
    }
    // the Paperclip history, without the CEO tasks that are kept here now
    for (const i of db.imported || []) if (!pcIds.has(i.id)) out.push(i);
    return out;
  }

  // one-off: Paperclip's issues (people's tasks and everything under them) into kpi.json
  async function importPaperclip(base, fetchJSON) {
    const cs = await fetchJSON(`${base}/api/companies`);
    const all = [];
    for (const c of Array.isArray(cs) ? cs : []) {
      for (let page = 0; page < 20; page++) {
        const raw = await fetchJSON(`${base}/api/companies/${c.id}/issues?limit=1000&offset=${page * 1000}`);
        all.push(...(Array.isArray(raw) ? raw : [])); if (!Array.isArray(raw) || raw.length < 1000) break;
      }
    }
    const keep = ['id', 'identifier', 'title', 'status', 'parentId', 'assigneeAgentId', 'createdAt', 'startedAt', 'completedAt', 'cancelledAt'];
    db.imported = all.filter((i) => i && i.id && !i.conversationAgentId).map((i) => ({
      ...Object.fromEntries(keep.filter((k) => i[k] !== undefined).map((k) => [k, i[k]])), human: !!i.createdByUserId, imported: true }));
    dirty = true; save();
    return db.imported.length;
  }

  return { record, refresh, list, importPaperclip, count: () => Object.keys(db.tasks).length + (db.imported || []).length };
}

module.exports = { create };
