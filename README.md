# Cubicle

**A live pixel-art office for your [Paperclip](https://github.com/paperclipai/paperclip) agents.**

**[▶ Live demo](https://caglarutkuguler.github.io/cubicle/)** — no install, fake agents. · [Türkçe demo](https://caglarutkuguler.github.io/cubicle/?lang=tr)

Your AI agents get a desk. When one starts working it walks over, sits down and starts typing, with its current task floating above its head. When it finishes it goes back to the lounge for a coffee. If it hits an error, its screen flashes red.

[![Cubicle demo](docs/demo.gif)](https://caglarutkuguler.github.io/cubicle/)

- **Zero dependencies.** One small Node.js file plus one HTML page. No build step.
- **Read-only by design.** Cubicle forwards only three `GET` endpoints to Paperclip; every other request is refused.
- **Works with any adapter.** Claude Code, Codex, Cursor and HTTP agents all show up, because Cubicle reads agent status from Paperclip itself.
- **Try it without Paperclip.** `?demo` shows a fake company.
- **English and Turkish UI**, picked from your browser language or with `?lang=en` / `?lang=tr`.

## Quick start

Requires Node.js 18+ and a running Paperclip instance (default `http://127.0.0.1:3100`).

```bash
npx github:caglarutkuguler/cubicle
```

Then open <http://127.0.0.1:3200>.

Or from a clone:

```bash
git clone https://github.com/caglarutkuguler/cubicle.git
cd cubicle
node bin/cubicle.js
```

No Paperclip yet? Open <http://127.0.0.1:3200/?demo>, or just use the [hosted demo](https://caglarutkuguler.github.io/cubicle/).

## Options

| Flag | Environment variable | Default |
| --- | --- | --- |
| `--port` | `CUBICLE_PORT` | `3200` |
| `--host` | `CUBICLE_HOST` | `127.0.0.1` |
| `--paperclip` | `PAPERCLIP_URL` | `http://127.0.0.1:3100` |

URL parameters:

- `?company=PREFIX` opens a specific company (for example `?company=MEG`). With several companies, a picker also appears in the header.
- `?lang=en` or `?lang=tr` sets the language.
- `?demo` shows fake agents.

## What the office shows

| Agent status in Paperclip | In the office |
| --- | --- |
| `running` | Sits at its desk, monitor on, typing; bubble shows the task id |
| `idle` | Wanders the lounge; says "✓ done" right after finishing a run |
| `error` | Slumped at its desk, red screen, error text on its card |
| `paused` | "zZ" |

Each card below the office links straight to the agent's current task in Paperclip.

## Run it as a service (Linux / WSL)

An example systemd user unit is in [`examples/cubicle.service`](examples/cubicle.service):

```bash
mkdir -p ~/.config/systemd/user
cp examples/cubicle.service ~/.config/systemd/user/
# edit ExecStart to point at your node binary and clone
systemctl --user daemon-reload
systemctl --user enable --now cubicle.service
```

## Security notes

- Cubicle binds to `127.0.0.1` by default. Keep it that way unless you put it behind your own authentication, because anyone who can reach it can see your agent names, statuses and task titles.
- Only `GET /api/health`, `GET /api/companies` and `GET /api/companies/:id/(agents|issues)` are forwarded. `POST`, `PATCH` and `DELETE` are rejected with `405`, and any other path gets `403`.
- It currently targets Paperclip's default `local_trusted` mode. Authenticated deployments are not supported yet.

## How it works

`bin/cubicle.js` serves `public/index.html` and proxies the allowed read-only endpoints. The page polls every 4 seconds and draws everything, including characters, furniture and the day/night windows, on a 352×208 canvas with plain rectangles. There are no image assets.

## Contributing

Issues and pull requests are welcome. Ideas: more rooms and furniture, meeting-room animations when agents hand work to each other, sprite customisation per agent, and support for authenticated Paperclip deployments.

## Credits

Inspired by the idea behind [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) by Pablo De Lucca. Cubicle is an independent implementation and uses no code or assets from it.

Cubicle is a community project and is not affiliated with or endorsed by Paperclip Labs.

## License

[MIT](LICENSE)

---

### Türkçe

**Cubicle**, [Paperclip](https://github.com/paperclipai/paperclip) ajanlarınızı canlı bir pixel ofiste gösterir. Çalışan ajan masasına oturup yazar ve başının üstünde görev kodu görünür; işi biten ajan dinlenme alanına döner; hata alan ajanın ekranı kırmızı yanar.

Kurulum: `npx github:caglarutkuguler/cubicle` komutunu çalıştırın ve <http://127.0.0.1:3200> adresini açın. Paperclip kurulu değilse <http://127.0.0.1:3200/?demo> adresiyle demo modunu deneyebilirsiniz. Arayüz tarayıcı diline göre Türkçe açılır; `?lang=tr` ile de seçilebilir.
