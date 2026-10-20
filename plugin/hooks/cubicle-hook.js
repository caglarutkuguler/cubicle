#!/usr/bin/env node
// Cubicle hook for Claude Code, Codex CLI and Gemini CLI.
// The CLI runs this on its hook events and pipes the event JSON to stdin. It keeps
// ~/.cubicle/<runtime>.json up to date, one agent per session, in the Cubicle feed
// format (docs/FEED.md). No dependencies, no network.
//
//   cubicle install-hooks [codex|gemini]      then: cubicle --source claude-code|codex|gemini
//
// The runtime is the first argument (default: Claude Code). Codex uses Claude Code's event
// names and fields; Gemini CLI's events are mapped onto them below.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.cubicle');

const RUNTIMES = {
  claude: {
    label: 'Claude Code', file: 'claude-code.json', settings: path.join(os.homedir(), '.claude', 'settings.json'),
    events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
      'Notification', 'PreCompact', 'Stop', 'StopFailure', 'SessionEnd', 'SubagentStart', 'SubagentStop'],
    timeout: () => 5, reply: '',
  },
  codex: {
    label: 'Codex', file: 'codex.json', settings: path.join(os.homedir(), '.codex', 'hooks.json'),
    events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
      'PreCompact', 'Stop', 'SessionEnd', 'SubagentStart', 'SubagentStop'],
    timeout: (ev) => (ev === 'SessionEnd' ? 3 : 5),   // seconds; Codex caps SessionEnd hooks at 3 s
    reply: '{}',                                       // Codex expects JSON on stdout for some events
  },
  gemini: {
    label: 'Gemini CLI', file: 'gemini.json', settings: path.join(os.homedir(), '.gemini', 'settings.json'),
    events: ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'Notification', 'PreCompress', 'AfterAgent', 'SessionEnd'],
    timeout: () => 5000, reply: '{}',                  // milliseconds; Gemini parses stdout as JSON
  },
};
const GEMINI_EVENTS = { BeforeAgent: 'UserPromptSubmit', BeforeTool: 'PreToolUse', AfterTool: 'PostToolUse', AfterAgent: 'Stop', PreCompress: 'PreCompact' };
const runtimeOf = (name) => RUNTIMES[name] ? name : 'claude';

// Gemini CLI events carry the same fields under other names; translate them once.
function normalize(ev, runtime) {
  if (runtime !== 'gemini') return ev;
  // Gemini fires PreCompress on every turn, compressing or not: not worth a bubble.
  if (ev.hook_event_name === 'PreCompress') return { ...ev, hook_event_name: 'Ignored' };
  const out = { ...ev, hook_event_name: GEMINI_EVENTS[ev.hook_event_name] || ev.hook_event_name };
  // Tool confirmations carry the command in `details`; show it like a Claude Code permission prompt.
  const d = ev.details || {};
  if (ev.hook_event_name === 'Notification' && (d.command || d.fileName || d.filePath)) {
    out.message = `allow ${String(d.command || path.basename(String(d.fileName || d.filePath))).slice(0, 60)}?`;
  }
  return out;
}

const STALE_MS = 12 * 60 * 60 * 1000; // drop sessions with no event for 12 h

// Headless runs (cron, CI, an issue worker script) can name their character and link its
// card to the ticket they work on, through the environment Claude Code inherits:
//   CUBICLE_NAME      character name instead of the directory name ("ncu-pch #42")
//   CUBICLE_ROLE      card role instead of the runtime label ("Issue worker")
//   CUBICLE_TASK_ID / CUBICLE_TASK_URL / CUBICLE_TASK
//                     ticket id, link and title; the bubble keeps showing the current tool,
//                     the card links to the ticket, and the title shows while idle
//   CUBICLE_MAIN_TASK_ID / CUBICLE_MAIN_TASK
//                     the bigger task this run is part of (e.g. the CEO task that started this
//                     worker); a run started from inside another inherits it, so the alert when
//                     it finishes can say how far that main task has come
//   CUBICLE_LINGER=1  keep the character in the office after SessionEnd (idle, or in error if
//                     the last turn failed) so a finished batch run stays visible until the next
//                     run with the same name or the 12 h stale limit; subagents still leave
function identity(env) {
  const s = (k) => String(env[k] || '').trim();
  const id = { name: s('CUBICLE_NAME'), role: s('CUBICLE_ROLE'), title: s('CUBICLE_TASK'), taskId: s('CUBICLE_TASK_ID'), url: s('CUBICLE_TASK_URL') };
  id.linger = /^(1|true|yes)$/i.test(s('CUBICLE_LINGER'));
  id.ticket = !!(id.taskId || id.url || id.title);
  const mainId = s('CUBICLE_MAIN_TASK_ID'), mainTitle = s('CUBICLE_MAIN_TASK');
  // a main task that is this run's own ticket is no main task
  if ((mainId || mainTitle) && !(mainId && mainId === id.taskId)) id.main = { ...(mainId ? { id: mainId.slice(0, 80) } : {}), ...(mainTitle ? { title: mainTitle.slice(0, 160) } : {}) };
  return id;
}

