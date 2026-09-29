# Writing a theme

A theme changes how the office looks and nothing else: movement, bubbles, cards, the ⚙ menu and the data are shared. A theme is **one JavaScript file** in `public/themes/` plus **one entry** in `public/themes/index.json`. No images, no build step, no dependencies.

Built-in themes to read before you start:

| File | Shows how to |
| --- | --- |
| [`plaza.js`](../public/themes/plaza.js) | the shortest complete theme: a window wall, desks, a lounge, outfits |
| [`holding.js`](../public/themes/holding.js) | the company name on the wall (`K.sign`), an option (`view`) |
| [`factory.js`](../public/themes/factory.js) | making the room react to the office: robot arms move while agents work, an andon light shows errors |
| [`warehouse.js`](../public/themes/warehouse.js) | animated props (conveyor, roller door), custom furniture |
| [`space.js`](../public/themes/space.js) | effects on the desk (holograms), two very different backgrounds behind one option |
| [`military.js`](../public/themes/military.js) | a theme written without the kit, with four variants |

## 1. Copy the template

Save this as `public/themes/<your-id>.js` (lowercase letters, digits and dashes):

```js
// Cubicle theme: Hospital (HD). One line on what it looks like.
(() => {
  const K = window.CubicleKit, T = K.T;   // T = 16 office pixels per tile

  function drawRoom(c) {
    K.begin(c);
    K.floor(c, { work: ['#e8eef0', '#e2e9ec'], lounge: ['#d8e6e0', '#d2e1da'] });
    K.wall(c, { top: '#cfe3e8', bottom: '#b8d3da' });
    K.window(c, 1.2 * T, 4, 2.6 * T, 20, (cc, x, y, w, h) => K.skyline(cc, x, y, w, h));
    K.sign(c, 10.5 * T, 14, { color: '#1f6b8a' });            // the company name
    K.partition(c);
  }

  function props(c, list) {
    K.begin(c);
    // Anything characters can walk in front of or behind: push { z, f }, z is the y it sorts by.
    list.push({ z: 3.6 * T, f: () => K.shelf(15.6 * T, 2.1 * T, 2.2 * T, 22) });
    list.push({ z: (c.CH / T - 0.3) * T, f: () => K.plant(21.3 * T, c.CH - 4) });
  }

  function drawDesk(c, d, s) {
    K.begin(c);
    K.desk(c, d, s, { top: ['#fbfbfa', '#e6e7e8'], screens: 2, on: '#dff7ff' });
  }

  function drawChar(c, s) {
    K.begin(c);
    K.person(c, s, {
      top: '#5fb3a8', bottom: '#5fb3a8', coat: K.senior(s) ? '#f4f4f4' : null,
      hair: K.pick(s, 'hair', ['short', 'bun', 'pony', 'curly']),
      badge: '#1f6b8a',
    });
  }

  window.CubicleThemes.register({
    id: 'hospital', name: { en: 'Hospital (HD)', tr: 'Hastane (HD)' }, scale: 4, smooth: true,
    drawRoom, props, drawDesk, drawChar,
  });
})();
```

## 2. List it

Add an entry to `public/themes/index.json`:

```json
{ "id": "hospital", "name": { "en": "Hospital (HD)", "tr": "Hastane (HD)" }, "options": [] }
```

Options appear in the ⚙ menu, are remembered per browser, and can be set in the URL (`?theme=hospital&wing=er`). Each option has a `key`, a `label` and `values` as `[value, { en, tr }]` pairs; the first value is the default. Your theme receives the chosen values in `setup(opts)`:

```json
"options": [{ "key": "wing", "label": { "en": "Wing", "tr": "Bölüm" }, "values": [["ward", { "en": "Ward", "tr": "Servis" }], ["er", { "en": "Emergency", "tr": "Acil" }]] }]
```

## 3. Look at it

```bash
node bin/cubicle.js                     # then open:
# http://127.0.0.1:3200/?demo&theme=hospital          six demo agents
# http://127.0.0.1:3200/?demo&theme=hospital&kiosk    full screen
```

