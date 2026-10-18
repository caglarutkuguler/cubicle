# Cubicle plugin for Claude

Installs [Cubicle](https://github.com/caglarutkuguler/cubicle)'s hooks in one step, so every Claude Code session, subagent and background task shows up in the office, and adds a `/cubicle` skill that opens the office, starts it when needed and changes its settings.

## Install

In Claude Code (terminal, or the Claude desktop app's Code tab):

```
/plugin marketplace add caglarutkuguler/cubicle
/plugin install cubicle@cubicle
```

Or from a shell: `claude plugin marketplace add caglarutkuguler/cubicle && claude plugin install cubicle@cubicle`.

Then say `/cubicle` (or "open the office"): it starts Cubicle if it is not running and gives you the address, http://127.0.0.1:3200. Ask it to turn on **autostart** and Cubicle starts by itself whenever a Claude session starts.

## What it does

- **Hooks** on Claude Code's session, prompt, tool, permission, notification, subagent and stop events update `~/.cubicle/claude-code.json`. They never touch the network and never block Claude (each one exits at once, errors included).
- **The `/cubicle` skill** checks whether Cubicle runs, starts it in the background with `--auto-update`, and edits `~/.cubicle/settings.json` (autostart, language, the CEO task box, Paperclip shortcuts) by merging, never overwriting.
- With `"autostart": true`, a session start runs `npx -y @caglarutkuguler/cubicle --source claude-code --auto-update` in the background when nothing answers on the port.

Telegram alerts, phone access, looks and themes are set up on the page itself (⚙ menu).

## Update and remove

`/plugin marketplace update cubicle` gets a new version of the plugin; the office updates itself with `--auto-update`. `/plugin uninstall cubicle@cubicle` removes the hooks and the skill.
