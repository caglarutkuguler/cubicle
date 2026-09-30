// Cubicle theme: Space base (HD). Viewports onto orbit or the surface of Mars, holographic
// consoles, a hydroponics garden in the lounge and mission jumpsuits. Base: orbit or mars.
(() => {
  const K = window.CubicleKit, T = K.T;
  let base = 'orbit';

  function orbitView(c, x, y, w, h) {
    K.starfield(c, x, y, w, h, Math.round(x));
    const px = x + w * 0.7, py = y + h * 1.25, r = h * 0.95;                // planet rim at the bottom
    const gr = K.g.createRadialGradient(px - r * 0.3, py - r * 0.4, r * 0.2, px, py, r);
    gr.addColorStop(0, '#6fb3ea'); gr.addColorStop(0.7, '#2c6aa8'); gr.addColorStop(1, '#0d2a4a');
    K.circle(gr, px, py, r);
    K.g.strokeStyle = 'rgba(140,200,255,.6)'; K.g.lineWidth = 0.6; K.g.beginPath(); K.g.arc(px, py, r + 0.4, Math.PI * 1.05, Math.PI * 1.95); K.g.stroke();
    const sx = x + ((c.t * 1.5 + x) % (w + 10)) - 5;                        // a satellite drifts by
    K.rect('#d9dde2', sx, y + 4, 1.6, 1); K.rect('#4f9dde', sx - 2, y + 4.1, 1.8, 0.8); K.rect('#4f9dde', sx + 1.8, y + 4.1, 1.8, 0.8);
  }
  function marsView(c, x, y, w, h) {
    K.rect(c.night ? K.vgrad(x, y, h, '#1a0f16', '#3a1f24') : K.vgrad(x, y, h, '#d9a07a', '#f0c9a0'), x, y, w, h);
    K.circle(c.night ? '#e8e0cc' : 'rgba(255,245,220,.8)', x + w * 0.2, y + 4, 1.4);
    K.poly(c.night ? '#4a2418' : '#b5562f', [[x, y + h], [x, y + h * 0.62], [x + w * 0.3, y + h * 0.5], [x + w * 0.55, y + h * 0.66], [x + w * 0.8, y + h * 0.45], [x + w, y + h * 0.6], [x + w, y + h]]);
    K.poly(c.night ? '#3a1a12' : '#9a4526', [[x, y + h], [x, y + h * 0.82], [x + w * 0.5, y + h * 0.74], [x + w, y + h * 0.86], [x + w, y + h]]);
    K.rr('#d9dde2', x + w * 0.62, y + h * 0.66, 4, 2.4, 1.2);                          // a rover
    K.circle('#2b2f36', x + w * 0.62 + 1, y + h * 0.66 + 2.6, 0.7); K.circle('#2b2f36', x + w * 0.62 + 3, y + h * 0.66 + 2.6, 0.7);
  }

  function drawRoom(c) {
    K.begin(c);
    // grated metal floor, soft green deck in the garden
    K.floor(c, { work: ['#5a6470', '#56606b'], lounge: ['#4d5a55', '#495650'], grout: 'rgba(0,0,0,.25)', tile: 16 });
    for (let y = 2 * T; y < c.CH; y += T) for (let x = 0; x < 14 * T; x += T) {
      K.rect('rgba(0,0,0,.12)', x + 3, y + 3, T - 6, 0.5); K.rect('rgba(0,0,0,.12)', x + 3, y + T - 3.5, T - 6, 0.5);
    }
    // light strips on the floor edges
    K.rect(`rgba(120,220,255,${0.35 + 0.15 * Math.sin(c.t * 1.5)})`, 0, 2 * T + 0.5, 14 * T, 0.6);
    // white panelled wall with viewports
    K.rect(K.vgrad(0, 0, 2 * T, '#e3e8ee', '#c9d0d8'), 0, 0, c.CW, 2 * T);
    for (let x = 0; x < c.CW; x += 22) K.rect('rgba(0,0,0,.08)', x, 0, 0.5, 2 * T);
    K.rect('#8d97a3', 0, 2 * T - 3, c.CW, 3); K.rect('rgba(120,220,255,.8)', 0, 2 * T - 3, c.CW, 0.5);
    const view = base === 'mars' ? marsView : orbitView;
    for (const wx of [1.2, 4.7, 16.6]) {
      K.rr('#8d97a3', wx * T - 2, 2, 2.6 * T + 4, 24, 5);
      K.clip(wx * T, 4, 2.6 * T, 20, () => view(c, wx * T, 4, 2.6 * T, 20));
      K.rect('rgba(255,255,255,.08)', wx * T, 4, 2.6 * T, 2);
    }
    // mission board: one light per agent at work
    K.rr('#0c1420', 8.4 * T, 4, 4.8 * T, 20, 2);
    K.text(K.say(c, base === 'mars'
      ? { en: 'ARES BASE', tr: 'ARES ÜSSÜ', de: 'ARES-BASIS', es: 'BASE ARES', fr: 'BASE ARÈS', zh: '阿瑞斯基地', ar: 'قاعدة آريس' }
      : { en: 'ORBITAL OPS', tr: 'YÖRÜNGE ÜSSÜ', de: 'ORBITALSTATION', es: 'OPS ORBITALES', fr: 'OPS ORBITALES', zh: '轨道站', ar: 'العمليات المدارية' }), 8.4 * T + 4, 8, { size: 3, color: '#8fe3ff' });
    const all = [...c.sprites.values()];
    all.slice(0, 16).forEach((s, i) => {
      const col = s.status === 'error' ? '#ff5a5a' : (s.status === 'waiting' || s.ask) ? '#ffd23f' : s.status === 'running' ? '#5fe0ff' : '#3a4a5a';
      K.circle(col, 8.4 * T + 6 + (i % 8) * 8.8, 14 + Math.floor(i / 8) * 5, 1.4);
    });
    K.clock(c, 8.4 * T + 4.8 * T - 17, 5.5, { label: K.say(c, 'MET'), utc: true, color: '#8fe3ff', bg: '#0c1420' });
    K.partition(c, { glass: 'rgba(120,220,255,.16)', frame: '#8d97a3' });
  }

  function props(c, list) {
    K.begin(c);
    const H = c.CH / T;
    list.push({ z: 3.8 * T, f: () => {                 // hydroponics racks under grow lights
      for (let r = 0; r < 2; r++) {
        const x = 15.4 * T + r * 2.3 * T, y = 2.2 * T;
        K.rr('#aab4bf', x, y, 2 * T, 24, 1);
        for (let l = 0; l < 3; l++) {
          K.rect('rgba(200,120,255,.55)', x + 1, y + 1 + l * 8, 2 * T - 2, 0.8);
          for (let k = 0; k < 5; k++) K.plant(x + 4 + k * 6, y + 7.5 + l * 8, { size: 0.32, pot: '#e3e8ee', leaf: '#3fbf6a', leaf2: '#7de08f' });
        }
        K.glow(x + T, y + 12, 16, 'rgba(200,120,255,.12)');
      }
    } });
    list.push({ z: 3.8 * T, f: () => {                 // spacesuit on a rack
      const x = 21 * T, y = 2.2 * T;
      K.rr('#f2f2f0', x, y + 7, 9, 12, 2.5); K.rr('#f2f2f0', x + 1.2, y + 18, 3, 7, 1); K.rr('#f2f2f0', x + 4.8, y + 18, 3, 7, 1);
      K.circle('rgba(200,230,255,.5)', x + 4.5, y + 3.5, 4); K.rect('#f07b1a', x + 1, y + 10, 7, 1.2);
    } });
    list.push({ z: 9.2 * T, f: () => {                 // round mess table
      const x = 18.4 * T, y = 8.4 * T;
      K.shadow(() => K.ellipse('#d9dde2', x, y, 2.2 * T, 0.9 * T), 4, 2);
      K.ellipse('#eef2f6', x, y - 0.5, 2.1 * T, 0.8 * T);
      K.ellipse('rgba(120,220,255,.25)', x, y - 0.5, 1.2 * T, 0.4 * T);
      for (let i = 0; i < 5; i++) { const a = Math.PI * (0.1 + i * 0.2); K.circle('#8d97a3', x + Math.cos(a) * 2.5 * T, y + Math.sin(a) * 1.1 * T + 4, 2); }
    } });
    list.push({ z: (H - 0.3) * T, f: () => K.waterCooler(21.2 * T, (H - 2) * T) });
  }

  function drawDesk(c, d, s) {
    K.begin(c);
    const x = d[0] * T, y = d[1] * T;
    K.desk(c, d, s, {
      top: ['#e3e8ee', '#b9c2cc'], front: '#8d97a3', legs: '#5a6470', chair: '#3a4452',
      screens: 2, on: '#5fe0ff', lines: '#003a4a', bezel: '#1c2530', mug: '#f2f2f0', keyboard: '#1c2530',
      extra: () => {                                   // hologram above the desk while working
        if (!(s && s.seated)) return;
        const col = s.status === 'error' ? '255,90,90' : s.status === 'waiting' ? '255,210,63' : '95,224,255';
        const a = 0.25 + 0.1 * Math.sin(c.t * 3);
        K.poly(`rgba(${col},${a * 0.6})`, [[x + 6, y + 8], [x + 14, y + 8], [x + 18, y - 9], [x + 2, y - 9]]);
        K.g.strokeStyle = `rgba(${col},${a + 0.3})`; K.g.lineWidth = 0.35;
        K.g.beginPath(); K.g.ellipse(x + 10, y - 12, 4, 1.6, c.t % Math.PI, 0, Math.PI * 2); K.g.stroke();
        K.g.beginPath(); K.g.ellipse(x + 10, y - 12, 1.6, 4, c.t % Math.PI, 0, Math.PI * 2); K.g.stroke();
      },
    });
  }

  function drawChar(c, s) {
    K.begin(c);
    const lead = K.senior(s);
    const suit = lead ? '#f2f2f0' : K.pick(s, 'suit', ['#f07b1a', '#2f5da8', '#f2f2f0', '#6b7a8f']);
    K.person(c, s, {
      top: suit, bottom: suit, shoes: '#2b2f36',
      hair: K.pick(s, 'hair', ['short', 'bun', 'pony', 'bald', 'curly', 'short']),
      head: s.seated ? 'headset' : null, headColor: '#2b2f36',
      insignia: (x, top) => { K.circle('#0c1420', x + 2.2, top + 2.2, 1.3); K.circle(s.shirt, x + 2.2, top + 2.2, 0.9); if (lead) K.star('#f3d25a', x - 2.4, top + 2, 1); },
    });
  }

  window.CubicleThemes.register({
    id: 'space', name: { en: 'Space base (HD)', tr: 'Uzay üssü (HD)' }, scale: 4, smooth: true,
    logoSpot: [14.95 * T, 5, 20, 18],
    setup(opts) { base = opts.base === 'mars' ? 'mars' : 'orbit'; },
    drawRoom, props, drawDesk, drawChar,
  });
})();
