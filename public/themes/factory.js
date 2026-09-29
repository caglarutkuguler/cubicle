// Cubicle theme: Factory (HD). A production line on the back wall whose robot arms work
// while agents work, an andon light tower that shows the office state (green: working,
// amber: someone needs you, red: error), control consoles, coveralls and hard hats.
(() => {
  const K = window.CubicleKit, T = K.T;
  let line = 'auto';                 // what the line produces: 'auto' (car bodies) or 'food' (bottles)

  function robotArm(c, x, y, phase, busy) {
    const a = busy ? Math.sin(c.t * 2.2 + phase) * 0.7 : 0.25, b = busy ? Math.cos(c.t * 2.2 + phase) * 0.6 - 0.6 : -1.1;
    K.rr('#3b4247', x - 4, y - 2, 8, 3, 0.8);                               // base
    const x1 = x + Math.sin(a) * 8, y1 = y - 2 - Math.cos(a) * 8;
    const x2 = x1 + Math.sin(a + b) * 7, y2 = y1 - Math.cos(a + b) * 7;
    K.line('#f07b1a', 2.2, x, y - 2, x1, y1); K.line('#f07b1a', 1.8, x1, y1, x2, y2);
    K.circle('#2b2f36', x, y - 2, 1.4); K.circle('#2b2f36', x1, y1, 1.2);
    K.rr('#2b2f36', x2 - 1.4, y2 - 0.6, 2.8, 2, 0.4);
    if (busy && Math.floor(c.t * 6 + phase) % 5 === 0) K.glow(x2, y2 + 1.5, 4, 'rgba(255,220,120,.7)');   // weld spark
  }

  function drawRoom(c) {
    K.begin(c);
    // epoxy floor: grey work area with green walkways, break area behind the line
    K.rect('#7d8a86', 0, 2 * T, c.CW, c.CH - 2 * T);
    K.floor(c, { work: ['#7f8c88', '#7a8783'], lounge: ['#6f8b7c', '#6a8677'], grout: 'rgba(0,0,0,.06)', tile: 16 });
    K.rect('#e6b422', 0, 2 * T + 0.5, 14 * T, 0.9);
    for (const y of [6.3, 9.8]) K.rect('rgba(230,180,34,.55)', 0, y * T, 14 * T, 0.7);
    // wall with pipes and the line
    K.rect(K.vgrad(0, 0, 2 * T, '#56646b', '#46535a'), 0, 0, c.CW, 2 * T);
    K.rect('#8d939b', 0, 2.5, c.CW, 1.6); K.rect('#b3262f', 0, 5, c.CW, 1.2);
    for (let x = 12; x < c.CW; x += 40) K.rect('#6f777e', x, 1.8, 2.4, 5);
    const n = K.counts(c), busy = n.running > 0;
    const cy = 2 * T - 6;
    K.rect('#2b3136', 0.6 * T, cy, 12.6 * T, 3.5); K.rect('#5f686e', 0.6 * T, cy - 0.8, 12.6 * T, 1);
    const speed = busy ? 3 + n.running : 0;
    K.clip(0.6 * T, cy - 12, 12.6 * T, 12, () => {
      for (let i = 0; i < 7; i++) {
        const px = 0.6 * T + ((c.t * speed + i * 30) % (12.6 * T + 20)) - 14;
        if (line === 'food') {
          for (let k = 0; k < 3; k++) { K.rr('rgba(120,200,120,.85)', px + k * 4, cy - 7, 2.6, 7, 0.8); K.rect('#e05d5d', px + k * 4 + 0.6, cy - 8.2, 1.4, 1.4); }
        } else {
          K.rr('#c8ccd2', px, cy - 6, 14, 5.4, 1.5); K.rr('#aab0b7', px + 3, cy - 9, 7, 4, 1.4);
          K.rect('rgba(40,60,80,.6)', px + 4, cy - 8.3, 2.5, 2.4); K.rect('rgba(40,60,80,.6)', px + 7, cy - 8.3, 2.5, 2.4);
        }
      }
    });
    [2.6, 6.2, 9.8].forEach((ax, i) => robotArm(c, ax * T, cy - 0.5, i * 1.7, busy));
    // andon light tower
    const ax = 13.6 * T, ay = 3;
    K.rect('#2b2f36', ax + 1.4, ay + 17, 1.2, 8);
    [['#ff3b3b', n.error > 0], ['#ffc34a', n.waiting > 0], ['#3bdc6a', n.running > 0]].forEach(([col, on], i) => {
      const blink = i < 2 ? Math.floor(c.t * 2) % 2 : 1;
      K.rr(on && blink ? col : 'rgba(80,80,80,.9)', ax, ay + i * 5.5, 4, 5, 0.8);
      if (on && blink) K.glow(ax + 2, ay + 2.5 + i * 5.5, 7, col.replace('#ff3b3b', 'rgba(255,59,59,.45)').replace('#ffc34a', 'rgba(255,195,74,.45)').replace('#3bdc6a', 'rgba(59,220,106,.35)'));
    });
    // shift board in the break area
    K.rr('#1f2428', 16 * T, 4, 3.2 * T, 20, 1);
    K.text('SHIFT', 16 * T + 4, 8, { size: 3, color: '#8fe3ff' });
    K.text(`${K.pad(n.running)} RUN`, 16 * T + 4, 13, { size: 3, color: '#3bdc6a', font: 'ui-monospace, Menlo, monospace' });
    K.text(`${K.pad(n.waiting)} HOLD`, 16 * T + 4, 17.5, { size: 3, color: '#ffc34a', font: 'ui-monospace, Menlo, monospace' });
    K.text(`${K.pad(n.error)} STOP`, 16 * T + 4, 22, { size: 3, color: '#ff5a5a', font: 'ui-monospace, Menlo, monospace' });
    K.clock(c, 20 * T, 7, { label: 'SHIFT' });
    K.partition(c, { glass: 'rgba(230,180,34,.14)', frame: '#3b4247' });
  }

  function props(c, list) {
    K.begin(c);
    const H = c.CH / T;
    list.push({ z: 3.8 * T, f: () => {                 // tool cabinet
      const x = 15.4 * T, y = 2.2 * T;
      K.rr('#b3262f', x, y, 26, 24, 1);
      for (let i = 0; i < 5; i++) { K.rect('rgba(0,0,0,.25)', x + 1, y + 2 + i * 4.4, 24, 0.5); K.rect('#d9dde2', x + 11, y + 3.6 + i * 4.4, 4, 0.8); }
    } });
    list.push({ z: 3.8 * T, f: () => {                 // lockers
      for (let i = 0; i < 4; i++) {
        const x = 18 * T + i * 11;
        K.rr(K.vgrad(x, 2.2 * T, 24, '#6f8b9a', '#58717f'), x, 2.2 * T, 10.4, 24, 0.8);
        K.rect('rgba(0,0,0,.25)', x + 1.5, 2.2 * T + 3, 7.4, 0.5); K.rect('#c9ced4', x + 8, 2.2 * T + 10, 0.8, 3);
      }
    } });
    list.push({ z: 9.2 * T, f: () => {
      K.table(16.4 * T, 7.4 * T, 4.2 * T, 1.6 * T, { top: '#d9dde2', edge: '#8d939b', chairs: '#2f5da8', chairCount: 4 });
      K.rr('#f2efe8', 17 * T, 7.4 * T + 8, 3, 3.5, 0.6); K.rr('#57b86b', 19.5 * T, 7.4 * T + 6, 5, 4, 0.6);
    } });
    list.push({ z: (H - 0.5) * T, f: () => {            // first aid and extinguisher
      const x = 21.2 * T, y = (H - 2.3) * T;
      K.rr('#f4f4f4', x, y, 10, 8, 1); K.rect('#3bb26a', x + 4, y + 1.5, 2, 5); K.rect('#3bb26a', x + 2, y + 3, 6, 2);
      K.rr('#d62b2b', x + 2, y + 12, 5, 13, 1.8); K.rect('#1c1c1c', x + 3, y + 10.5, 3, 2);
    } });
    list.push({ z: (H - 0.3) * T, f: () => K.waterCooler(15.4 * T, (H - 2) * T) });
  }

  function drawDesk(c, d, s) {
    K.begin(c);
    const x = d[0] * T, y = d[1] * T;
    K.desk(c, d, s, {
      top: ['#8d98a0', '#6f7a82'], front: '#4a555c', legs: '#3b4247', chair: '#2b3136',
      screens: 1, on: '#a6f3ff', lines: '#0d3a4a', bezel: '#22282c', mug: null, keyboard: '#2b3136',
      extra: () => {                                   // control buttons
        const run = s && s.typing, stop = s && s.status === 'error';
        K.circle(run ? '#3bdc6a' : '#1f5a33', x + 23, y + 13.8, 1); K.circle(stop ? '#ff3b3b' : '#5a1f1f', x + 26.5, y + 13.8, 1);
        K.rr('#e6b422', x + 29.5, y + 12.6, 3, 2.4, 0.6); K.circle('#d62b2b', x + 31, y + 13.8, 0.9);
      },
    });
  }

  function drawChar(c, s) {
    K.begin(c);
    const lead = K.senior(s);
    const coverall = lead ? '#e8e8e8' : K.pick(s, 'cov', ['#2f5da8', '#3a4a66', '#2f5da8', '#5a6068']);
    K.person(c, s, {
      top: coverall, bottom: coverall, shoes: '#1c1c1c', tag: true,
      hair: K.pick(s, 'hair', ['short', 'short', 'pony', 'bun', 'bald', 'curly']),
      head: 'hardhat', headColor: lead ? '#f4f4f4' : K.pick(s, 'hat', ['#f2c230', '#f2c230', '#2f6fd6', '#3bb26a']),
      glasses: 'rgba(200,230,255,.9)',
      vest: lead ? null : (K.rand(s, 'vest') < 0.3 ? { color: '#ff7a1a', stripe: '#e8e8e8' } : null),
    });
  }

  window.CubicleThemes.register({
    id: 'factory', name: { en: 'Factory (HD)', tr: 'Fabrika (HD)' }, scale: 4, smooth: true,
    logoSpot: [15.05 * T, 4, 20, 18],
    setup(opts) { line = opts.line === 'food' ? 'food' : 'auto'; },
    drawRoom, props, drawDesk, drawChar,
  });
})();
