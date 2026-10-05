# Cubicle for GitHub Copilot

Choose the Desktop exporter for the **GitHub Copilot desktop app**, or the CLI
hooks below for **Copilot in a terminal**. Adding these examples to a checkout
does not install them into an already running Cubicle office: its `--source`
or existing feed collector must also include the new feed.

## GitHub Copilot Desktop

The desktop app uses its own session database; terminal CLI hooks alone do not
show its agents. `desktop.py` reads `~/.copilot/data.db` with SQLite's read-only
mode and writes a normal Cubicle feed. It needs Python 3.9+ with the standard
`sqlite3` module, without additional packages.

```sh
python3 examples/github-copilot/desktop.py
```

In another terminal, start Cubicle with the generated feed:

```sh
node bin/cubicle.js --source "$HOME/.cubicle/github-copilot-desktop.json"
# Or include it alongside an existing office feed:
node bin/cubicle.js --source "/path/to/agents.json,$HOME/.cubicle/github-copilot-desktop.json"
```

The exporter polls every three seconds. `--once` writes one snapshot, `--stdout`
prints one snapshot for an existing collector, and `--database`, `--output`,
and `--interval` override its paths and poll interval. An existing service must
be configured to run this exporter and read its output; restart that service
after changing its source list. Copilot itself does not need a restart.

Each unarchived local session gets its own character. Desktop's `is_running`
flag maps to working, `was_interrupted` to paused, and a settled session to idle.
Inactive sessions older than two hours, provisional sessions and remote
sessions are excluded. Up to 40 sessions are included. Names use only the first
eight characters of the session id; chat titles and contents are never read.
The exporter does not infer permission waits, errors or successful completion
timestamps from metadata changes. These are persisted app flags, so a crashed
app may leave a stale running flag until it recovers.

This targets the inspected Desktop `sessions` schema. A missing database gives
an empty office; an unreadable or changed schema reports an error and preserves
the last feed. Run `python3 test/github-copilot-desktop.py` for read-only WAL,
privacy, filtering, state changes and failure checks. The desktop schema is an
internal app format and may change in later releases.

## GitHub Copilot CLI

One character per local Copilot CLI session, using its command hooks and the
[Cubicle feed format](../../docs/FEED.md). No dependencies or model calls in the
hook. This example watches CLI sessions, including sessions started with
`copilot --agent NAME`. It does not connect to GitHub's cloud coding agent or
VS Code chat sessions.

### Setup

From a stable checkout of Cubicle, generate a hook configuration with absolute
paths to Node and this script:

```sh
node examples/github-copilot/hook.js --config > /tmp/cubicle-copilot-hooks.json
```

In the repository where you use Copilot, create `.github/hooks/` and copy the
generated file there as `cubicle.json`. If that file already exists, back it up
and merge the `hooks` entries instead of overwriting it. Restart Copilot in that
repository and accept its normal folder trust prompt. Current CLI versions also
support personal hooks in `~/.copilot/hooks/`; use either location, not both.

Start the office from your Cubicle checkout:

```sh
node bin/cubicle.js --source "$HOME/.cubicle/github-copilot.json"
# Alongside other sources:
node bin/cubicle.js --source "claude-code,codex,$HOME/.cubicle/github-copilot.json"
```

Open http://127.0.0.1:3200. The office is empty until the first hook runs. The
configuration includes Bash and PowerShell commands; regenerate it on the
machine running Copilot, or whenever Node or the checkout moves. On Windows,
use `$env:USERPROFILE/.cubicle/github-copilot.json` for the feed path.

To uninstall, remove only this example's entries from the Copilot hook file (or
delete that file if it contains only these entries), then restart Copilot.

### Older Copilot versions

Copilot CLI **0.0.420** omits `sessionId` on most events. Start each CLI process
with a unique identifier so sessions in the same folder remain separate:

```sh
CUBICLE_COPILOT_SESSION="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')" copilot
```

Append your normal Copilot arguments to that command. In PowerShell:

```powershell
$env:CUBICLE_COPILOT_SESSION = [guid]::NewGuid().ToString()
try { copilot } finally { Remove-Item Env:CUBICLE_COPILOT_SESSION }
```

The override takes precedence even on events containing a native id; do not
share it between CLI processes. Without either a native id or this override,
events are ignored instead of combining unrelated sessions. On current CLIs,
leave the override unset so new sessions created by `/clear` get distinct ids.
Version 0.0.420 uses repository hooks; its loader ignores the newer
`notification`, `preCompact` and `postToolUseFailure` entries.

## Events and limitations

| Event | Office state |
| --- | --- |
| `sessionStart` | Idle character |
| `userPromptSubmitted`, tool events, `preCompact` | Working; tool name only |
| `preToolUse` for `ask_user` | Hand raised |
| `notification` for a permission prompt or elicitation dialog | Hand raised (current CLI) |
| `agentStop` | Idle, retaining an error if the turn failed |
| `errorOccurred`, `postToolUseFailure`, failed or denied tool result | Error until new activity |
| `sessionEnd` | Character removed |

The event name is an argument in each generated command because camelCase hook
payloads do not include it. Both camelCase and snake_case payload fields are
accepted. Permission requests are observed via notifications, not the
`permissionRequest` hook, which can also fire for automatically approved tools.
The older CLI cannot report permission waits; `ask_user` still raises a hand.

Subagents within a session are not separate characters: the documented
`subagentStart` payload lacks a stable child id to pair with `subagentStop`.
Their events must not finish the parent session. If another hook blocks
`agentStop` to force continuation, remove this example's `agentStop` entry:
a passive observer cannot know the final decision of the other hooks.

Sessions expire on the next hook write after 12 hours without events. If Copilot
is killed without `sessionEnd` and no more hooks run, its last state remains on
disk. This is an event observer, not a process monitor. Older delayed events are
ignored using their timestamps, and up to 128 recently closed ids are retained
to prevent queued events from resurrecting a closed session.

## Privacy and verification

The feed stores session ids, directory basename, status, tool name and timestamps.
It never copies prompts, tool arguments, commands, results, transcripts or raw
errors. Files are written with user-only permissions, a bounded lock and an
atomic rename. On lock contention the hook waits at most one second, then drops
the event. It prints nothing and exits successfully even on malformed input or
a write failure, leaving Copilot's permission and continuation decisions alone.
`CUBICLE_COPILOT_FEED` overrides the output path for isolated tests.

Run `node test/github-copilot.js` (also part of `npm test`) for lifecycle,
privacy, generated configuration, concurrency and HTTP feed checks. The
contract is based on the [GitHub hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
and the installed 0.0.420 CLI's hook serializer. Fixture tests do not establish
an end-to-end model run with a current Copilot CLI.
