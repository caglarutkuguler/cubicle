# Cubicle for Grok CLI

One character per Grok session, using a small local hook. This example targets the
Grok Build CLI hook contract (1.0.40), not the Grok web app or an arbitrary CLI
that calls the xAI API. No dependencies, model calls or network requests in the hook.

## Setup

From a stable checkout of Cubicle, generate a configuration with absolute paths:

```sh
node examples/grok/hook.js --config > /tmp/cubicle-grok-hooks.json
mkdir -p ~/.grok/hooks
```

Review the generated file, then copy it to `~/.grok/hooks/cubicle.json`. If that file
already exists, back it up and merge the `hooks` entries instead of overwriting it.
Restart Grok and use `/hooks` to confirm the entries loaded. Start the office:

```sh
node bin/cubicle.js --source "$HOME/.cubicle/grok.json"
# Alongside Claude Code and Codex:
node bin/cubicle.js --source "claude-code,codex,$HOME/.cubicle/grok.json"
```

Open http://127.0.0.1:3200. To uninstall, remove only this example's commands from
the Grok hook file (or delete the file if it contains only those commands), then
restart Grok. Regenerate the commands if Node or the checkout moves.

## Events and limitations

| Event | Office state |
| --- | --- |
| `SessionStart` | Idle character |
| `UserPromptSubmit`, tool events, `PreCompact` | Working; tool name only |
| Permission/input `Notification` | Hand raised |
| `Stop`, `StopCancelled` | Idle |
| `StopFailure` | Error until a new run |
| `idle_prompt` notification | Idle backstop; retains a previous error |
| `SessionEnd` | Character removed |

Both camelCase CLI payloads and snake_case SDK payloads are accepted. The last
64 started turn ids prevent delayed end reports for those turns from settling a
newer turn. Reports without an id, or for a turn never observed starting (such as
an interrupted bash-mode command), still settle the session. Events marked with
`subagentType` are ignored: this example does not display Grok subagents.

If you also run a blocking `Stop` gate, remove this example's `Stop` entry: Grok
can continue after a gate, and a passive observer cannot identify the final stop.
The `idle_prompt` notification then settles the character after roughly a minute.

Grok also discovers Claude Code hooks. The built-in Cubicle Claude hook ignores
Grok invocations identified by its hook environment or camelCase envelope, so it
does not create a second Claude character. Older Cubicle hooks should be updated;
do not disable all Claude-compatible hooks just to hide the duplicate.

## Privacy and verification

The feed stores session/turn ids, directory basename, status, tool name and
timestamps, plus up to 128 recently closed ids to ignore queued events after
teardown. It never copies prompts, commands, arguments, tool results or raw
errors. Updates are locked and atomically renamed; contention waits at most one
second, then drops the update. Hook output is empty and failures are swallowed.
`CUBICLE_GROK_FEED` overrides the output file for isolated tests.

Sessions expire on the next hook write after 12 hours without events. If no hooks
run, the last feed remains on disk. This is an event observer, not a process monitor.

Run `node test/grok.js` for lifecycle, delayed-event, privacy, concurrency and
configuration checks. Real CLI verification is described in the pull request.
