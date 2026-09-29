// Cubicle theme: Military (HD).
// Procedural, like everything in Cubicle: no image files, drawn on a 4× canvas with smooth
// shapes. Four branches (land, air, naval, joint) change the room, the view outside, the
// main display and the uniforms. Insignia are generic (stars for command roles, chevrons
// for everyone else); no real emblems, flags or unit markings are used.
(() => {
  const T = 16;

  const BRANCH = {
    land: {
      wall: ['#63683f', '#50552f'], trim: '#3a3e22', floor: ['#77766a', '#6f6e62'], lounge: ['#6a6450', '#645e4a'],
      accent: '#d9c86a', screen: '#7cff9b', uniform: '#5d6b39', uniform2: '#46512a', camo: ['#3f4a24', '#7b7a4a', '#2f3520'],
      pants: '#4d5a2e', boots: '#2b2a22', head: 'beret', headColor: '#2f3b1f',
    },
    air: {
      wall: ['#566d88', '#465a73'], trim: '#34445a', floor: ['#8a9099', '#838a93'], lounge: ['#6e7888', '#687282'],
      accent: '#ffd23f', screen: '#8fe3ff', uniform: '#4f6f9c', uniform2: '#41608a', camo: null,
      pants: '#46638e', boots: '#1f2430', head: 'garrison', headColor: '#2f4868',
    },
    naval: {
      wall: ['#5a6b78', '#4a5a66'], trim: '#34414b', floor: ['#6f7d86', '#687780'], lounge: ['#55636d', '#505e68'],
      accent: '#f2f5f7', screen: '#7dffd8', uniform: '#22385a', uniform2: '#1b2e4b', camo: null,
      pants: '#1f3354', boots: '#15171c', head: 'cover', headColor: '#f4f6f8',
    },
    joint: {
      wall: ['#3b414b', '#30353e'], trim: '#23272e', floor: ['#3f4450', '#3a3f4a'], lounge: ['#474452', '#423f4c'],
      accent: '#9fd3ff', screen: '#9fd3ff',
    },
  };
  const SERVICES = ['land', 'air', 'naval'];

  let branch = 'land';
  const P = () => BRANCH[branch];

  // ---------- drawing helpers (office pixels; the canvas is 4× sharper) ----------
  let g;
  const fill = (c) => { g.fillStyle = c; };
  const rect = (c, x, y, w, h) => { fill(c); g.fillRect(x, y, w, h); };
  function rr(c, x, y, w, h, r) {
    fill(c); g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
  }
  function circle(c, x, y, r) { fill(c); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function vgrad(x, y, h, a, b) { const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; }
  function star(c, x, y, r) {
    fill(c); g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.45 : r;
      g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
    }
    g.closePath(); g.fill();
  }
  const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- room ----------
  function drawFloor(c) {
    const p = P(), H = c.CH / T;
    // work area
    for (let y = 2; y < H; y++) for (let x = 0; x < 15; x++) rect((x + y) % 2 ? p.floor[0] : p.floor[1], x * T, y * T, T, T);
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 0.25;
    for (let y = 2; y <= H; y++) { g.beginPath(); g.moveTo(0, y * T); g.lineTo(15 * T, y * T); g.stroke(); }
    for (let x = 0; x <= 15; x++) { g.beginPath(); g.moveTo(x * T, 2 * T); g.lineTo(x * T, c.CH); g.stroke(); }
    if (branch === 'naval') {       // deck plates: rivets at the corners
      fill('rgba(255,255,255,.18)');
      for (let y = 2; y < H; y++) for (let x = 0; x < 15; x++) for (const [ox, oy] of [[1.2, 1.2], [14.8, 1.2], [1.2, 14.8], [14.8, 14.8]]) {
        g.beginPath(); g.arc(x * T + ox, y * T + oy, 0.45, 0, Math.PI * 2); g.fill();
      }
    }
    if (branch === 'air') {         // safety line on the lounge side of the partition
      const x0 = 14 * T + 11, w = 5;
      g.save(); g.beginPath(); g.rect(x0, 2 * T, w, c.CH - 2 * T); g.clip();
      for (let y = 2 * T - 8; y < c.CH; y += 6) { fill(y / 6 % 2 ? '#1c1c1c' : p.accent); g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y + 3); g.lineTo(x0 + w, y + 6); g.lineTo(x0, y + 3); g.fill(); }
      g.restore();
    }
    // briefing room
    for (let y = 2; y < H; y++) for (let x = 15; x < 22; x++) rect((x + y) % 2 ? p.lounge[0] : p.lounge[1], x * T, y * T, T, T);
  }

  function drawWall(c) {
    const p = P();
    rect(vgrad(0, 0, 2 * T, p.wall[0], p.wall[1]), 0, 0, c.CW, 2 * T);
    rect(p.trim, 0, 2 * T - 2.5, c.CW, 2.5);
    rect('rgba(255,255,255,.08)', 0, 2 * T - 2.5, c.CW, 0.5);
    if (branch === 'naval') {       // bulkhead rivets
      fill('rgba(0,0,0,.25)');
      for (let x = 4; x < c.CW; x += 8) { g.beginPath(); g.arc(x, 2.5, 0.6, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x, 2 * T - 4.5, 0.6, 0, Math.PI * 2); g.fill(); }
    }
  }

  // The view outside, one per branch.
  function sky(c, x, y, w, h) {
    return c.night ? vgrad(x, y, h, '#0b1426', '#1d2c4a') : vgrad(x, y, h, '#6fb3ea', '#bfe2ff');
  }
  function windowLand(c, x, y) {
    const w = 32, h = 16;
    rect(sky(c, x, y, w, h), x, y, w, h);
    fill(c.night ? '#1b2a1b' : '#6d8c4c'); g.beginPath(); g.moveTo(x, y + 11);
    for (let i = 0; i <= 8; i++) g.lineTo(x + i * 4, y + 10 + Math.sin(i * 1.3 + x) * 1.6);
    g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.fill();
    fill(c.night ? '#223322' : '#557336'); g.beginPath(); g.moveTo(x, y + 13);
    for (let i = 0; i <= 8; i++) g.lineTo(x + i * 4, y + 12.5 + Math.cos(i * 1.7 + x) * 1.2);
    g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.fill();
    if (c.night) circle('#f5f1c8', x + 25, y + 4, 1.4);
  }
  function windowAir(c, x, y, idx) {
    const w = 32, h = 16;
    rect(sky(c, x, y, w, h), x, y, w, h);
    rect(c.night ? '#20242c' : '#7b7f86', x, y + 11, w, 5);                     // tarmac
    fill(c.night ? '#ffe28a' : '#f4f4f4');
    for (let i = 0; i < 5; i++) g.fillRect(x + 1 + i * 7, y + 13.3, 3.2, 0.5);    // centre line
    // a jet crosses the windows every 24 s, climbing
    const cyc = (c.t % 24) / 24, span = 4 * 40;
    const jx = -10 + cyc * span - idx * 40, jy = 10 - cyc * 7;
    if (jx > -6 && jx < w + 6) {
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      fill(c.night ? '#c9d3e6' : '#39414d');
      g.beginPath(); g.moveTo(x + jx + 6, y + jy); g.lineTo(x + jx - 3, y + jy - 1.2); g.lineTo(x + jx - 5, y + jy + 0.8); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x + jx + 1, y + jy); g.lineTo(x + jx - 2, y + jy + 3); g.lineTo(x + jx - 3.2, y + jy + 0.6); g.fill();
      g.restore();
    }
  }
  function porthole(c, x, y) {
    const cx = x + 16, cy = y + 8, r = 7;
    circle('#b8893b', cx, cy, r + 1.6); circle('#7a5a25', cx, cy, r + 0.6);
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    rect(sky(c, cx - r, cy - r, 2 * r, 2 * r), cx - r, cy - r, 2 * r, 2 * r);
    fill(c.night ? '#0e2340' : '#2f6fa6'); g.beginPath(); g.moveTo(cx - r, cy + 1);
    for (let i = 0; i <= 14; i++) g.lineTo(cx - r + i, cy + 1 + Math.sin(c.t * 1.6 + i * 0.8) * 0.6);
    g.lineTo(cx + r, cy + r); g.lineTo(cx - r, cy + r); g.fill();
    rect('rgba(255,255,255,.18)', cx - r, cy - r, 2 * r, 2);
    g.restore();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; circle('#e0b25a', cx + Math.cos(a) * (r + 1.1), cy + Math.sin(a) * (r + 1.1), 0.35); }
  }

  // The main display on the wall, one per branch.
  function displayFrame(x, y, w, h) { rr('#1b1f24', x - 1.2, y - 1.2, w + 2.4, h + 2.4, 1.5); rect('#05090c', x, y, w, h); }
  function mapDisplay(c, x, y, w, h) {
    displayFrame(x, y, w, h);
    rect('#243a1f', x, y, w, h);
    g.strokeStyle = 'rgba(160,220,120,.35)'; g.lineWidth = 0.3;
    for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x + w * 0.35, y + h * 0.55, 3 + k * 3, 2 + k * 2, 0.3, 0, Math.PI * 2); g.stroke(); }
    g.strokeStyle = 'rgba(160,220,120,.18)';
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(x + i * w / 6, y); g.lineTo(x + i * w / 6, y + h); g.stroke(); }
    for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(x, y + i * h / 3); g.lineTo(x + w, y + i * h / 3); g.stroke(); }
    // one marker per agent at work, blinking gently
    let n = 0;
    for (const s of c.sprites.values()) {
      if (s.status !== 'running' && s.status !== 'waiting') continue;
      const hh = hash(s.id), mx = x + 2 + (hh % 1000) / 1000 * (w - 4), my = y + 2 + ((hh >>> 10) % 1000) / 1000 * (h - 4);
      const on = (Math.floor(c.t * 2) + n++) % 4;
      fill(s.status === 'waiting' ? '#ffd23f' : '#5fa8ff'); g.globalAlpha = on ? 1 : 0.4;
      g.beginPath(); g.moveTo(mx, my - 1.4); g.lineTo(mx + 1.4, my); g.lineTo(mx, my + 1.4); g.lineTo(mx - 1.4, my); g.fill();
      g.globalAlpha = 1;
    }
  }
  function scope(c, x, y, w, h, kind) {
    displayFrame(x, y, w, h);
    const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2 - 1;
    const col = kind === 'sonar' ? '125,255,190' : '120,255,150';
    circle(kind === 'sonar' ? '#022016' : '#03170a', cx, cy, r);
    g.strokeStyle = `rgba(${col},.35)`; g.lineWidth = 0.3;
    for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(cx, cy, r * k / 3, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
    const sweep = (c.t * (kind === 'sonar' ? 0.8 : 1.4)) % (Math.PI * 2);
    if (kind === 'sonar') {
      const ring = ((c.t % 3) / 3) * r;
      g.strokeStyle = `rgba(${col},${0.8 - ring / r * 0.8})`; g.lineWidth = 0.5;
      g.beginPath(); g.arc(cx, cy, ring, 0, Math.PI * 2); g.stroke();
    } else {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(${col},.05)`); gr.addColorStop(1, `rgba(${col},.45)`);
      fill(gr); g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, sweep - 0.7, sweep); g.closePath(); g.fill();
    }
    // a blip per agent at work; it glows after the sweep passes it
    for (const s of c.sprites.values()) {
      if (s.status !== 'running' && s.status !== 'waiting') continue;
      const hh = hash(s.id), a = (hh % 628) / 100, d = r * (0.25 + ((hh >>> 12) % 70) / 100);
      const since = ((sweep - a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const alpha = kind === 'sonar' ? 0.5 + 0.5 * Math.sin(c.t * 2 + a) : Math.max(0.15, 1 - since / 3);
      g.globalAlpha = alpha;
      circle(s.status === 'waiting' ? '#ffd23f' : `rgb(${col})`, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.9);
      g.globalAlpha = 1;
    }
  }
  function statusBars(c, x, y, w, h) {
    displayFrame(x, y, w, h);
    const all = [...c.sprites.values()];
    const count = (st) => all.filter((s) => s.status === st).length;
    const rows = [['#5fa8ff', count('running')], ['#ffd23f', count('waiting') + all.filter((s) => s.ask && s.status !== 'waiting').length], ['#ff5a5a', count('error')], ['#9aa0b4', count('idle') + count('paused')]];
    const max = Math.max(1, all.length);
    rows.forEach(([col, n], i) => {
      const by = y + 1.5 + i * (h - 2) / 4;
      rect('rgba(255,255,255,.07)', x + 1.5, by, w - 3, (h - 2) / 4 - 1.2);
      rect(col, x + 1.5, by, (w - 3) * n / max, (h - 2) / 4 - 1.2);
    });
  }

  function clockText(c, x, y, label, date, utc) {
    const hh = utc ? date.getUTCHours() : date.getHours(), mm = utc ? date.getUTCMinutes() : date.getMinutes();
    rr('#101418', x, y, 15, 9, 1.2);
    fill('#ff6b4a'); g.font = '600 5.4px ui-monospace, "SF Mono", Menlo, Consolas, monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(`${pad(hh)}:${pad(mm)}`, x + 7.5, y + 4.2);
    fill('rgba(255,255,255,.55)'); g.font = '600 2.2px system-ui, sans-serif'; g.fillText(label, x + 7.5, y + 7.6);
    g.textAlign = 'start';
  }

  function beacon(c) {
    if (!c.anyError) return;
    const x = 12 * T + 8, y = 3;
    rect('#2a2a2a', x - 2, y + 5, 4, 1.5);
    const a = c.t * 5;
    const gr = g.createRadialGradient(x, y + 3, 0, x, y + 3, 10);
    gr.addColorStop(0, 'rgba(255,60,60,.55)'); gr.addColorStop(1, 'rgba(255,60,60,0)');
    fill(gr); g.beginPath(); g.moveTo(x, y + 3); g.arc(x, y + 3, 10, a - 0.5, a + 0.5); g.closePath(); g.fill();
    circle('#ff3b3b', x, y + 3, 2.2); circle('rgba(255,255,255,.6)', x - 0.6, y + 2.3, 0.6);
  }

  function drawRoom(c) {
    g = c.g;
    const p = P();
    drawFloor(c);
    drawWall(c);
    const date = new Date();
    if (branch === 'joint') {
      // video wall across the operations room
      mapDisplay(c, 1.2 * T, 5, 3.6 * T, 20);
      scope(c, 5.5 * T, 5, 2.6 * T, 20, 'radar');
      scope(c, 8.6 * T, 5, 2.6 * T, 20, 'sonar');
      statusBars(c, 11.6 * T, 5, 1.1 * T, 20);
      clockText(c, 16.2 * T, 7, 'LOCAL', date, false);
      clockText(c, 17.4 * T, 7, 'UTC', date, true);
    } else {
      const view = branch === 'land' ? windowLand : branch === 'air' ? windowAir : porthole;
      [1.5, 5.5, 16.5].forEach((wx, i) => {
        if (branch !== 'naval') rect(p.trim, wx * T - 1, 5, 34, 18);
        view(c, wx * T, 6, i);
        if (branch !== 'naval') rect(p.trim, wx * T + 15, 6, 2, 16);
      });
      if (branch === 'land') mapDisplay(c, 9.2 * T, 4.5, 2.6 * T, 21);
      else scope(c, 9.2 * T + 5, 4, 1.9 * T, 23, branch === 'air' ? 'radar' : 'sonar');
      clockText(c, 12.7 * T + 1, 8, 'LOCAL', date, false);
    }
    beacon(c);
    // glass partition with a doorway
    rect('rgba(170,210,255,.16)', 14 * T + 6, 2 * T, 4, 4 * T);
    rect('rgba(170,210,255,.16)', 14 * T + 6, 8 * T, 4, c.CH - 8 * T);
    rect('#2c3036', 14 * T + 6, 2 * T, 4, 1.5); rect('#2c3036', 14 * T + 6, 8 * T, 4, 1.5);
    rect('#2c3036', 14 * T + 6, 6 * T - 1.5, 4, 1.5);
  }

  // Briefing room furniture and the odd prop.
  function props(c, list) {
    g = c.g;
    const p = P(), H = c.CH / T;
    list.push({ z: 3.6 * T, f: () => {       // lockers
      for (let i = 0; i < 6; i++) {
        const x = 15.8 * T + i * 13.3;
        rr(vgrad(x, 2.2 * T, 22, '#6f7780', '#59616a'), x, 2.1 * T, 12.6, 22, 0.8);
        rect('rgba(0,0,0,.25)', x + 1.5, 2.1 * T + 3, 9.6, 0.5); rect('rgba(0,0,0,.25)', x + 1.5, 2.1 * T + 4.5, 9.6, 0.5);
        rect('#c9ced4', x + 10, 2.1 * T + 10, 0.8, 3);
        rect(c.sprites.size > i ? '#3a3f45' : '#4b5159', x + 2.5, 2.1 * T + 16, 3, 1.2);
      }
    } });
    list.push({ z: 3.4 * T, f: () => {       // coffee urn
      const x = 21.2 * T, y = 2.1 * T;
      rr('#2d3035', x, y + 10, 11, 12, 1); rr(vgrad(x + 1, y, 11, '#c8ccd2', '#8d939b'), x + 1.5, y + 1, 8, 10, 2);
      rect('#1c1d20', x + 4.5, y + 11, 2, 2);
      circle(Math.floor(c.t * 2) % 2 ? '#ff5a5a' : '#8a2a2a', x + 8.8, y + 13.5, 0.7);
    } });
    list.push({ z: 8.6 * T, f: () => {       // briefing table with a map on it
      const x = 16.7 * T, y = 6.8 * T, w = 4.2 * T, h = 1.8 * T;
      g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 4; g.shadowOffsetY = 2;
      rr('#4a3727', x, y, w, h, 6); g.restore();
      rr('#5b4430', x + 1, y + 1, w - 2, h - 2, 5);
      rr(branch === 'naval' ? '#2c5c7e' : branch === 'air' ? '#4f6c8e' : '#4f6b3c', x + 8, y + 5, w - 16, h - 10, 2);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 0.35;
      g.beginPath(); g.moveTo(x + 12, y + h - 8); g.bezierCurveTo(x + 22, y + 6, x + 40, y + h - 6, x + w - 12, y + 8); g.stroke();
      circle(p.accent, x + w - 14, y + 9, 1.1);
      for (let i = 0; i < 5; i++) circle('#303338', x + 8 + i * 12, y + h + 2.5, 2.2);     // chairs
    } });
    list.push({ z: (H - 0.5) * T, f: () => {  // filing cabinet
      const x = 0.4 * T, y = (H - 1.9) * T;
      rr(vgrad(x, y, 24, '#737a82', '#5b6168'), x, y, 12, 24, 0.8);
      for (let i = 0; i < 3; i++) { rect('rgba(0,0,0,.25)', x + 1, y + 1 + i * 7.6, 10, 0.5); rect('#c9ced4', x + 4.5, y + 3.5 + i * 7.6, 3, 0.8); }
    } });
    list.push({ z: (H - 0.3) * T, f: () => {  // water cooler
      const x = 21.1 * T, y = (H - 2) * T;
      rr('#d9dde2', x, y + 10, 10, 16, 1.2);
      rr('rgba(120,190,255,.75)', x + 1.5, y, 7, 11, 2.5);
      rect('#5a6068', x + 3, y + 17, 4, 1);
    } });
  }

  // ---------- consoles ----------
  function drawDesk(c, d, s) {
    g = c.g;
    const p = P(), x = d[0] * T, y = d[1] * T, t = c.t;
    const on = s && s.typing, err = s && s.status === 'error' && s.seated, wait = s && s.status === 'waiting' && s.seated;
    // chair back behind the seat
    rr('#23262b', x + 18, y + 3, 9, 7, 2);
    // desk
    g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 3; g.shadowOffsetY = 1.5;
    rr(vgrad(x, y + 8, 10, '#6f757d', '#565c63'), x, y + 8, 34, 10, 1.5);
    g.restore();
    rect('#3d4247', x, y + 16.5, 34, 4.5);
    rect('#2c3034', x + 1.5, y + 21, 2, 6); rect('#2c3034', x + 30.5, y + 21, 2, 6);
    // two monitors
    const screen = err ? (Math.floor(t * 2) % 2 ? '#ff5a5a' : '#8e2222') : wait ? (Math.floor(t) % 2 ? '#ffc34a' : '#a87916') : on ? p.screen : '#1f252b';
    for (const [mx, mw] of [[x + 1.5, 9], [x + 10.5, 9]]) {
      rr('#15181c', mx, y - 3, mw, 9.5, 0.8);
      rect(screen, mx + 0.8, y - 2.2, mw - 1.6, 7.6);
      if (on) {
        g.globalAlpha = 0.9; fill('#0a2a12');
        for (let i = 0; i < 4; i++) g.fillRect(mx + 1.4, y - 1.4 + i * 1.8, ((Math.floor(t * 9 + i * 3 + mx) % 7) + 1), 0.7);
        g.globalAlpha = 1;
      }
      rect('rgba(255,255,255,.12)', mx + 0.8, y - 2.2, mw - 1.6, 1.2);
      rect('#15181c', mx + mw / 2 - 0.8, y + 6.5, 1.6, 2);
    }
    if (on || wait || err) {        // screen glow on the desk
      const gr = g.createRadialGradient(x + 10, y + 9, 0, x + 10, y + 9, 12);
      gr.addColorStop(0, err ? 'rgba(255,80,80,.25)' : wait ? 'rgba(255,200,80,.25)' : 'rgba(140,255,190,.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      fill(gr); g.fillRect(x - 2, y, 26, 18);
    }
    rr('#2b2f34', x + 21, y + 10, 10, 2.4, 0.6);          // keyboard
    if (on) rect('#e6f0f5', x + 21.6 + (Math.floor(t * 12) % 9), y + 10.6, 0.8, 0.8);
    rr('#e8e3d6', x + 31.2, y + 9, 2.2, 3, 0.6);          // mug
  }

  // ---------- people ----------
  const COMMAND = /\b(ceo|chief|command|commander|director|head|lead|general|captain|admiral|manager)\b/i;

  function uniformFor(s) {
    const svc = branch === 'joint' ? SERVICES[hash(s.id) % 3] : branch;
    return BRANCH[svc];
  }

  function drawChar(c, s) {
    g = c.g;
    const u = uniformFor(s), t = c.t;
    const x = s.x, y = s.y;
    const bob = s.walking ? Math.abs(Math.sin(t * 8 + s.seed)) * 0.8 : 0;
    const slump = s.status === 'error' && s.seated ? 1.2 : 0;
    // shadow
    fill('rgba(0,0,0,.25)'); g.beginPath(); g.ellipse(x, y, 4.5, 1.3, 0, 0, Math.PI * 2); g.fill();
    // legs and boots
    if (!s.seated) {
      const sw = s.walking ? Math.sin(t * 8 + s.seed) * 1.6 : 0;
      rr(u.pants, x - 3.2, y - 6.5, 2.6, 6 + sw * 0.3, 0.8);
      rr(u.pants, x + 0.6, y - 6.5, 2.6, 6 - sw * 0.3, 0.8);
      rr(u.boots, x - 3.6 + sw * 0.4, y - 1.4, 3.2, 1.6, 0.6);
      rr(u.boots, x + 0.4 - sw * 0.4, y - 1.4, 3.2, 1.6, 0.6);
    }
    const top = y - 12.5 - bob;
    // torso
    rr(u.uniform, x - 4.3, top, 8.6, 7.2, 2);
    if (u.camo) {                      // camouflage blotches, fixed per person
      g.save(); g.beginPath(); g.rect(x - 4.3, top, 8.6, 7.2); g.clip();
      const hh = hash(s.id);
      for (let i = 0; i < 7; i++) {
        fill(u.camo[i % 3]); g.beginPath();
        g.ellipse(x - 4 + ((hh >>> (i * 3)) % 9), top + ((hh >>> (i * 2 + 5)) % 7), 1.6, 0.9, i, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
    rect(u.uniform2, x - 4.3, top + 5.6, 8.6, 1.2);                       // belt
    rect(s.shirt, x + 0.6, top + 1.6, 3, 1);                              // name tape in the agent's colour
    // insignia on the shoulder
    if (COMMAND.test(s.role || '') || COMMAND.test(s.name || '')) star('#f3d25a', x - 2.8, top + 1.3, 1.1);
    else { const n = 1 + (hash(s.id) >>> 5) % 3; fill('#f3d25a'); for (let i = 0; i < n; i++) g.fillRect(x - 3.9, top + 0.8 + i * 0.8, 2.4, 0.45); }
    // arms and hands
    if (s.typing) {
      const a = Math.floor(t * 10 + s.seed) % 2;
      rr(u.uniform2, x - 5.6, top + 1.5, 2, 4, 1); rr(u.uniform2, x + 3.6, top + 1.5, 2, 4, 1);
      circle(s.skin, x - 4.8, top + 5.8 - a * 0.8, 1.1); circle(s.skin, x + 4.6, top + 5.8 - (1 - a) * 0.8, 1.1);
    } else if (s.status === 'waiting' && s.seated) {
      const w = Math.sin(t * 5 + s.seed) * 0.8;
      rr(u.uniform2, x - 5.6, top + 1.5, 2, 5, 1);
      rr(u.uniform2, x + 3.8 + w * 0.3, top - 5.5, 2, 7.5, 1);
      circle(s.skin, x + 4.8 + w, top - 6.4, 1.2);
    } else {
      rr(u.uniform2, x - 5.6, top + 1.2, 2, 5.5, 1); rr(u.uniform2, x + 3.6, top + 1.2, 2, 5.5, 1);
      circle(s.skin, x - 4.6, top + 7, 1); circle(s.skin, x + 4.6, top + 7, 1);
    }
    // head
    const hy = top - 3.6 + slump;
    rect(s.skin, x - 1, top - 1.2 + slump, 2, 1.6);                          // neck
    if (window.CubicleThemes.photoHead && window.CubicleThemes.photoHead(g, s, x, hy, 4.2)) return;   // a photo instead of the drawn head
    circle(s.skin, x, hy, 3.3);
    fill(s.hair); g.beginPath(); g.arc(x, hy, 3.35, Math.PI * 1.05, Math.PI * 1.95); g.fill();   // hair under the headwear
    const eyes = ((t + s.seed) % 4) >= 0.14;
    if (eyes) { const ox = (s.dir || 0) * 0.8; circle('#15171a', x - 1.2 + ox, hy + 0.4, 0.45); circle('#15171a', x + 1.2 + ox, hy + 0.4, 0.45); }
    // headwear
    if (u.head === 'beret') {
      fill(u.headColor); g.beginPath(); g.ellipse(x - 0.8, hy - 2.6, 3.9, 1.7, -0.25, 0, Math.PI * 2); g.fill();
      circle('#d8c46a', x + 1.8, hy - 2.4, 0.55);
    } else if (u.head === 'garrison') {
      fill(u.headColor); g.beginPath(); g.moveTo(x - 3.3, hy - 1.9); g.lineTo(x + 3.3, hy - 1.9); g.lineTo(x + 2.6, hy - 3.7); g.lineTo(x - 2.8, hy - 3.2); g.closePath(); g.fill();
    } else if (u.head === 'cover') {
      rr(u.headColor, x - 3.6, hy - 3.9, 7.2, 2.2, 1.1);
      rect('#1a1d22', x - 3.6, hy - 1.9, 7.2, 0.7);
    }
  }

  // Red alert: a faint pulsing edge while any agent is in error.
  function overlay(c) {
    if (!c.anyError) return;
    g = c.g;
    const a = 0.08 + 0.06 * Math.sin(c.t * 4);
    const gr = g.createRadialGradient(c.CW / 2, c.CH / 2, Math.min(c.CW, c.CH) * 0.45, c.CW / 2, c.CH / 2, c.CW * 0.65);
    gr.addColorStop(0, 'rgba(255,0,0,0)'); gr.addColorStop(1, `rgba(255,30,30,${a})`);
    fill(gr); g.fillRect(0, 0, c.CW, c.CH);
  }

  window.CubicleThemes.register({
    id: 'military', name: { en: 'Military (HD)', tr: 'Askerî (HD)' }, scale: 4, smooth: true,
    logoSpot: () => (branch === 'joint' ? [19.8 * T, 5, 20, 18] : [7.75 * T, 5, 18, 18]),
    setup(opts) { branch = BRANCH[opts.branch] ? opts.branch : 'land'; },
    drawRoom, props, drawDesk, drawChar, overlay,
  });
})();