// What the run said last (its answer or summary), for the alert when it finishes: from the Stop
// event when the CLI sends it, else from the end of the session's transcript. Local file only.
const RESULT_MAX = 1200;
function lastAnswer(ev) {
  const clip = (t) => { t = String(t || '').trim(); return t.length > RESULT_MAX ? '…' + t.slice(-(RESULT_MAX - 1)) : t; };
  if (typeof ev.last_assistant_message === 'string' && ev.last_assistant_message.trim()) return clip(ev.last_assistant_message);
  const f = ev.transcript_path;
  if (!f || typeof f !== 'string') return '';
  let fd = null;
  try {
    fd = fs.openSync(f, 'r');
    const size = fs.fstatSync(fd).size, len = Math.min(size, 512 * 1024), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let j; try { j = JSON.parse(lines[i]); } catch (_) { continue; }
      const c = j && j.type === 'assistant' && j.message && j.message.content;
      const text = Array.isArray(c) ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n').trim() : typeof c === 'string' ? c.trim() : '';
      if (text) return clip(text);
    }
  } catch (_) {} finally { if (fd !== null) try { fs.closeSync(fd); } catch (_) {} }
  return '';
}

// What the card shows as the task: the tool summary while running, wrapped with the ticket
// id and link when the run was given one; the ticket title alone when idle.
function taskOf(text, idn) {
  if (!idn.ticket) return text;
  const t = { id: idn.taskId, title: text || idn.title || idn.taskId, url: idn.url };
  if (!t.id) delete t.id;
  if (!t.url) delete t.url;
  return t;
}

function summarize(ev) {
  const tool = ev.tool_name || '';
  const inp = ev.tool_input || {};
  const short = (s, n = 48) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const file = inp.file_path || inp.absolute_path || inp.path;
  if (file && typeof file === 'string') return `${tool} ${path.basename(file)}`;
  if (inp.command) return `${tool}: ${short(inp.command)}`;
  if (inp.description) return `${tool}: ${short(inp.description)}`;
  if (inp.pattern) return `${tool} ${short(inp.pattern, 30)}`;
  if (inp.query) return `${tool}: ${short(inp.query)}`;
  return tool || 'working';
}

