# Cubicle for Claude Code

Every Claude Code session becomes one character in the office. It sits down and types while Claude is calling tools, raises a hand when Claude is waiting for your permission or input, and heads to the lounge when the turn is over.

No daemon, no sockets: Claude Code's own hooks run a small script that rewrites `~/.cubicle/claude-code.json`, and Cubicle reads that file.

## Setup

1. Clone or install Cubicle:

   ```bash
   git clone https://github.com/caglarutkuguler/cubicle.git
   ```

2. Merge `settings.json` from this folder into `~/.claude/settings.json` (user-wide) or `.claude/settings.json` (one project), replacing `/path/to/cubicle` with the real path. If Cubicle is installed globally with npm, `cubicle hook` works as the command instead.

3. Start the office:

   ```bash
   node /path/to/cubicle/bin/cubicle.js --source claude-code
   ```

   Open <http://127.0.0.1:3200>. Sessions started before the hooks were added appear on their next event.

## What maps to what

| Claude Code event | In the office |
| --- | --- |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | Sits at the desk and types; the bubble shows the tool and file/command |
| `Notification` (permission or input needed) | Stays at the desk with a hand up, amber screen |
| `Stop` | Says "✓ done" and goes to the lounge |
| `SessionEnd` | Leaves the office |

The character is named after the working directory, so two sessions in different repos are easy to tell apart. Sessions with no events for 12 hours are dropped.

## Privacy

The hook writes only: session id, directory name, status, and a short summary of the current tool call (tool name plus file name or the first ~50 characters of a command or prompt). Nothing leaves the machine.
