# Codex Desktop and CLI from local session files

An alternative to the [Codex CLI hooks](../codex/): this read-only observer reads
local JSONL session files and writes a Cubicle feed. It can discover existing
Desktop chats and CLI sessions without installing or trusting hooks.

```sh
node examples/codex-sessions/monitor.js
# In another terminal:
node bin/cubicle.js --source "$HOME/.cubicle/codex-sessions.json"
```

Open http://127.0.0.1:3200. Stop the observer with Ctrl+C. No service is installed,
no Codex configuration is changed and no model is invoked. Run one observer per
output file. The feed remains after exit; stop serving it or remove it if desired.

## Options

| Flag | Default | Purpose |
| --- | --- | --- |
| `--codex-home` | `$CODEX_HOME` or `~/.codex` | Read its `sessions/` tree |
| `--output` | `~/.cubicle/codex-sessions.json` | Output feed outside that tree |
| `--once` | off | Export one snapshot and exit |
| `--poll-ms` | 3000 | Poll known session files (minimum 100 ms) |
| `--idle-ms` | 600000 | Infer idle after 10 minutes without events; 0 disables |
| `--expire-ms` | 7200000 | Hide sessions inactive for 2 hours; 0 disables |
| `--max-sessions` | 40 | Read at most this many recently modified files |

The whole directory tree is rediscovered every 30 seconds, including old date
directories containing resumed chats. Cubicle refreshes the feed every 4 seconds.
`source: cli` or `exec` identifies CLI sessions, even when their originator is
`Codex Desktop`. Desktop chats receive a separate role; unknown sources use Codex.
Duplicate ids are collapsed using the most recently modified file.

Initial reads use the first metadata record (up to 8 MiB) and the last 1 MiB.
Later reads follow appended bytes, bounded to 4 MiB per file per poll. Split JSON
records and split UTF-8 characters are retained for the next poll; malformed or
oversized records are skipped. Truncated and replaced files are read afresh.

## Limits and privacy

This is a best-effort observer of Codex's internal log format, not a supported
Codex API or a process liveness check. Future Codex versions may change the
format. Ephemeral sessions, remote/cloud sessions without local JSONL files and
sessions migrated to another history format are not visible. A snapshot may lag
behind a file receiving more than 4 MiB between polls; later polls catch up.

Task events, tool calls/results and final messages determine status. A
`request_user_input` call is displayed as waiting until subsequent activity;
permission prompts that are absent from the log cannot be detected reliably.
Long, silent operations can look idle: disable the idle timeout if that matters.
Age-based hiding also applies to waiting sessions. Use `--expire-ms 0` if needed.

Only session id, directory basename, runtime label, tool name, timestamps and
generic status/error text reach the feed. Prompts, reasoning text, tool arguments,
tool results and credentials are not copied. Input files are only opened for
reading. The output is atomically renamed with private file permissions.

Do not combine this feed with `--source codex` for the same sessions: the latter
reads the hook feed and would display a second character. Keep the existing hook
integration if you need its richer permission and subagent events.

Run `node test/codex-sessions.js` for metadata, large/split files, resumed sessions,
truncation, runtime classification, privacy and timeout checks.