// What a session is really working on. One editor window is often opened on one project while
// the work happens in a sibling folder (a portfolio of modules, packages or services): the card
// then takes that folder's name, not the window's. Only edits and `cd` count (reading another
// project for reference does not), temporary folders never do, and a folder inside the window's
// own one keeps the window's name.
const PROJECT_MARKS = ['.git', 'package.json', 'composer.json', 'config.xml', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle'];
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'write_file', 'replace']);
function hostPath(p, cwd) {
  p = String(p || '').trim();
  if (!p) return '';
  if (process.platform === 'win32') {
    const m = /^\/(?:mnt\/)?([a-zA-Z])(\/.*)?$/.exec(p);           // /c/Users/… (Git Bash), /mnt/c/… (WSL)
    if (m) p = `${m[1].toUpperCase()}:${m[2] || '/'}`;
  }
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(cwd || process.cwd(), p);
}
function workTarget(ev) {
  const inp = ev.tool_input || {};
  if (EDIT_TOOLS.has(ev.tool_name)) return inp.file_path || inp.notebook_path || inp.path || '';
  if (ev.tool_name === 'Bash' || ev.tool_name === 'run_shell_command' || ev.tool_name === 'shell') {
    const m = /(?:^|&&|;|\|\||\n)\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(String(inp.command || ''));
    if (m) return m[1] || m[2] || m[3] || '';
  }
  return '';
}
function workFolder(ev) {
  try {
    const cwd = ev.cwd ? path.resolve(ev.cwd) : '';
    const raw = workTarget(ev);
    if (!cwd || !raw || /[$`*?]/.test(raw)) return undefined;
    const p = hostPath(raw, cwd);
    const low = (x) => (process.platform === 'win32' ? x.toLowerCase() : x);
    const inside = (dir, x) => { const r = path.relative(low(dir), low(x)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
    const isProject = (dir) => PROJECT_MARKS.some((f) => fs.existsSync(path.join(dir, f))) || fs.existsSync(path.join(dir, `${path.basename(dir)}.php`));
    // the project a path is in, looking up from it but not above `top`
    const projectBelow = (top) => {
      let dir = fs.existsSync(p) && fs.statSync(p).isDirectory() ? p : path.dirname(p);
      while (dir.length > top.length && inside(top, dir)) { if (isProject(dir)) return path.basename(dir); dir = path.dirname(dir); }
      return '';
    };
    if (inside(cwd, p)) {
      // the window's own project; but a window opened on a folder of projects (no project file of
      // its own) is named after the project inside it that is being worked on
      if (isProject(cwd) || inside(cwd, os.homedir())) return null;      // a project, or home (or above)
      const rel = path.relative(cwd, p).split(path.sep).filter(Boolean);
      if (rel.length < 2) return null;
      return projectBelow(cwd) || rel[0];
    }
    const tmps = [os.tmpdir(), '/tmp', '/var/tmp', 'C:\\tmp', 'C:\\temp', 'C:\\Windows\\Temp'].map((x) => path.resolve(x));
    if (tmps.some((t) => inside(t, p))) return undefined;
    // the deepest folder the window and the target share; a project is looked for below it
    const a = low(cwd).split(path.sep), b = low(p).split(path.sep);
    let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
    const parts = p.split(path.sep), common = parts.slice(0, k).join(path.sep) || path.sep;
    const home = os.homedir();
    if (k === 0 || inside(common, home)) return undefined;            // nothing in common but the drive or home
    return projectBelow(common) || parts[k] || undefined;                                      // the first folder below the shared one
  } catch (_) { return undefined; }
}

// Subagents (Task/Agent tool) share the parent's session_id; Claude Code tells them
// apart with agent_id / agent_type on their hook events. Each subagent gets its own
// character, keyed "<session_id>:<agent_id>", and leaves when it stops.
function applySubagent(feed, agents, ev, now) {
  const sid = ev.session_id || 'unknown';
  const id = `${sid}:${ev.agent_id}`;
  const parent = agents.find((x) => x.id === sid);
  const base = (parent && parent.name) || path.basename(ev.cwd || '') || 'claude';
  let a = agents.find((x) => x.id === id);
  const fresh = () => ({ id, since: now, parent: sid, name: `${base} › ${ev.agent_type || 'subagent'}`, role: `${feed.company || 'Claude Code'} subagent` });

  switch (ev.hook_event_name) {
    case 'SubagentStop':
      return { ...feed, agents: agents.filter((x) => x.id !== id) };
    case 'SubagentStart':
      a = a || fresh();
      Object.assign(a, { status: 'running', task: 'starting', error: null });
      break;
    case 'PreToolUse':
    case 'PostToolUse':
      a = a || fresh();
      Object.assign(a, { status: 'running', task: summarize(ev), error: null });
      remember(a, ev, now);
      break;
    case 'PermissionRequest':
      a = a || fresh();
      Object.assign(a, { status: 'waiting', task: ev.tool_name ? `allow ${summarize(ev)}?` : 'needs your permission' });
      break;
    case 'Notification':
      // A permission prompt from inside a subagent raises the subagent's hand, not the session's.
      // Other notifications are ignored here too, as they are for sessions.
      if (!needsUser(ev)) return feed;
      a = a || fresh();
      Object.assign(a, { status: 'waiting', task: ev.message ? String(ev.message).slice(0, 80) : 'needs your permission' });
      break;
    default:
      return null; // not a subagent-specific event: let the session character handle it
  }
  a.updated = now;
  if (!agents.includes(a)) agents.push(a);
  return { ...feed, agents };
}

// Background tasks a session starts (a shell command with run_in_background, a monitor, …): each
// is a character of its own while it runs, named after its session. Claude Code reports a started
// shell's id in PostToolUse, and on every Stop/SubagentStop the list of tasks still running, so
// finished ones leave then; a stopped session takes its tasks along. Background subagents already
// come and go with SubagentStart/SubagentStop.
function syncBackground(feed, agents, ev, now) {
  const sid = ev.session_id || 'unknown';
  const short = (t, n = 60) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const session = agents.find((x) => x.id === sid);
  const base = (session && session.name) || path.basename(ev.cwd || '') || 'claude';
  const put = (taskId, kind, text) => {
    const id = `${sid}:bg:${taskId}`;
    let a = agents.find((x) => x.id === id);
    if (!a) { a = { id, since: now, parent: sid, bg: true, completedAt: null }; agents.push(a); }
    Object.assign(a, { name: `${base} › ${kind === 'shell' ? 'bg' : kind || 'bg'}`, role: `${feed.company || 'Claude Code'} background task`, status: 'running', task: short(text) || 'background task', error: null, updated: now });
  };
  const resp = ev.tool_response && typeof ev.tool_response === 'object' ? ev.tool_response : null;
  if (ev.hook_event_name === 'PostToolUse' && resp && resp.backgroundTaskId && !ev.agent_id) {
    const inp = ev.tool_input || {};
    put(String(resp.backgroundTaskId).slice(0, 60), 'shell', inp.description || inp.command);
  }
  if (Array.isArray(ev.background_tasks)) {
    const running = ev.background_tasks.filter((t) => t && t.id && t.type !== 'subagent' && (!t.status || t.status === 'running'));
    for (const t of running) put(String(t.id).slice(0, 60), t.type, t.description || t.command);
    const keep = new Set(running.map((t) => `${sid}:bg:${String(t.id).slice(0, 60)}`));
    for (let i = agents.length - 1; i >= 0; i--) if (agents[i].bg && agents[i].parent === sid && !keep.has(agents[i].id)) agents.splice(i, 1);
  }
  // a task stopped by hand (KillShell / TaskStop) leaves at once
  if (ev.hook_event_name === 'PostToolUse' && /^(KillShell|TaskStop|KillBash)$/.test(ev.tool_name || '')) {
    const inp = ev.tool_input || {}, tid = String(inp.shell_id || inp.task_id || inp.bash_id || '');
    const i = agents.findIndex((x) => x.id === `${sid}:bg:${tid}`); if (tid && i >= 0) agents.splice(i, 1);
  }
}

// Where a Claude Code session was started: the CLAUDE_CODE_ENTRYPOINT the CLI sets for its hooks, or the
// "entrypoint" field in the session's transcript. Shown on the card so terminal, VS Code, desktop app and
// headless (Agent SDK) sessions can be told apart.
const ORIGINS = { 'claude-vscode': 'VS Code', cli: 'Terminal', 'claude-desktop': 'Desktop app', remote: 'Cloud',
  'sdk-cli': 'Agent SDK', 'sdk-ts': 'Agent SDK', 'sdk-py': 'Agent SDK', mcp: 'MCP' };
function originOf(ev, env = {}) {
  let ep = String(env.CLAUDE_CODE_ENTRYPOINT || '').trim();
  if (!ep && /^(1|true)$/i.test(String(env.CLAUDE_CODE_REMOTE || ''))) ep = 'remote';
  if (!ep) {
    const tp = ev && (ev.transcript_path || ev.transcriptPath);
    if (tp) {
      try {
        const fd = fs.openSync(String(tp), 'r'); const buf = Buffer.alloc(65536);
        const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
        const m = /"entrypoint":"([^"]+)"/.exec(buf.toString('utf8', 0, n)); if (m) ep = m[1];
      } catch (_) {}
    }
  }
  return ep ? (ORIGINS[ep] || ep) : '';
}

function apply(feed, ev, runtime = 'claude', env = {}) {
  // Grok discovers Claude settings too, but has its own feed example. Do not
  // combine its camelCase sessions under Claude's fallback "unknown" id.
  if (runtime === 'claude' && (ev.sessionId || ev.hookEventName)) return feed;
  ev = normalize(ev, runtime);
  const idn = identity(env);
  const label = RUNTIMES[runtimeOf(runtime)].label, origin = runtimeOf(runtime) === 'claude' ? originOf(ev, env) : '';
  const role = idn.role || (origin ? `${label} · ${origin}` : label);
  const id = ev.session_id || 'unknown';
  const now = Date.now();
  const agents = feed.agents.filter((a) => now - (a.updated || 0) < STALE_MS);
  syncBackground(feed, agents, ev, now);

  if (ev.agent_id) {
    const out = applySubagent(feed, agents, ev, now);
    if (out) return out;
  }

  let a = agents.find((x) => x.id === id);
  // a session working in another project's folder takes that project's name (see workFolder)
  if (!idn.name && a && ev.hook_event_name === 'PreToolUse') {
    const w = workFolder(ev);
    if (w === null && a.work) { delete a.work; a.name = path.basename(ev.cwd || '') || a.name; }
    else if (w && w !== a.work) { a.work = w; a.name = w; }
  }
  const name = idn.name || (a && a.work) || path.basename(ev.cwd || '') || runtimeOf(runtime);
  // one card per name: a new run under a CUBICLE_NAME replaces the idle/finished card of the earlier run
  // with that name (and its subagents), so a repeating worker is one character, not a row of copies.
  if (idn.name && ev.hook_event_name === 'SessionStart') {
    const old = agents.filter((x) => x.id !== id && !x.parent && x.name === name && x.status !== 'running' && x.status !== 'waiting').map((x) => x.id);
    if (old.length) { const keep = agents.filter((x) => !old.includes(x.id) && !old.includes(x.parent)); agents.length = 0; agents.push(...keep); }
  }

  switch (ev.hook_event_name) {
    case 'SessionEnd':
      // The session leaves the office together with any subagents still at their desks,
      // unless it was started with CUBICLE_LINGER: then it stays, idle (or in error).
      if (idn.linger && a) {
        a.updated = now;
        if (a.status !== 'error') Object.assign(a, { status: 'idle', task: taskOf('', idn) || null });
        return { ...feed, agents: agents.filter((x) => x.id === id || x.parent !== id) };
      }
      return { ...feed, agents: agents.filter((x) => x.id !== id && x.parent !== id) };
    case 'SessionStart':
      a = a || { id, since: now };
      Object.assign(a, { name, role, status: 'idle', task: taskOf('', idn) || null, error: null });
      break;
    case 'UserPromptSubmit':
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'running', task: taskOf(idn.title || summarizePrompt(ev.prompt), idn), error: null, turnStart: now });
      delete a.result;
      break;
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PreCompact':
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'running', task: taskOf(ev.hook_event_name === 'PreCompact' ? 'compacting context' : summarize(ev), idn), error: null });
      if (ev.hook_event_name !== 'PreCompact') remember(a, ev, now);
      break;
    case 'PermissionRequest':
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'waiting', task: taskOf(ev.tool_name ? `allow ${summarize(ev)}?` : 'needs your permission', idn) });
      break;
    case 'Notification':
      // Only notifications that ask the user for something raise a hand.
      // idle_prompt (~60 s after a turn), auth_success, agent_completed, quota_* etc. are ignored.
      if (!needsUser(ev)) return feed;
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'waiting', task: taskOf(ev.message ? String(ev.message).slice(0, 80) : 'needs your input', idn) });
      break;
    case 'StopFailure':
      a = a || { id, since: now, name, role };
      Object.assign(a, { status: 'error', error: String(ev.error || ev.message || 'turn failed').slice(0, 120) });
      break;
    case 'Stop': {
      a = a || { id, since: now, name, role };
      if (a.status === 'running' || a.status === 'waiting') a.completedAt = now;
      Object.assign(a, { status: 'idle', task: taskOf('', idn) || null });
      const said = lastAnswer(ev);
      if (said) a.result = said;
      break;
    }
    default:
      return feed; // SubagentStart/SubagentStop without an agent_id etc.: nothing to draw
  }
  a.updated = now;
  if (idn.main) a.main = idn.main;
  if (!Object.hasOwn(a, 'completedAt')) a.completedAt = null;
  if (!agents.includes(a)) agents.push(a);
  return { ...feed, agents };
}

// The last steps an agent took, for its card: [startedAt, summary, duration once it finished].
const RECENT = 8;
function remember(a, ev, now) {
  const text = summarize(ev);
  const list = Array.isArray(a.recent) ? a.recent : [];
  if (ev.hook_event_name === 'PreToolUse') list.push([now, text]);
  else {
    const open = [...list].reverse().find((x) => x[1] === text && x.length === 2);
    if (open) open.push(now - open[0]); else list.push([now, text]);
  }
  a.recent = list.slice(-RECENT);
}

const ASKS_USER = new Set(['permission_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog', 'ToolPermission']);
function needsUser(ev) {
  if (ev.notification_type) return ASKS_USER.has(ev.notification_type);
  // Older Claude Code versions send no type; fall back to the message text.
  const m = String(ev.message || '');
  return /permission|needs your|approve/i.test(m) && !/waiting for your input/i.test(m);
}

function summarizePrompt(p) {
  p = String(p || '').replace(/\s+/g, ' ').trim();
  return p ? (p.length > 60 ? p.slice(0, 59) + '…' : p) : 'thinking';
}

// Several Claude Code sessions (and subagents) fire hooks at the same time. Each run reads,
// changes and rewrites the file, so without a lock one run can overwrite another's update.
// The lock is a file created with O_EXCL; waiting is capped so Claude is never held up, and
// a lock left behind by a crashed run is taken over after STALE_LOCK_MS.
const LOCK_WAIT_MS = 1000;
const STALE_LOCK_MS = 2000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(file, fn) {
  const LOCK = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(LOCK, 'wx'); break; } catch (e) { if (e.code !== 'EEXIST') break; }
    try { if (Date.now() - fs.statSync(LOCK).mtimeMs > STALE_LOCK_MS) { fs.unlinkSync(LOCK); continue; } } catch (_) {}
    if (Date.now() > deadline) break;   // give up waiting, write anyway rather than block Claude
    pause(5 + Math.random() * 10);
  }
  try { return fn(); } finally {
    if (fd !== null) { try { fs.closeSync(fd); fs.unlinkSync(LOCK); } catch (_) {} }
  }
}

function main(runtimeName = process.argv[2]) {
  const runtime = runtimeOf(runtimeName);
  // SDK payloads may be fully snake_case; the hook environment still identifies Grok.
  if (runtime === 'claude' && process.env.GROK_SESSION_ID && process.env.GROK_HOOK_EVENT) {
    process.stdin.resume();
    return;
  }
  const { file, label, reply } = RUNTIMES[runtime];
  const FEED = path.join(DIR, file);
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    // Codex and Gemini read JSON from stdout; an empty object changes nothing.
    if (reply) process.stdout.write(reply + '\n');
    let ev;
    try { ev = JSON.parse(input || '{}'); } catch (_) { return; }
    // A visualisation must never get in Claude's way: swallow every error, exit 0.
    try {
      fs.mkdirSync(DIR, { recursive: true });
      withLock(FEED, () => {
        let feed = { company: label, agents: [] };
        try { const cur = JSON.parse(fs.readFileSync(FEED, 'utf8')); if (Array.isArray(cur.agents)) feed = cur; } catch (_) {}
        // The same event twice (hooks installed both in settings.json and as the Claude plugin) counts once.
        const key = [ev.session_id, ev.hook_event_name, ev.tool_use_id, ev.agent_id, ev.prompt_id].map((x) => x || '').join('|');
        if (feed.lastEvent && feed.lastEvent.k === key && Date.now() - feed.lastEvent.t < 3000) return;
        feed = { ...apply(feed, ev, runtime, process.env), lastEvent: { k: key, t: Date.now() } };
        const tmp = `${FEED}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(feed));
        fs.renameSync(tmp, FEED); // atomic on the same filesystem: readers never see half a file
      });
    } catch (_) {}
    if (ev.hook_event_name === 'SessionStart') autostart();
  });
}

