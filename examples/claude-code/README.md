# Cubicle for Claude Code

Every Claude Code session becomes one character in the office. It sits down and types while Claude is calling tools, raises a hand when Claude is waiting for your permission or input, and heads to the lounge when the turn is over.

No daemon, no sockets: Claude Code's own hooks run a small script that rewrites `~/.cubicle/claude-code.json`, and Cubicle reads that file.

## Setup

```bash
git clone https://github.com/caglarutkuguler/cubicle.git ~/cubicle
node ~/cubicle/bin/cubicle.js install-hooks          # adds the hooks to ~/.claude/settings.json (backup first)
node ~/cubicle/bin/cubicle.js --source claude-code   # then open http://127.0.0.1:3200
```

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

## Cost and safety

- Concurrent sessions and subagents fire hooks at the same moment; the hook takes a short-lived lock around its read-modify-write so no update is lost (it waits at most 1 s, then writes anyway), and it writes to a temp file and renames it, so Cubicle never reads half a file.
- Each hook is one short `node` process (tens of milliseconds) with a 5 s timeout. It never exits with code 2, so it can never block a tool call, and it prints nothing, so it adds nothing to Claude's context.
- The hook writes only: session id, directory name, status, and a short summary of the current tool call (tool name plus file name or the first ~50 characters of a command or prompt). Nothing leaves the machine.
