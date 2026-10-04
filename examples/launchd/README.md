# Start Cubicle at login on macOS

The generator prints a user LaunchAgent using absolute paths to your current Node
binary and Cubicle checkout. It does not install a service or modify CLI settings.
Keep both paths stable; regenerate after moving the checkout or upgrading a
version-managed Node installation. No `sudo` or shell profile is needed.

## Install

Install the desired CLI hooks first (see [Claude Code](../claude-code/),
[Codex](../codex/) and [Gemini](../gemini/)). From the Cubicle checkout:

```sh
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/Cubicle"
node examples/launchd/plist.js --port 3232 > /tmp/cubicle-office.plist
plutil -lint /tmp/cubicle-office.plist
cat /tmp/cubicle-office.plist
```

After reviewing it, copy the file to
`~/Library/LaunchAgents/io.cubicle.office.plist`. Back up an existing file there
before replacing it. Then load it for your logged-in user:

```sh
chmod 600 "$HOME/Library/LaunchAgents/io.cubicle.office.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.cubicle.office.plist"
launchctl print "gui/$(id -u)/io.cubicle.office"
curl -fsS http://127.0.0.1:3232/config.json
```

Open http://127.0.0.1:3232. The saved port survives restarts; the service starts at
user login, not before login. It listens only on the local loopback interface.
`KeepAlive` restarts the server after an exit. This serves feeds; it does not
start the agents or produce hook events itself.

The default source is `claude-code,codex,gemini`. For a different source, pass
`--source` to the generator. Use absolute paths for file feeds and expand `$HOME`
in the shell before generating: launchd does not expand `~`, variables or shell
syntax in the plist. `--logs` chooses a different existing log directory.
`--label` supports a second office, with a different port and plist filename.

## Change the port or source

Regenerate and review a new plist, then unload the existing service before
replacing its file and running `bootstrap` again:

```sh
launchctl bootout "gui/$(id -u)/io.cubicle.office"
```

`kickstart` restarts the current loaded definition; it does not reload a changed
plist. For a restart without configuration changes:

```sh
launchctl kickstart -k "gui/$(id -u)/io.cubicle.office"
```

Logs are `~/Library/Logs/Cubicle/io.cubicle.office.log` and
`io.cubicle.office.error.log`. Check them if the port is occupied or the saved
executable no longer exists. Logs are not automatically rotated by this example.

## Uninstall

Unload the service with `bootout`, then remove
`~/Library/LaunchAgents/io.cubicle.office.plist` to stop future login startup.
Removing a loaded plist alone does not stop the current server. CLI hooks and
feeds remain installed; their own example READMEs explain how to remove them.
