---
name: cubicle
description: Open, start, set up or configure Cubicle, the live pixel office where Claude Code sessions, subagents and background tasks appear as agents at desks. Use when the user says "/cubicle", "open the office", "start Cubicle", "show my agents", "Cubicle'ı aç", "ofisi aç", asks to turn Cubicle's autostart, Telegram alerts, phone access or the CEO task box on or off, or asks why a session does not show in Cubicle.
---

# Cubicle

Cubicle is a local web page (default http://127.0.0.1:3200) that draws every Claude Code session as a character in an office. This plugin's hooks already report every session, subagent and background task to `~/.cubicle/claude-code.json`; the page reads that file. Nothing leaves the machine. Answer in the user's language.

## Open the office (default action)

1. Check whether Cubicle runs: `curl -s -m 2 http://127.0.0.1:3200/config.json` (on Windows PowerShell: `curl.exe`). A JSON reply with `"version"` means it runs.
2. If it does not run, start it in the background, kept up to date:
   - macOS / Linux / WSL: `nohup npx -y @caglarutkuguler/cubicle --source claude-code --auto-update > ~/.cubicle/server.log 2>&1 &`
   - Windows: `Start-Process -WindowStyle Hidden npx -ArgumentList '-y','@caglarutkuguler/cubicle','--source','claude-code','--auto-update'`
   Wait a few seconds and check again. If it still does not answer, show the last lines of `~/.cubicle/server.log` and stop. Node.js 18 or newer is required; if `npx` is missing, say so and point to https://nodejs.org.
3. Tell the user the address, http://127.0.0.1:3200, in one line, and offer **autostart** (below) if it is off.

If a Paperclip server is reachable (`curl -s -m 2 http://127.0.0.1:3100/api/health`), add it to the sources: `--source paperclip,claude-code`.

## Settings

Settings live in `~/.cubicle/settings.json`. Always merge, never overwrite: read the file (it may not exist), change only the key asked for, write it back, e.g.

```bash
node -e "const f=require('os').homedir()+'/.cubicle/settings.json',fs=require('fs');let s={};try{s=JSON.parse(fs.readFileSync(f,'utf8'))}catch(_){};s.autostart=true;fs.mkdirSync(require('path').dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(s,null,2))"
```

| What the user wants | Key | Notes |
| --- | --- | --- |
| Start Cubicle by itself when a Claude session starts | `"autostart": true` | The hook starts it in the background (with `--auto-update`) when nothing answers on the port. `"port"` and `"sources"` (e.g. `"paperclip,claude-code"`) are optional. |
| Server texts in Turkish | `"lang": "tr"` | The page itself follows the browser or ⚙ → Language. |
| A task box that hands tasks to a "CEO" Claude run | `"dispatch": { "enabled": true, "cwd": "~/agents" }` | Optional: `model`, `budget` (USD per run), `tools`, `prompt`, `fixFailures` (default on: a failed agent goes to the CEO first, and the user is asked only if it cannot fix it). Explain that it runs `claude -p` unattended with the listed tools before turning it on. |
| Show the GitHub work queue (agent:* labels) and let the CEO merge green PRs | `"github": { "repos": "owner/repo, owner/other", "autoMerge": true }` | `repos` defaults to `~/agents/repos.conf`; `autoMerge` needs the task box. Uses the `gh` CLI signed in on this machine. |
| Hide Paperclip shortcuts and agents | `"paperclipLinks": false`, `"paperclipAgents": false` | |

The same settings can also be changed on the page, ⚙ → 🛠 Cubicle settings (on this computer). Restart Cubicle after a change only when the user asks to apply it now: stop the running process and open the office again as above (with `--auto-update` it also restarts by itself on updates).

## Things set up on the page, not here

- **Telegram alerts** (an agent needs you, fails or finishes): ⚙ → 📨 Telegram on the page, on the computer Cubicle runs on. Do not ask for or handle the bot token; the user pastes it into the page.
- **Open the office on the phone**: ⚙ → Telegram, step 5 *Open the office on my phone* (Tailscale on both devices).
- **Looks, names, themes, language**: ✎ on a card and the ⚙ menu.

## When a session does not show

- Sessions started before the plugin was installed show after they are restarted.
- Hooks also installed by hand (`cubicle install-hooks`) are harmless (each event counts once), but can be removed: `npx -y @caglarutkuguler/cubicle install-hooks --uninstall`.
- Claude on Windows and Cubicle in WSL: install the plugin in both, and start Cubicle in WSL with the Windows feed as a second source: `--source "claude-code,/mnt/c/Users/<user>/.cubicle/claude-code.json"`.
- Sessions in the cloud (claude.ai, Cowork) run elsewhere and cannot reach a local Cubicle.

## Naming headless runs

Scripts that run `claude -p` can name their character and link a ticket with environment variables: `CUBICLE_NAME`, `CUBICLE_ROLE`, `CUBICLE_TASK_ID`, `CUBICLE_TASK`, `CUBICLE_TASK_URL`, `CUBICLE_MAIN_TASK_ID`, `CUBICLE_MAIN_TASK`, `CUBICLE_LINGER=1`. Details: https://github.com/caglarutkuguler/cubicle/blob/main/examples/claude-code/README.md
