# Contributing to Cubicle

Thanks for helping. Cubicle stays small on purpose, so a few ground rules keep it that way.

## Principles

- **Zero runtime dependencies.** `bin/` uses only Node's standard library and `public/index.html` is a single page with no build step and no CDN scripts. Pull requests that add a dependency will be asked to find another way.
- **Read-only.** Cubicle must never be able to change anything in the system it watches. New upstream endpoints are `GET` only and go through the allowlist in `bin/cubicle.js`.
- **Nothing leaves the machine** except the configured upstream request. No telemetry, no external assets.
- **Art is rectangles.** Everything is drawn with `fillRect` on a 352×208 canvas. New furniture or animations follow the same style.

## Getting started

```bash
git clone https://github.com/caglarutkuguler/cubicle.git && cd cubicle
node bin/cubicle.js                         # Paperclip on :3100
node bin/cubicle.js --source examples/feed.json   # no Paperclip needed
open http://127.0.0.1:3200/?demo            # fake agents
npm test                                     # smoke test, no dependencies
```

Node 18 or newer. CI runs `npm test` on Node 18, 20 and 22.

## Adding a source

The easiest way to support a new agent runtime is to write the [feed format](docs/FEED.md) from that runtime (a hook, a wrapper script, a small exporter) and add it under `examples/<runtime>/` with a README, the way `examples/claude-code/` does. Only if a runtime needs server-side logic should it get its own `--source` value.

## Adding a theme

A theme changes how the office is drawn and nothing else. It is one file, `public/themes/<id>.js`, that calls `window.CubicleThemes.register({...})` with:

| Field | |
| --- | --- |
| `id`, `name` | `name` is `{ en, tr }` |
| `scale`, `smooth` | canvas resolution multiplier (1 = pixel art, 4 = HD) and whether to smooth images |
| `setup(opts)` | optional; receives the theme's options from the ⚙ menu (for example `{ branch: 'air' }`) |
| `drawRoom(c)` | floor, walls, windows |
| `props(c, list)` | push `{ z, f }` for furniture that characters can walk in front of or behind; `z` is the y they sort by |
| `drawDesk(c, desk, sprite)` | one desk; `sprite` is the agent sitting there, if any |
| `drawChar(c, sprite)` | one agent: `sprite.status`, `seated`, `typing`, `walking`, `dir`, `role`, `shirt`, `skin`, `hair` |
| `overlay(c)` | optional; drawn on top of everything |

`c` holds the 2D context `g`, the time `t` in seconds, the tile size `T` (16), the office size `CW`×`CH`, `night`, `opts`, `desks`, `lounge`, `sprites` and `anyError`. Draw in office pixels; the page scales the canvas for you. Then add the theme and its options to `CATALOG` in `public/index.html`. `npm test` loads every theme in the catalog and draws each option with every status, so a typo in one branch fails CI instead of a wall display.

Themes follow the same rules as the rest of Cubicle: no image files, no network, no dependencies.

## Translations

UI strings live in the `STR` object at the top of the script in `public/index.html`. Add a language by copying the `en` block; the page picks it from the browser language or `?lang=xx`.

## Pull requests

- Keep them focused; one change per PR.
- Run `npm test` and open the page in `?demo` mode to check nothing broke visually.
- If you change the look, re-record the demo with `scripts/record-demo.py` (see `scripts/README.md`), or say so in the PR and it will be done before release.

## Releases

Maintainers cut releases with `npm version <patch|minor|major>` and `git push --follow-tags`; CI publishes to npm with provenance.
