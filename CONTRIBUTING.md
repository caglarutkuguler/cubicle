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

A theme is one file in `public/themes/` plus one entry in `public/themes/index.json`, drawn with the shared helpers in `public/themes/kit.js` (people in any outfit, desks that show the agent's state, windows, furniture). [docs/THEMES.md](docs/THEMES.md) has a copy-paste template, the layout and the rules. `npm test` draws every listed theme with every option and status, so a typo in one branch fails CI instead of a wall display. Issues labelled [theme](https://github.com/caglarutkuguler/cubicle/labels/theme) are ideas waiting for someone.

## The Paperclip plugin

The npm package doubles as a Paperclip plugin (`paperclipPlugin` in `package.json`). `paperclip/manifest.js` declares a sidebar link and a page; `public/index.js` is the React module Paperclip loads for them (plain ESM using Paperclip's own React, no build), and it frames `public/index.html?embed=paperclip`, which Paperclip serves from the plugin folder. `paperclip/worker.js` answers the host's lifecycle calls over JSON-RPC on stdio without the SDK, so the package keeps zero dependencies. To try changes, install your clone into a local Paperclip: `npx paperclipai plugin install /path/to/cubicle`.

## Translations

UI strings live in the `STR` object at the top of the script in `public/index.html` (English, Turkish, German, Spanish and French so far). Add a language by copying the `en` block; the page picks it from the browser language or `?lang=xx`. `npm test` checks that every language has every string. Theme names in `public/themes/index.json` fall back to English, so a `"de": "…"` next to `en` and `tr` is welcome but optional.

## Pull requests

- Keep them focused; one change per PR.
- Run `npm test` and open the page in `?demo` mode to check nothing broke visually.
- If you change the look, re-record the demo with `scripts/record-demo.py` (see `scripts/README.md`), or say so in the PR and it will be done before release.

## Releases

Maintainers cut releases with `npm version <patch|minor|major>` and `git push --follow-tags`; CI publishes to npm with provenance.
