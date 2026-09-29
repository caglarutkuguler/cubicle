# Cubicle for Codex CLI

Every Codex session becomes a character in the office: it types while Codex runs tools, raises a hand when Codex asks for approval, and goes to the lounge when the turn ends. Subagents get their own character.

Codex's hooks use the same event names and fields as Claude Code's, so this is the same hook script as [`../claude-code/`](../claude-code/), writing `~/.cubicle/codex.json` instead.

## Setup

```bash
npx @caglarutkuguler/cubicle install-hooks codex     # adds the hooks to ~/.codex/hooks.json (backup first)
npx @caglarutkuguler/cubicle --source codex          # then open http://127.0.0.1:3200
```

Then **trust the hooks once**: Codex skips new hooks until you review them. Start `codex`, type `/hooks`, and trust the Cubicle entries (they all run `cubicle-hook.js codex`). Codex prints a warning at startup while hooks are waiting for review. After an update that moves the script, trust them again.

Hooks need Codex's `hooks` feature, which is on by default. Restart running Codex sessions so they load the hooks. `install-hooks codex --uninstall` removes only Cubicle's entries.

Checked end to end with Codex CLI 0.159.0: a session appears when it starts, types with the prompt and each shell command in its bubble, raises its hand on an approval prompt ("allow Bash: touch c.txt?") and goes back to the lounge on `Stop`.

Several at once: `--source claude-code,codex,gemini` puts every CLI in the same office.

## What maps to what

| Codex event | In the office |
| --- | --- |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact` | Sits at the desk and types; the bubble shows the tool and file or command |
| `PermissionRequest` | Hand up, amber screen: Codex is waiting for your approval |
| `Stop` | "✓ done", back to the lounge |
| `SubagentStart` / `SubagentStop`, and tool events with an `agent_id` | A separate character for the subagent |
| `SessionEnd` | Leaves the office |

## Cost and safety

- The hook always exits 0 and prints `{}` (Codex reads JSON from hook output; an empty object changes nothing), so it can never block or alter a tool call.
- Each run is one short `node` process with a 5 s timeout (3 s for `SessionEnd`, Codex's limit).
- Stored: session id, directory name, status and a short summary of the current tool call. Nothing leaves the machine.
