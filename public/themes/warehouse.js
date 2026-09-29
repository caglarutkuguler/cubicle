// Cubicle theme: Warehouse (HD). Corrugated walls, loading-bay doors, a conveyor that runs
// faster the more agents are working, pallet racks and a forklift by the break area,
// hi-vis vests and hard hats.
(() => {
  const K = window.CubicleKit, T = K.T;

  function drawRoom(c) {
    K.begin(c);
    K.concrete(c, 0, c.CW, '#9a9890');
    K.rect('#8e8c84', 15 * T, 2 * T, 7 * T, c.CH - 2 * T);                   // break area, painted
    // yellow lane lines and a hatched walkway at the doorway
    K.rect('#e6b422', 0, 2 * T + 1.5, 14 * T, 0.9);
    K.rect('#e6b422', 0.3 * T, 2 * T, 0.9, c.CH - 2 * T);
    K.clip(14 * T + 11, 2 * T, 5, c.CH - 2 * T, () => {
      for (let y = 2 * T - 8; y < c.CH; y += 6) K.poly((y / 6) % 2 ? '#1c1c1c' : '#e6b422', [[14 * T + 11, y], [14 * T + 16, y + 3], [14 * T + 16, y + 6], [14 * T + 11, y + 3]]);
    });
    // corrugated wall
    K.rect(K.vgrad(0, 0, 2 * T, '#7d8a93', '#66737c'), 0, 0, c.CW, 2 * T);
    for (let x = 0; x < c.CW; x += 2.4) K.rect('rgba(0,0,0,.12)', x, 0, 0.8, 2 * T);
    K.rect('#3b4247', 0, 2 * T - 3, c.CW, 3);
    // loading bay doors with numbers; one is half open and shows daylight
    [[1.2, '1'], [5.2, '2'], [16.4, '3']].forEach(([dx, n], i) => {
      const x = dx * T, y = 3, w = 2.6 * T, h = 2 * T - 6;
      K.rect('#2b3136', x - 1.5, y - 1.5, w + 3, h + 1.5);
      const open = i === 1 ? 0.35 + 0.1 * Math.sin(c.t * 0.3) : 0;
      if (open) K.rect(K.sky(c, x, y + h * (1 - open), h * open), x, y + h * (1 - open), w, h * open);
      K.clip(x, y, w, h * (1 - open), () => {
        K.rect('#b8bfc5', x, y, w, h);
        for (let yy = y; yy < y + h; yy += 1.6) K.rect('rgba(0,0,0,.14)', x, yy, w, 0.4);
      });
      K.rr('#e6b422', x + w / 2 - 3, y - 1.2, 6, 4, 0.6);
      K.text(n, x + w / 2, y + 0.8, { size: 3.4, weight: 800, color: '#1c1c1c', align: 'center' });
    });
    // conveyor along the wall: boxes move faster with more agents working
    const n = K.counts(c), speed = 2 + n.running * 3;
    const cy = 2 * T - 9;
    K.rect('#2b3136', 9.6 * T, cy + 3, 4.2 * T, 3); K.rect('#50595f', 9.6 * T, cy + 2.2, 4.2 * T, 1);
    for (let x = 9.6 * T; x < 13.8 * T; x += 3) K.circle('#1c1f22', x + ((c.t * speed) % 3), cy + 4.5, 0.6);
    K.clip(9.6 * T, cy - 6, 4.2 * T, 9, () => {
      for (let i = 0; i < 5; i++) {
        const bx = 9.6 * T + ((c.t * speed + i * 14) % (4.2 * T + 8)) - 6;
        K.rr('#c29a62', bx, cy - 3.5, 6, 5.6, 0.5); K.rect('rgba(0,0,0,.18)', bx + 2.6, cy - 3.5, 0.8, 5.6);
      }
    });
    K.partition(c, { glass: 'rgba(230,180,34,.12)', frame: '#3b4247' });
  }

  function rack(x, y, w, h) {
    K.rect('#2f5da8', x, y, 1.2, h); K.rect('#2f5da8', x + w - 1.2, y, 1.2, h);
    for (let l = 0; l < 3; l++) {
      const ly = y + 2 + l * (h - 2) / 3;
      K.rect('#e07a22', x, ly + (h - 2) / 3 - 1.4, w, 1.4);
      for (let b = 0; b < Math.floor((w - 3) / 7); b++) {
        const hh = K.hash(`${x}${l}${b}`);
        if (hh % 5 === 0) continue;
        const bw = 5.5, bh = 4 + hh % 3;
        K.rr(hh % 3 ? '#c29a62' : '#b0885a', x + 1.8 + b * 7, ly + (h - 2) / 3 - 1.4 - bh, bw, bh, 0.4);
        K.rect('#e8e0cc', x + 3 + b * 7, ly + (h - 2) / 3 - 1.4 - bh + 1, 2.2, 1.2);
      }
    }
  }

  function props(c, list) {
    K.begin(c);
    const H = c.CH / T;
    list.push({ z: 3.8 * T, f: () => rack(15.5 * T, 2.1 * T, 3.6 * T, 26) });
    list.push({ z: 3.8 * T, f: () => {                 // vending machine
      const x = 20.2 * T, y = 2.1 * T;
      K.rr('#b3262f', x, y, 16, 26, 1); K.rect('#1d2a38', x + 2, y + 2, 9, 16);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) K.rect(['#e6b422', '#57b86b', '#4f9dde', '#f2f2f0'][(r + k) % 4], x + 3 + k * 2.8, y + 3.5 + r * 3.8, 1.8, 2.2);
      K.rect('#f2f2f0', x + 12, y + 5, 2.5, 5); K.rect('#111', x + 3, y + 20.5, 8, 2.5);
    } });
    list.push({ z: 9.3 * T, f: () => {                 // break table with benches
      const x = 16.4 * T, y = 7.8 * T;
      K.rect('#6b4a2e', x, y - 5, 4 * T, 2.5);
      K.shadow(() => K.rr('#8a6440', x, y, 4 * T, 12, 1));
      K.rect('#6b4a2e', x, y + 16, 4 * T, 2.5);
      K.rr('#f2efe8', x + 10, y + 3, 3, 3.5, 0.6); K.rr('#e05d5d', x + 40, y + 5, 3, 3.5, 0.6);
    } });
    list.push({ z: (H - 0.2) * T, f: () => {            // forklift, parked
      const x = 18.6 * T, y = (H - 2.2) * T;
      K.rect('#2b2f36', x - 2, y + 2, 1.2, 22); K.rect('#2b2f36', x + 1, y + 2, 1.2, 22);    // mast
      K.rect('#8d939b', x - 8, y + 21, 10, 1.2);                                                // forks
      K.rr('#e6b422', x + 2, y + 10, 20, 12, 2); K.rr('#e6b422', x + 6, y + 2, 12, 9, 1.5);
      K.rect('rgba(160,210,255,.45)', x + 8, y + 3.5, 8, 6);
      K.rr('#2b2f36', x + 15, y + 12, 7, 6, 1);                                                 // counterweight
      K.circle('#1c1c1c', x + 6, y + 23, 3.2); K.circle('#1c1c1c', x + 18, y + 23, 3.2);
      K.circle('#8d939b', x + 6, y + 23, 1.1); K.circle('#8d939b', x + 18, y + 23, 1.1);
    } });
    list.push({ z: (H - 0.3) * T, f: () => {            // stacked pallets
      const x = 15.4 * T, y = (H - 1.2) * T;
      for (let i = 0; i < 4; i++) { K.rect('#b08a58', x, y + i * 3, 22, 1.6); K.rect('#8a6a40', x + 1, y + i * 3 + 1.6, 2, 1.4); K.rect('#8a6a40', x + 10, y + i * 3 + 1.6, 2, 1.4); K.rect('#8a6a40', x + 19, y + i * 3 + 1.6, 2, 1.4); }
    } });
  }

  function drawDesk(c, d, s) {
    K.begin(c);
    K.desk(c, d, s, {
      top: ['#aeb5bb', '#8d949a'], front: '#5a6268', legs: '#3b4247', chair: '#2b2f36',
      screens: 1, on: '#b8ffcf', lines: '#1a4a2a', bezel: '#1c1f22', mug: null, keyboard: '#2b2f36',
      extra: (x, y) => {
        K.rr('#c29a62', x + 27, y + 4.5, 6.5, 5.5, 0.4); K.rect('rgba(0,0,0,.18)', x + 29.9, y + 4.5, 0.8, 5.5);   // parcel
        K.rr('#2b2f36', x + 22, y + 11.5, 3, 1.2, 0.4);                                                           // scanner
        if (s && s.typing && Math.floor(c.t * 3) % 3 === 0) K.rect('rgba(255,40,40,.8)', x + 24.8, y + 11.8, 3, 0.4);
      },
    });
  }

  function drawChar(c, s) {
    K.begin(c);
    const lead = K.senior(s);
    K.person(c, s, {
      top: s.shirt, bottom: K.pick(s, 'pants', ['#2f3440', '#3a4a66', '#4a3f35']), shoes: '#3a2a1c',
      vest: { color: lead ? '#e6e61e' : K.pick(s, 'vest', ['#ff7a1a', '#e6e61e', '#ff7a1a']), stripe: '#e8e8e8' },
      hair: K.pick(s, 'hair', ['short', 'short', 'pony', 'bun', 'curly', 'bald']),
      head: K.rand(s, 'hat') < 0.55 ? 'hardhat' : K.rand(s, 'cap') < 0.5 ? 'cap' : 'beanie',
      headColor: lead ? '#f4f4f4' : K.pick(s, 'hatc', ['#f2c230', '#f2c230', '#2f6fd6', '#e05d5d']),
    });
  }

  window.CubicleThemes.register({
    id: 'warehouse', name: { en: 'Warehouse (HD)', tr: 'Depo (HD)' }, scale: 4, smooth: true,
    logoSpot: [10.7 * T, 2, 26, 14],
    drawRoom, props, drawDesk, drawChar,
  });
})();