// "autostart": true in ~/.cubicle/settings.json (the Claude plugin's /cubicle skill turns it on): when
// a session starts and nothing answers on Cubicle's port, start Cubicle in the background, kept up to
// date with --auto-update. It never waits for it: the session is not held up.
function autostart(dir = DIR) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) || {}; } catch (_) { return; }
  if (st.autostart !== true) return;
  const port = Number(st.port) || 3200;
  const sock = require('net').connect({ host: '127.0.0.1', port });
  sock.setTimeout(400);
  const start = () => {
    sock.destroy();
    try {
      const out = fs.openSync(path.join(dir, 'server.log'), 'a');
      const win = process.platform === 'win32';
      const args = ['-y', '@caglarutkuguler/cubicle', '--port', String(port), '--source', String(st.sources || 'claude-code'), '--auto-update'];
      require('child_process').spawn(win ? 'npx.cmd' : 'npx', args, { detached: true, stdio: ['ignore', out, out], shell: win, windowsHide: true }).unref();
    } catch (_) {}
  };
  sock.on('connect', () => sock.destroy());   // already running
  sock.on('error', start);
  sock.on('timeout', () => sock.destroy());
}

// ---------- install / uninstall into the CLI's settings ----------
const EVENTS = RUNTIMES.claude.events;
const isOurs = (h) => /cubicle-hook\.js|cubicle"? hook\b/.test(String(h && h.command));

