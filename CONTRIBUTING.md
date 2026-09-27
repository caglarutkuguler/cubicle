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

## Translations

UI strings live in the `STR` object at the top of the script in `public/index.html`. Add a language by copying the `en` block; the page picks it from the browser language or `?lang=xx`.

## Pull requests

- Keep them focused; one change per PR.
- Run `npm test` and open the page in `?demo` mode to check nothing broke visually.
- If you change the look, re-record the demo with `scripts/record-demo.py` (see `scripts/README.md`), or say so in the PR and it will be done before release.

## Releases

Maintainers cut releases with `npm version <patch|minor|major>` and `git push --follow-tags`; CI publishes to npm with provenance.
