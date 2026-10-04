# Cubicle for Antigravity CLI (agy)

A passive feed example for the Antigravity CLI lifecycle-hook contract (1.2.16).
Each conversation becomes a character. No dependency, network request, model
call, permission override or continuation decision is made by this script.

## Setup

From a stable Cubicle checkout:

```sh
node examples/agy/hook.js --config > /tmp/cubicle-agy-hooks.json
```

Review the generated JSON. Merge its `cubicle-feed` key into the shared global
customization file `~/.gemini/config/hooks.json`. Create the directory/file if
needed; back up an existing file and preserve other named hooks. This is the
location verified with Agy 1.2.16: the CLI-specific
`~/.gemini/antigravity-cli/hooks.json` was reported as loaded but did not invoke
the lifecycle handlers in print mode. A project customization root such as
`.agents/` can also contain `hooks.json`; follow your Agy version's documentation.

Restart Agy so it loads the configuration, run a task, then start Cubicle:

```sh
node bin/cubicle.js --source "$HOME/.cubicle/agy.json"
# Alongside other CLI feeds:
node bin/cubicle.js --source "claude-code,codex,$HOME/.cubicle/agy.json"
```

Open http://127.0.0.1:3200. Regenerate the commands if Node or the checkout moves.
To uninstall, remove only the `cubicle-feed` key you added and restart Agy.

## Events and limits

| Event | Office state |
| --- | --- |
| `PreInvocation` | Working |
| `PostInvocation` | Working; this is not a turn-completion signal |
| `PostToolUse` | Working, generic tool-completed text |
| `Stop` | Idle; error on failed execution; running if `fullyIdle` is false |

The hook always replies with `{}`, including malformed input or write failures.
It deliberately does not register `PreToolUse`, whose output can make permission
decisions. The observed event contract has no separate permission-wait event,
so this example does not claim to detect permission prompts or show subagents.
`PostToolUse` may contain only a step index, so no tool name is invented.

Only conversation id, directory basename, status, generic task/error text and
timestamps are stored. Prompts, transcripts, arguments and raw errors are not
copied. The feed is locked and atomically renamed; it waits at most one second
for a writer, then drops the update. `CUBICLE_AGY_FEED` overrides the output for
isolated checks. Sessions older than 12 hours are removed on the next hook write;
the last feed remains if no further hooks fire.

Authentication is managed by Agy itself. If it fails before invoking hooks, the
feed may stay empty or retain an older state; this script does not infer current
login status from old log messages. It does not perform a login for you.

Run `node test/agy.js` for event mappings, passive output, concurrency, malformed
input and privacy checks. Real CLI verification is described in the pull request.
