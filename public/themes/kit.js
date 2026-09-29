// Cubicle theme kit: shared drawing helpers for HD themes, so a new theme is mostly a
// palette, a room and an outfit. Loaded by the page before any theme file.
//
// Everything is drawn in office pixels (the room is 22 tiles of 16 px wide); HD themes
// set scale: 4, so half a pixel still looks sharp. Coordinates used by the page:
//   wall        y 0 .. 2T            work area   x 0 .. 14T       partition  x 14T+6 .. 14T+10
//   lounge      x 15T .. 22T         desks       c.desks, [x, y] in tiles; a seated agent is at
//                                                (x*T + 22, y*T + 12), to the right of the screens
// See docs/THEMES.md for a walkthrough.
(() => {
  const T = 16;
  let g = null;

  const K = {
    T,
    /** Call at the start of every theme function: points the helpers at this frame's canvas. */
    begin(c) { g = c.g; return K; },
    get g() { return g; },

    // ---------- primitives ----------
    fill(col) { g.fillStyle = col; },
    rect(col, x, y, w, h) { g.fillStyle = col; g.fillRect(x, y, w, h); },
    rr(col, x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      g.fillStyle = col; g.beginPath();
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
    },
    circle(col, x, y, r) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); },
    ellipse(col, x, y, rx, ry, rot = 0) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); },
    poly(col, pts) { g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y)); g.closePath(); g.fill(); },
    line(col, w, x1, y1, x2, y2) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); },
    vgrad(x, y, h, a, b) { const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; },
    hgrad(x, y, w, a, b) { const gr = g.createLinearGradient(x, y, x + w, y); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; },
    glow(x, y, r, col) {                    // soft radial light, col like 'rgba(255,200,80,.3)'
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    },
    star(col, x, y, r) {
      g.fillStyle = col; g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r * 0.45 : r;
        g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d);
      }
      g.closePath(); g.fill();
    },
    text(str, x, y, { size = 4, weight = 600, color = '#fff', align = 'left', font = 'system-ui, sans-serif', baseline = 'middle' } = {}) {
      g.fillStyle = color; g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = baseline;
      g.fillText(str, x, y); g.textAlign = 'start';
    },
    shadow(fn, blur = 3, oy = 1.5, col = 'rgba(0,0,0,.35)') {
      g.save(); g.shadowColor = col; g.shadowBlur = blur; g.shadowOffsetY = oy; fn(); g.restore();
    },
    clip(x, y, w, h, fn) { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); fn(); g.restore(); },

    // ---------- determinism: looks come from the agent id, so they never change ----------
    hash(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; },
    /** A stable number in [0, 1) for this agent; salt picks a different one per feature. */
    rand(s, salt = 0) { return (K.hash(`${s.id}|${salt}`) % 10007) / 10007; },
    pick(s, salt, list) { return list[Math.floor(K.rand(s, salt) * list.length)]; },
    pad(n) { return String(n).padStart(2, '0'); },
    /** Command roles get the senior look (a star, a darker suit...). */
    senior(s) { return /\b(ceo|cto|cfo|coo|chief|head|lead|director|manager|founder|president|vp|captain|commander)\b/i.test(`${s.role || ''} ${s.name || ''} ${s.title || ''}`); },

    // ---------- room ----------
    /** Tiled floor for the work area and the lounge. opts: work [a,b], lounge [a,b], grout colour, tile size in px. */
    floor(c, { work, lounge, grout = 'rgba(0,0,0,.12)', tile = T, split = 15 * T } = {}) {
      for (let y = 2 * T; y < c.CH; y += tile) for (let x = 0; x < c.CW; x += tile) {
        const pal = x < split ? work : (lounge || work);
        K.rect(((x + y) / tile) % 2 ? pal[0] : pal[1], x, y, tile, tile);
      }
      if (grout) {
        g.strokeStyle = grout; g.lineWidth = 0.25; g.beginPath();
        for (let y = 2 * T; y <= c.CH; y += tile) { g.moveTo(0, y); g.lineTo(c.CW, y); }
        for (let x = 0; x <= c.CW; x += tile) { g.moveTo(x, 2 * T); g.lineTo(x, c.CH); }
        g.stroke();
      }
    },
    /** Wooden planks from x0 to x1. */
    planks(c, x0, x1, [a, b], plank = 5) {
      for (let y = 2 * T, row = 0; y < c.CH; y += plank, row++) {
        const off = (row * 13) % 24;
        for (let x = x0 - off; x < x1; x += 24) {
          const xs = Math.max(x, x0), xe = Math.min(x + 24, x1);
          K.rect((row + Math.floor(x / 24)) % 3 ? a : b, xs, y, xe - xs - 0.3, plank - 0.3);
        }
      }
    },
    /** Concrete: flat colour with a few soft stains. */
    concrete(c, x0, x1, col, stain = 'rgba(0,0,0,.03)') {
      K.rect(col, x0, 2 * T, x1 - x0, c.CH - 2 * T);
      for (let i = 0; i < 18; i++) {
        const h = K.hash(`stain${i}`);
        K.ellipse(stain, x0 + (h % 1000) / 1000 * (x1 - x0), 2 * T + ((h >>> 10) % 1000) / 1000 * (c.CH - 2 * T), 4 + h % 6, 2 + h % 3);
      }
    },
    wall(c, { top, bottom, trim, band } = {}) {
      K.rect(K.vgrad(0, 0, 2 * T, top, bottom), 0, 0, c.CW, 2 * T);
      if (band) K.rect(band, 0, 2 * T - 7, c.CW, 4.5);
      K.rect(trim || 'rgba(0,0,0,.35)', 0, 2 * T - 2.5, c.CW, 2.5);
      K.rect('rgba(255,255,255,.08)', 0, 2 * T - 2.5, c.CW, 0.5);
    },
    /** Glass wall between the work area and the lounge, with the doorway the agents use. */
    partition(c, { glass = 'rgba(170,210,255,.16)', frame = '#2c3036' } = {}) {
      const x = 14 * T + 6;
      K.rect(glass, x, 2 * T, 4, 4 * T); K.rect(glass, x, 8 * T, 4, c.CH - 8 * T);
      K.rect(frame, x, 2 * T, 4, 1.5); K.rect(frame, x, 8 * T, 4, 1.5); K.rect(frame, x, 6 * T - 1.5, 4, 1.5);
    },
    sky(c, x, y, h) { return c.night ? K.vgrad(x, y, h, '#0b1426', '#1d2c4a') : K.vgrad(x, y, h, '#6fb3ea', '#cfe8ff'); },
    /** City skyline with windows that light up at night. */
    skyline(c, x, y, w, h, seed = 1) {
      K.clip(x, y, w, h, () => {
        K.rect(K.sky(c, x, y, h), x, y, w, h);
        for (let layer = 0; layer < 2; layer++) {
          let bx = x - 2;
          for (let i = 0; bx < x + w; i++) {
            const hh = K.hash(`${seed}-${layer}-${i}`), bw = 4 + hh % 6, bh = h * (0.35 + ((hh >>> 4) % 50) / 100) * (layer ? 0.8 : 1);
            const col = layer ? (c.night ? '#1a2238' : '#7f93ad') : (c.night ? '#10162a' : '#4d5d75');
            K.rect(col, bx, y + h - bh, bw, bh);
            if (!layer) for (let wy = y + h - bh + 1.5; wy < y + h - 1; wy += 2.2) for (let wx = bx + 0.8; wx < bx + bw - 0.8; wx += 1.6) {
              const lit = K.hash(`${seed}${i}${wx}${wy}`) % 5 === 0;
              K.rect(c.night ? (lit ? '#ffd98a' : '#1b2338') : (lit ? '#b9d2ea' : '#3e4c61'), wx, wy, 0.7, 1);
            }
            bx += bw + 0.5 + (hh >>> 9) % 2;
          }
        }
      });
    },
    sea(c, x, y, w, h) {
      K.rect(K.sky(c, x, y, h), x, y, w, h);
      K.rect(c.night ? '#0d2140' : '#3f86bf', x, y + h * 0.6, w, h * 0.4);
      for (let i = 0; i < 4; i++) K.rect('rgba(255,255,255,.25)', x + ((c.t * 2 + i * 9) % w), y + h * 0.7 + i * 1.3, 3, 0.35);
    },
    starfield(c, x, y, w, h, seed = 7) {
      K.rect('#03050c', x, y, w, h);
      for (let i = 0; i < w * h / 12; i++) {
        const hh = K.hash(`${seed}*${i}`);
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(c.t * 0.7 + i));
        g.globalAlpha = tw; K.rect('#e8f0ff', x + (hh % 997) / 997 * w, y + ((hh >>> 10) % 991) / 991 * h, 0.5, 0.5); g.globalAlpha = 1;
      }
    },
    /** A framed window. view(c, x, y, w, h) draws what is outside. */
    window(c, x, y, w, h, view, { frame = '#2b2f36', mullions = 1 } = {}) {
      K.rr(frame, x - 1.2, y - 1.2, w + 2.4, h + 2.4, 0.8);
      view(c, x, y, w, h);
      for (let i = 1; i <= mullions; i++) K.rect(frame, x + (w * i) / (mullions + 1) - 0.6, y, 1.2, h);
      K.rect('rgba(255,255,255,.10)', x, y, w, 1.2);
    },
    /** Digital wall clock. */
    clock(c, x, y, { label = 'LOCAL', utc = false, color = '#ff6b4a', bg = '#101418' } = {}) {
      const d = new Date(), hh = utc ? d.getUTCHours() : d.getHours(), mm = utc ? d.getUTCMinutes() : d.getMinutes();
      K.rr(bg, x, y, 15, 9, 1.2);
      K.text(`${K.pad(hh)}:${K.pad(mm)}`, x + 7.5, y + 4.2, { size: 5.4, color, align: 'center', font: 'ui-monospace, Menlo, Consolas, monospace' });
      if (label) K.text(label, x + 7.5, y + 7.6, { size: 2.2, color: 'rgba(255,255,255,.55)', align: 'center' });
    },
    /** Round analogue clock. */
    analogClock(c, x, y, r = 5, { face = '#f4f1ea', rim = '#2b2b2b' } = {}) {
      const d = new Date();
      K.circle(rim, x, y, r + 0.8); K.circle(face, x, y, r);
      const hand = (a, len, w) => K.line('#222', w, x, y, x + Math.sin(a) * len, y - Math.cos(a) * len);
      hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, r * 0.5, 0.7);
      hand(d.getMinutes() / 60 * Math.PI * 2, r * 0.8, 0.5);
      K.circle('#c0392b', x, y, 0.5);
    },
    /** Counts by status, for dashboards: { running, waiting, error, idle, total }. */
    counts(c) {
      const all = [...c.sprites.values()];
      const n = (st) => all.filter((s) => s.status === st).length;
      return { running: n('running'), waiting: n('waiting') + all.filter((s) => s.ask && s.status !== 'waiting').length, error: n('error'), idle: n('idle') + n('paused'), total: all.length };
    },
    /** Framed display showing one bar per status (blue working, amber needs you, red error, grey idle). */
    statusBoard(c, x, y, w, h, { frame = '#1b1f24', bg = '#05090c' } = {}) {
      K.rr(frame, x - 1.2, y - 1.2, w + 2.4, h + 2.4, 1.5); K.rect(bg, x, y, w, h);
      const n = K.counts(c), max = Math.max(1, n.total);
      [['#5fa8ff', n.running], ['#ffd23f', n.waiting], ['#ff5a5a', n.error], ['#9aa0b4', n.idle]].forEach(([col, v], i) => {
        const by = y + 1.5 + i * (h - 2) / 4, bh = (h - 2) / 4 - 1.2;
        K.rect('rgba(255,255,255,.07)', x + 1.5, by, w - 3, bh);
        K.rect(col, x + 1.5, by, (w - 3) * v / max, bh);
      });
    },
    /** Company name as lettering on the wall (the "logo"). */
    sign(c, x, y, { color = '#d8b25a', size = 6, plate = null, weight = 700, font = 'Georgia, "Times New Roman", serif', max = 60 } = {}) {
      const name = (c.company || '').slice(0, 28);
      if (!name) return;
      g.font = `${weight} ${size}px ${font}`;
      const w = Math.min(max, g.measureText(name).width);
      if (plate) K.rr(plate, x - w / 2 - 3, y - size * 0.8, w + 6, size * 1.6, 1);
      g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 1.5; g.shadowOffsetY = 0.6;
      g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(name, x, y, max); g.restore(); g.textAlign = 'start';
    },

    // ---------- furniture ----------
    /** The screen colour for an agent's state. */
    screenColor(c, s, on = '#8fe3ff', off = '#1f252b') {
      if (!s || !s.seated) return off;
      if (s.status === 'error') return Math.floor(c.t * 2) % 2 ? '#ff5a5a' : '#8e2222';
      if (s.status === 'waiting') return Math.floor(c.t) % 2 ? '#ffc34a' : '#a87916';
      return s.typing ? on : off;
    },
    monitor(c, x, y, w, h, s, { on, bezel = '#15181c', lines = '#0a2a12' } = {}) {
      K.rr(bezel, x, y, w, h, 0.8);
      K.rect(K.screenColor(c, s, on), x + 0.8, y + 0.8, w - 1.6, h - 1.6);
      if (s && s.typing) {
        g.globalAlpha = 0.85; g.fillStyle = lines;
        for (let i = 0; i < Math.floor((h - 2) / 1.8); i++) g.fillRect(x + 1.4, y + 1.6 + i * 1.8, ((Math.floor(c.t * 9 + i * 3 + x) % Math.max(2, w - 4)) + 1), 0.7);
        g.globalAlpha = 1;
      }
      K.rect('rgba(255,255,255,.12)', x + 0.8, y + 0.8, w - 1.6, 1.2);
      K.rect(bezel, x + w / 2 - 0.8, y + h, 1.6, 2);
    },
    /**
     * A desk with screens for one agent. d is [x, y] in tiles, s the agent there (or undefined).
     * opts: top [a, b] gradient, front, legs, chair, screens (1 or 2), on (screen colour when
     * working), mug, keyboard, extra(x, y) for theme props on the desk.
     */
    desk(c, d, s, { top = ['#6f757d', '#565c63'], front = '#3d4247', legs = '#2c3034', chair = '#23262b', screens = 2, on = '#8fe3ff', lines, bezel, mug = '#e8e3d6', keyboard = '#2b2f34', extra } = {}) {
      const x = d[0] * T, y = d[1] * T;
      if (chair) K.rr(chair, x + 18, y + 3, 9, 7, 2);
      K.shadow(() => K.rr(K.vgrad(x, y + 8, 10, top[0], top[1]), x, y + 8, 34, 10, 1.5));
      K.rect(front, x, y + 16.5, 34, 4.5);
      K.rect(legs, x + 1.5, y + 21, 2, 6); K.rect(legs, x + 30.5, y + 21, 2, 6);
      if (screens === 2) { K.monitor(c, x + 1.5, y - 3, 9, 9.5, s, { on, lines, bezel }); K.monitor(c, x + 10.5, y - 3, 9, 9.5, s, { on, lines, bezel }); }
      else K.monitor(c, x + 3, y - 4, 14, 10.5, s, { on, lines, bezel });
      if (s && s.seated && (s.typing || s.status === 'waiting' || s.status === 'error')) {
        K.glow(x + 10, y + 9, 12, s.status === 'error' ? 'rgba(255,80,80,.25)' : s.status === 'waiting' ? 'rgba(255,200,80,.25)' : 'rgba(140,220,255,.18)');
      }
      if (keyboard) {
        K.rr(keyboard, x + 21, y + 10, 10, 2.4, 0.6);
        if (s && s.typing) K.rect('#e6f0f5', x + 21.6 + (Math.floor(c.t * 12) % 9), y + 10.6, 0.8, 0.8);
      }
      if (mug) K.rr(mug, x + 31.2, y + 9, 2.2, 3, 0.6);
      if (extra) extra(x, y);
    },
    plant(x, y, { size = 1, pot = '#b8653a', leaf = '#3f9a55', leaf2 = '#57b86b' } = {}) {
      K.rr(pot, x - 3 * size, y - 5 * size, 6 * size, 5 * size, 1);
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.38;
        K.ellipse(i % 2 ? leaf : leaf2, x + Math.cos(a) * 4 * size, y - 6 * size + Math.sin(a) * 4 * size, 2.4 * size, 1.1 * size, a);
      }
    },
    sofa(x, y, w, { color = '#6a3f8f', dark } = {}) {
      dark = dark || 'rgba(0,0,0,.2)';
      K.shadow(() => K.rr(color, x, y, w, 12, 2.5));
      K.rr(dark, x + 1, y + 1, w - 2, 5, 2);
      K.rr(color, x - 1.5, y + 3, 4, 9, 1.5); K.rr(color, x + w - 2.5, y + 3, 4, 9, 1.5);
      for (let i = 1; i < 3; i++) K.rect(dark, x + (w * i) / 3, y + 6.5, 0.4, 5);
    },
    table(x, y, w, h, { top = '#5b4430', edge = '#4a3727', chairs = '#303338', chairCount = 5 } = {}) {
      K.shadow(() => K.rr(edge, x, y, w, h, 5), 4, 2);
      K.rr(top, x + 1, y + 1, w - 2, h - 2, 4);
      for (let i = 0; i < chairCount; i++) K.circle(chairs, x + 8 + i * ((w - 16) / Math.max(1, chairCount - 1)), y + h + 2.5, 2.2);
    },
    waterCooler(x, y) {
      K.rr('#d9dde2', x, y + 10, 10, 16, 1.2);
      K.rr('rgba(120,190,255,.75)', x + 1.5, y, 7, 11, 2.5);
      K.rect('#5a6068', x + 3, y + 17, 4, 1);
    },
    coffeeMachine(c, x, y, { body = '#2d3035', steel = ['#c8ccd2', '#8d939b'] } = {}) {
      K.rr(body, x, y + 10, 11, 12, 1); K.rr(K.vgrad(x + 1, y, 11, steel[0], steel[1]), x + 1.5, y + 1, 8, 10, 2);
      K.rect('#1c1d20', x + 4.5, y + 11, 2, 2);
      K.circle(Math.floor(c.t * 2) % 2 ? '#5fe08a' : '#2a6a3a', x + 8.8, y + 13.5, 0.7);
    },
    shelf(x, y, w, h, { wood = '#6b4a2e', items = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1'] } = {}) {
      K.rr(wood, x, y, w, h, 0.8);
      const rows = Math.max(1, Math.floor(h / 7));
      for (let r = 0; r < rows; r++) {
        const sy = y + 1 + r * (h - 2) / rows, sh = (h - 2) / rows;
        K.rect('rgba(0,0,0,.35)', x + 1, sy, w - 2, sh - 0.8);
        for (let bx = x + 1.5, i = 0; bx < x + w - 2; i++) {
          const bw = 1 + (K.hash(`${x}${r}${i}`) % 3) * 0.6, bh = sh - 2 - (K.hash(`${i}${r}`) % 2);
          K.rect(items[K.hash(`${x}/${r}/${i}`) % items.length], bx, sy + sh - 0.8 - bh, bw, bh);
          bx += bw + 0.3;
        }
      }
    },

    // ---------- people ----------
    /**
     * Draw an agent. look (all optional):
     *   top, sleeve      jacket/shirt colour (sleeve defaults to top)
     *   inner, tie       shirt under an open jacket, tie colour
     *   bottom           trousers or skirt colour; skirt: true for a skirt
     *   legs             tights/skin colour below a skirt (default s.skin)
     *   shoes, heels     shoe colour; heels: true for heeled shoes
     *   hair             'short' | 'long' | 'bun' | 'pony' | 'curly' | 'bald' (colour: s.hair)
     *   head             'hardhat' | 'cap' | 'helmet' | 'headset' | 'beanie' | null; headColor
     *   vest             { color, stripe } hi-vis vest over the top
     *   coat             long coat colour (lab coat, overcoat)
     *   glasses          colour, or true
     *   badge            lanyard colour; tag: true shows a name tag in the agent's colour
     *   insignia         (x, top) => {} extra marks on the chest
     *   after            (x, top, headY) => {} anything drawn last (visor, props)
     * The agent's state sets the pose: typing at a desk, a hand up when waiting, slumped on error,
     * a coffee cup when resting in the lounge.
     */
    person(c, s, look = {}) {
      // What the user picked for this agent in the appearance dialog wins over the theme's choice.
      const my = s.look || {};
      if (my.hair) look = { ...look, hair: my.hair };
      if (my.bottom) look = { ...look, skirt: my.bottom === 'skirt' };
      if (my.shoes) look = { ...look, heels: my.shoes === 'heels' };
      const t = c.t, x = s.x, y = s.y;
      const top = look.top || '#4f6f9c', sleeve = look.sleeve || top, bottom = look.bottom || '#2f3440';
      const shoes = look.shoes || '#1d1f24';
      const bob = s.walking ? Math.abs(Math.sin(t * 8 + (s.seed || 0))) * 0.8 : 0;
      const slump = s.status === 'error' && s.seated ? 1.2 : 0;
      K.ellipse('rgba(0,0,0,.25)', x, y, 4.5, 1.3);
      if (!s.seated) {
        const sw = s.walking ? Math.sin(t * 8 + (s.seed || 0)) * 1.6 : 0;
        const lift = look.heels ? 0.9 : 0;
        if (look.skirt || look.coat) {
          const leg = look.legs || s.skin;
          K.rr(leg, x - 2.6, y - 5.5, 1.8, 5 + sw * 0.3 - lift, 0.8);
          K.rr(leg, x + 0.8, y - 5.5, 1.8, 5 - sw * 0.3 - lift, 0.8);
        } else {
          K.rr(bottom, x - 3.2, y - 6.5, 2.6, 6 + sw * 0.3 - lift, 0.8);
          K.rr(bottom, x + 0.6, y - 6.5, 2.6, 6 - sw * 0.3 - lift, 0.8);
        }
        const shoe = (sx, dy) => {
          if (look.heels) {
            K.rr(shoes, sx + 0.3, y - 1.9 + dy, 2.6, 1.3, 0.6);
            K.rect(shoes, sx + 0.5, y - 1.2 + dy, 0.5, 1.2);          // the heel
          } else K.rr(shoes, sx, y - 1.4 + dy, 3.2, 1.6, 0.6);
        };
        shoe(x - 3.6 + sw * 0.4, 0); shoe(x + 0.4 - sw * 0.4, 0);
      }
      const tp = y - 12.5 - bob;                                        // top of the torso
      if (look.coat) K.rr(look.coat, x - 4.6, tp, 9.2, s.seated ? 7.5 : 10.5, 2);
      K.rr(top, x - 4.3, tp, 8.6, 7.2, 2);
      if (look.skirt && !s.seated) K.poly(bottom, [[x - 4.2, tp + 6.2], [x + 4.2, tp + 6.2], [x + 4.7, tp + 9.4], [x - 4.7, tp + 9.4]]);
      else if (!look.coat) K.rect(bottom, x - 4.3, tp + 6, 8.6, 1.4);
      if (look.inner) K.poly(look.inner, [[x - 1.6, tp], [x + 1.6, tp], [x, tp + 3.6]]);
      if (look.tie) K.poly(look.tie, [[x - 0.5, tp + 0.4], [x + 0.5, tp + 0.4], [x + 0.8, tp + 4.4], [x, tp + 5.2], [x - 0.8, tp + 4.4]]);
      if (look.vest) {
        K.rr(look.vest.color, x - 4.3, tp + 0.3, 3, 6.6, 1); K.rr(look.vest.color, x + 1.3, tp + 0.3, 3, 6.6, 1);
        K.rect(look.vest.stripe || '#e8e8e8', x - 4.3, tp + 4, 3, 0.7); K.rect(look.vest.stripe || '#e8e8e8', x + 1.3, tp + 4, 3, 0.7);
      }
      if (look.badge) { K.line(look.badge, 0.35, x - 1.4, tp + 0.2, x + 0.6, tp + 3.5); K.line(look.badge, 0.35, x + 1.4, tp + 0.2, x + 0.6, tp + 3.5); K.rr('#f4f4f4', x - 0.2, tp + 3.3, 1.8, 2.2, 0.3); }
      if (look.tag) K.rect(s.shirt, x + 0.8, tp + 1.6, 2.8, 1);
      if (look.insignia) look.insignia(x, tp);
      // arms
      if (s.typing) {
        const a = Math.floor(t * 10 + (s.seed || 0)) % 2;
        K.rr(sleeve, x - 5.6, tp + 1.5, 2, 4, 1); K.rr(sleeve, x + 3.6, tp + 1.5, 2, 4, 1);
        K.circle(s.skin, x - 4.8, tp + 5.8 - a * 0.8, 1.1); K.circle(s.skin, x + 4.6, tp + 5.8 - (1 - a) * 0.8, 1.1);
      } else if (s.status === 'waiting' && s.seated) {
        const w = Math.sin(t * 5 + (s.seed || 0)) * 0.8;
        K.rr(sleeve, x - 5.6, tp + 1.5, 2, 5, 1);
        K.rr(sleeve, x + 3.8 + w * 0.3, tp - 5.5, 2, 7.5, 1);
        K.circle(s.skin, x + 4.8 + w, tp - 6.4, 1.2);
      } else {
        K.rr(sleeve, x - 5.6, tp + 1.2, 2, 5.5, 1); K.rr(sleeve, x + 3.6, tp + 1.2, 2, 5.5, 1);
        K.circle(s.skin, x - 4.6, tp + 7, 1); K.circle(s.skin, x + 4.6, tp + 7, 1);
        if (!s.seated && !s.walking && s.status !== 'error') {            // coffee break
          K.rr('#f2efe8', x + 3.6, tp + 5, 2.2, 2.6, 0.5); K.rect('#6b4226', x + 3.9, tp + 5.2, 1.6, 0.5);
        }
      }
      // head
      const hy = tp - 3.6 + slump, hair = s.hair || '#2b1d14', style = look.hair || 'short';
      K.rect(s.skin, x - 1, tp - 1.2 + slump, 2, 1.6);
      // A photo head replaces the drawn face, hair and headwear (a see-through helmet stays).
      const photo = window.CubicleThemes && window.CubicleThemes.photoHead;
      if (photo && photo(g, s, x, hy, 4.2)) {
        if (look.head === 'helmet') { g.strokeStyle = look.headColor || '#f2c230'; g.lineWidth = 0.6; g.beginPath(); g.arc(x, hy, 4.9, 0, Math.PI * 2); g.stroke(); }
        if (look.after) look.after(x, tp, hy);
        return;
      }
      if (style === 'long') K.rr(hair, x - 3.6, hy - 2, 7.2, 7.4, 2.5);            // hair behind the shoulders
      if (style === 'pony') K.ellipse(hair, x + 3.3, hy + 1.2, 1.1, 2.6, -0.3);
      K.circle(s.skin, x, hy, 3.3);
      if (style !== 'bald') { g.fillStyle = hair; g.beginPath(); g.arc(x, hy, 3.4, Math.PI * 1.02, Math.PI * 1.98); g.fill(); }
      if (style === 'long') { K.rr(hair, x - 3.6, hy - 1.5, 1, 4.5, 0.5); K.rr(hair, x + 2.6, hy - 1.5, 1, 4.5, 0.5); }
      if (style === 'bun') K.circle(hair, x, hy - 3.6, 1.5);
      if (style === 'curly') for (let i = 0; i < 6; i++) K.circle(hair, x - 3 + i * 1.2, hy - 2.4 - Math.sin(i) * 0.6, 1);
      const blink = ((t + (s.seed || 0)) % 4) < 0.14;
      if (!blink) { const ox = (s.dir || 0) * 0.8; K.circle('#15171a', x - 1.2 + ox, hy + 0.4, 0.45); K.circle('#15171a', x + 1.2 + ox, hy + 0.4, 0.45); }
      if (look.glasses) { const gc = look.glasses === true ? '#222' : look.glasses; g.strokeStyle = gc; g.lineWidth = 0.3; g.beginPath(); g.arc(x - 1.2, hy + 0.4, 0.9, 0, Math.PI * 2); g.moveTo(x + 2.1, hy + 0.4); g.arc(x + 1.2, hy + 0.4, 0.9, 0, Math.PI * 2); g.stroke(); }
      const hc = look.headColor || '#f2c230';
      if (look.head === 'hardhat') { g.fillStyle = hc; g.beginPath(); g.arc(x, hy - 1.2, 3.6, Math.PI, 0); g.fill(); K.rr(hc, x - 4.4, hy - 1.5, 8.8, 1.1, 0.5); K.rect('rgba(255,255,255,.35)', x - 0.4, hy - 4.6, 0.8, 3); }
      else if (look.head === 'cap') { g.fillStyle = hc; g.beginPath(); g.arc(x, hy - 1, 3.4, Math.PI, 0); g.fill(); K.rr(hc, x - 0.5 + (s.dir || 1) * 1.5, hy - 1.6, 4.5, 1, 0.5); }
      else if (look.head === 'beanie') { g.fillStyle = hc; g.beginPath(); g.arc(x, hy - 1, 3.5, Math.PI, 0); g.fill(); K.rect('rgba(0,0,0,.15)', x - 3.5, hy - 1.6, 7, 0.8); }
      else if (look.head === 'headset') { g.strokeStyle = hc; g.lineWidth = 0.5; g.beginPath(); g.arc(x, hy - 0.4, 3.7, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); K.rr(hc, x - 4.2, hy - 0.6, 1.2, 2, 0.5); K.line(hc, 0.3, x - 3.6, hy + 1.2, x - 1.5, hy + 2.3); }
      else if (look.head === 'helmet') {
        g.fillStyle = 'rgba(200,230,255,.28)'; g.beginPath(); g.arc(x, hy, 4.6, 0, Math.PI * 2); g.fill();
        g.strokeStyle = hc; g.lineWidth = 0.6; g.stroke();
        K.rect('rgba(255,255,255,.45)', x - 2.6, hy - 3.2, 1.6, 0.6);
      }
      if (look.after) look.after(x, tp, hy);
    },
  };

  window.CubicleKit = K;
})();