`npm test` loads every theme in `index.json` and draws every option with every status and a few dozen different agents, so a typo in one branch fails the test instead of a wall display.

## The layout you draw into

Coordinates are office pixels. The room is 22 tiles (352 px) wide; it grows taller when there are more than 12 agents, so use `c.CH` for anything anchored to the bottom.

| Area | Where |
| --- | --- |
| wall | `y` 0 to `2*T` |
| work area | `x` 0 to `14*T`; desks at `c.desks` (`[x, y]` in tiles, 34 × 27 px from `x*T, y*T`) |
| partition and doorway | `x` `14*T + 6` to `14*T + 10`, the doorway around `y = 7*T` |
| lounge | `x` `15*T` to `22*T`; idle agents wander between spots in `c.lounge` |

A seated agent stands at `(x*T + 22, y*T + 12)` of its desk, to the right of the screens, so keep the right half of the desk clear.

## What you get

`c` (every function): `g` the 2D context, `t` time in seconds, `T`, `CW`, `CH`, `night`, `opts`, `sprites` (every agent), `desks`, `lounge`, `anyError`, `company` (the company name, may be empty).

An agent `s`: `id`, `name`, `role`, `status` (`running`, `waiting`, `idle`, `error`, `paused`), `ask` (a board question is waiting), `seated`, `typing`, `walking`, `dir`, `x`, `y`, `shirt`, `skin`, `hair` colours, and `look`: what the user chose in the appearance dialog (`hair` style, `bottom` `'trousers'`/`'skirt'`, `shoes` `'flats'`/`'heels'`; colours are already in `shirt`, `skin`, `hair`).

**Faces and the logo.** `K.person` handles both for you: it applies `s.look` over your outfit and draws the agent's photo instead of the head when there is one. If you draw people yourself (like `military.js`), call `window.CubicleThemes.photoHead(g, s, x, headY, radius)` where you would draw the head; it returns `true` when it drew a photo, then skip your face, hair and hat. The company logo the user uploads is hung by the page; tell it where your wall has room with `logoSpot: [x, y, w, h]` (office pixels) in `register`, or a function `(c) => [x, y, w, h]`.

## The kit (`window.CubicleKit`)

Call `K.begin(c)` at the start of each function. The main helpers:

| Helper | |
| --- | --- |
| `rect`, `rr` (rounded), `circle`, `ellipse`, `poly`, `line`, `text`, `vgrad`, `hgrad`, `glow`, `shadow(fn)`, `clip(x, y, w, h, fn)` | drawing primitives |
| `floor`, `planks`, `concrete`, `wall`, `partition` | the room |
| `window(c, x, y, w, h, view)` with `sky`, `skyline`, `sea`, `starfield` | windows and what is outside |
| `desk`, `monitor`, `screenColor` | a desk that shows the agent's state (typing, amber when it needs you, red on error) |
| `plant`, `sofa`, `table`, `shelf`, `waterCooler`, `coffeeMachine` | furniture |
| `clock`, `analogClock`, `statusBoard`, `counts(c)`, `sign` | things on the wall that react to the office |
| `person(c, s, look)` | an agent in any outfit; see the comment above it in `kit.js` for every `look` field (suits, skirts and heels, coveralls, hi-vis vests, hard hats, lab coats, headsets, helmets...) |
| `rand(s, salt)`, `pick(s, salt, list)`, `senior(s)` | stable per-agent choices: the same agent always gets the same look |

## Rules

- Everything is drawn in code: no image files, fonts, network requests or dependencies.
- No real logos, brands, flags, emblems or recognisable characters. The company name comes from the data (`K.sign`); the user's own logo is placed by the page at your `logoSpot`.
- Keep states readable: working, needs-you (amber), error (red) and idle should be obvious at a glance on a TV across the room.
- Looks come from the agent id (`K.rand`, `K.pick`), never from `Math.random()`, so nobody changes clothes between frames.
- One theme per pull request. Include a screenshot.
