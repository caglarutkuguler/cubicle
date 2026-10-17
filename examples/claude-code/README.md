# Cubicle for Claude Code

Every Claude Code session becomes one character in the office. It sits down and types while Claude is calling tools, raises a hand when Claude is waiting for your permission or input, and heads to the lounge when the turn is over.

No daemon, no sockets: Claude Code's own hooks run a small script that rewrites `~/.cubicle/claude-code.json`, and Cubicle reads that file.

## Setup

```bash
git clone https://github.com/caglarutkuguler/cubicle.git ~/cubicle
node ~/cubicle/bin/cubicle.js install-hooks          # adds the hooks to ~/.claude/settings.json (backup first)
node ~/cubicle/bin/cubicle.js --source claude-code   # then open http://127.0.0.1:3200
```

No Paperclip, ECC or other plugin is needed: plain Claude Code is enough. Run through `npx`, `install-hooks` copies the hook script to `~/.cubicle/bin/` so the hooks keep working after npm cleans its cache; run it again after an update to refresh the copy.

`install-hooks` keeps everything else in your settings, can be run again safely, and `install-hooks --uninstall` removes only Cubicle's entries. Restart running Claude Code sessions so they load the hooks.

Prefer to edit by hand? Merge [`settings.json`](settings.json) from this folder into `~/.claude/settings.json` (user-wide) or `.claude/settings.json` (one project), replacing `/path/to/cubicle`.

To keep it running in the background next to a Paperclip office, see [`../systemd/`](../systemd/): `cubicle-claude.service` serves the Claude Code office on port 3201.

## What maps to what

| Claude Code event | In the office |
| --- | --- |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | Sits at the desk and types; the bubble shows the tool and file/command |
| `PermissionRequest`, `Notification` of type `permission_prompt` / `agent_needs_input` / `elicitation_*` | Stays at the desk with a hand up, amber screen |
| `Stop` | Says "✓ done" and goes to the lounge |
| `StopFailure` | Red screen, error on the card |
| `SessionEnd` | Leaves the office, together with any of its subagents still at a desk |
| `SubagentStart`, and tool, permission and permission-notification events carrying an `agent_id` | A separate character for that subagent, named `<directory> › <agent type>` (e.g. `app › Explore`); it types and raises its hand on its own |
| `SubagentStop` | The subagent's character leaves the office |

Other notifications — the "waiting for your input" reminder after a minute of idling, auth and quota messages — are ignored, so an idle session stays in the lounge.

Using Grok alongside Claude Code? Grok discovers Claude hook settings too. The
Cubicle hook ignores those foreign invocations; use the dedicated
[`../grok/`](../grok/) example to display Grok without duplicate Claude characters.

The character is named after the working directory, so two sessions in different repos are easy to tell apart. Subagents started through the Agent (Task) tool get their own character next to the session that started them, so a session fanning out to four subagents shows five people at work; the session's own bubble keeps showing what it asked them to do. Claude Code versions that don't send `agent_id` on hook events fall back to one character per session. Sessions with no events for 12 hours are dropped.

## Headless workers (cron, CI, issue bots)

A script that runs `claude -p` on a schedule (for example one that takes a GitHub issue, works in a git worktree and opens a pull request) can tell Cubicle who it is through environment variables. Claude Code passes its environment to the hooks, so nothing else has to be configured.

| Variable | Effect |
| --- | --- |
| `CUBICLE_NAME` | Character name instead of the working directory name (`ncu-pch #42`). Its subagents are named `ncu-pch #42 › code-reviewer`. |
| `CUBICLE_ROLE` | Role on the card (`Issue worker`). |
| `CUBICLE_TASK_ID`, `CUBICLE_TASK`, `CUBICLE_TASK_URL` | Ticket id, title and link. The bubble keeps showing the current tool, the card links to the ticket, and the ticket title stays on the card while idle. A long prompt is no longer shown as the task. |
| `CUBICLE_MAIN_TASK_ID`, `CUBICLE_MAIN_TASK` | The bigger task this run is part of (for example the CEO task that started the worker). A run started from inside another inherits them, so the Telegram message when it finishes says how far the main task has come (pieces done, working, queued). Cubicle's CEO task box sets them for the workers its CEO starts. |
| `CUBICLE_LINGER=1` | Keep the character in the office after `SessionEnd`, idle (or red if the last turn failed), so a finished run stays visible until the next run with the same session or the 12-hour limit. Its subagents still leave. |

```bash
export CUBICLE_NAME="ncu-pch #42" CUBICLE_ROLE="Issue worker" CUBICLE_LINGER=1 \
       CUBICLE_TASK_ID="#42" CUBICLE_TASK="Add partner export" \
       CUBICLE_TASK_URL="https://github.com/acme/ncu-pch/issues/42"
claude -p "Implement issue 42" --permission-mode dontAsk
```

Without these variables nothing changes. They work the same with or without the [Everything Claude Code](https://github.com/affaan-m/ECC) plugin: its agents are ordinary Claude Code subagents, so each one gets its own desk. Tip for several parallel workers: give each its own `CUBICLE_NAME`, since sessions are told apart by name in the office.

## Cost and safety

- Concurrent sessions and subagents fire hooks at the same moment; the hook takes a short-lived lock around its read-modify-write so no update is lost (it waits at most 1 s, then writes anyway), and it writes to a temp file and renames it, so Cubicle never reads half a file.
- Each hook is one short `node` process (tens of milliseconds) with a 5 s timeout. It never exits with code 2, so it can never block a tool call, and it prints nothing, so it adds nothing to Claude's context.
- The hook writes only: session id, directory name, status, and a short summary of the current tool call (tool name plus file name or the first ~50 characters of a command or prompt). Nothing leaves the machine.
