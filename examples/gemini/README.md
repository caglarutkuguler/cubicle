# Cubicle for Gemini CLI

Every Gemini CLI session becomes a character in the office: it types while Gemini runs tools, raises a hand when Gemini asks for permission to use a tool, and goes to the lounge when the turn ends.

It is the same hook script as [`../claude-code/`](../claude-code/); Gemini's event names are mapped onto Claude Code's, and the office is written to `~/.cubicle/gemini.json`.

## Setup

```bash
npx @caglarutkuguler/cubicle install-hooks gemini    # adds the hooks to ~/.gemini/settings.json (backup first)
npx @caglarutkuguler/cubicle --source gemini         # then open http://127.0.0.1:3200
```

Restart running Gemini CLI sessions so they load the hooks. Gemini runs hooks only in folders it trusts, so answer its trust prompt in the folders you work in. `install-hooks gemini --uninstall` removes only Cubicle's entries.

Checked end to end with Gemini CLI 0.61.0: a session appears when it starts, types with the prompt and each tool call in its bubble, raises its hand on a confirmation ("allow rm a.txt?") and goes back to the lounge after `AfterAgent`.

Several at once: `--source claude-code,codex,gemini` puts every CLI in the same office.

## What maps to what

| Gemini CLI event | In the office |
| --- | --- |
| `BeforeAgent` | Starts working; the bubble shows the prompt |
| `BeforeTool`, `AfterTool` | Sits at the desk and types; the bubble shows the tool and file or command |
| `Notification` of type `ToolPermission` | Hand up, amber screen, the command or file in the bubble: Gemini is waiting for your confirmation |
| `AfterAgent` | "✓ done", back to the lounge |
| `SessionStart` / `SessionEnd` | Arrives / leaves the office |

`PreCompress` is installed but ignored: Gemini fires it on every turn.

## Cost and safety

- The hook always exits 0 and prints `{}` (Gemini parses hook output as JSON; an empty object changes nothing), so it can never block or alter a tool call.
- Each run is one short `node` process with a 5 s timeout, registered with matcher `*`.
- Stored: session id, directory name, status and a short summary of the current tool call. Nothing leaves the machine.