// `npx cubicle install-hooks` runs from npm's throw-away cache (…/_npx/<hash>/…). A hook that
// points there stops working the day the cache is cleaned, so the script (one file, no
// dependencies) is copied to ~/.cubicle/bin/ and the hooks point at the copy. Installs from a
// clone or a global npm install keep pointing at the real file. Re-run install-hooks to refresh it.
const isEphemeral = (p) => /[\\/]_npx[\\/]/.test(p);
function stableScript(src = __filename, dir = DIR) {
  if (!isEphemeral(src)) return path.resolve(src);
  const dest = path.join(dir, 'bin', 'cubicle-hook.js');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return dest;
}

function install({ uninstall = false, runtime: runtimeName = 'claude', settingsFile } = {}) {
  const runtime = runtimeOf(runtimeName);
  const rt = RUNTIMES[runtime];
  settingsFile = settingsFile || rt.settings;
  let settings = {};
  let existed = false;
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); existed = true; }
  catch (e) { if (e.code !== 'ENOENT') throw new Error(`cannot parse ${settingsFile}: ${e.message}`); }

  const hooks = settings.hooks || {};
  // Drop any earlier Cubicle entries so the result is the same however often this runs.
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = (hooks[ev] || [])
      .map((grp) => ({ ...grp, hooks: (grp.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((grp) => grp.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  if (!uninstall) {
    // forward slashes on Windows: Claude Code runs hooks through Git Bash there
    const script = process.platform === 'win32' ? stableScript().replace(/\\/g, '/') : stableScript();
    const command = `node "${script}"${runtime === 'claude' ? '' : ` ${runtime}`}`;
    for (const ev of rt.events) {
      const h = { type: 'command', command, timeout: rt.timeout(ev) };
      if (runtime === 'gemini') h.name = 'cubicle';
      (hooks[ev] = hooks[ev] || []).push(runtime === 'gemini' ? { matcher: '*', hooks: [h] } : { hooks: [h] });
    }
  }
  if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;

  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  if (existed) {
    const backup = `${settingsFile}.bak-cubicle-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(settingsFile, backup);
    console.log(`Backed up ${settingsFile} to ${backup}`);
  }
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  console.log(uninstall
    ? `Removed Cubicle hooks from ${settingsFile}.`
    : `Added Cubicle hooks for ${rt.events.length} events to ${settingsFile}.\nStart the office with: cubicle --source ${runtime === 'claude' ? 'claude-code' : runtime}  (then open http://127.0.0.1:3200)\nRunning ${rt.label} sessions pick the hooks up after a restart.`);
}

if (require.main === module) main();
module.exports = { apply, workFolder, summarize, main, install, stableScript, isEphemeral, autostart, EVENTS, RUNTIMES };
