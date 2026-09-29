// Cubicle theme: Holding HQ (HD). Walnut panelling, marble floor, the company name in brass
// on the wall, a boardroom in the lounge and suits for everyone. View: city or sea.
(() => {
  const K = window.CubicleKit, T = K.T;
  let view = 'city';

  function drawRoom(c) {
    K.begin(c);
    const g = K.g;
    // marble in the work area, burgundy carpet in the boardroom
    K.floor(c, { work: ['#e9e4da', '#dcd5c8'], lounge: ['#5b2531', '#55222d'], grout: 'rgba(120,100,80,.18)' });
    g.strokeStyle = 'rgba(216,178,90,.45)'; g.lineWidth = 0.6;              // carpet border
    g.strokeRect(15 * T + 4, 2 * T + 4, 7 * T - 8, c.CH - 2 * T - 8);
    // walnut panelling
    K.wall(c, { top: '#4a2f1f', bottom: '#3a2417', trim: '#2a190f', band: 'rgba(216,178,90,.25)' });
    for (let x = 8; x < c.CW; x += 16) K.rect('rgba(0,0,0,.18)', x, 1, 0.5, 2 * T - 4);
    // windows
    const outside = view === 'sea' ? K.sea : (cc, x, y, w, h) => K.skyline(cc, x, y, w, h, 3);
    for (const wx of [1.2, 4.4, 17.4]) K.window(c, wx * T, 4, 2.6 * T, 20, outside, { frame: '#2a190f', mullions: 1 });
    // the company name in brass, with a board report on a screen next to it
    K.sign(c, 10.5 * T, 14, { color: '#e2bd66', size: 7, max: 5.6 * T, plate: '#2a190f' });
    K.statusBoard(c, 20.6 * T, 5, 1.1 * T, 18, { frame: '#8a6a2e' });
    K.analogClock(c, 15.9 * T, 13, 5, { rim: '#8a6a2e' });
    K.partition(c, { glass: 'rgba(200,220,240,.18)', frame: '#8a6a2e' });
  }

  function props(c, list) {
    K.begin(c);
    const H = c.CH / T;
    list.push({ z: 3.4 * T, f: () => K.shelf(15.6 * T, 2.1 * T, 2.2 * T, 22, { wood: '#4a2f1f' }) });
    list.push({ z: 3.4 * T, f: () => {                 // bar cart
      const x = 20.6 * T, y = 2.4 * T;
      K.rr('#8a6a2e', x, y + 8, 16, 1, 0.5); K.rr('#8a6a2e', x, y + 15, 16, 1, 0.5);
      K.rect('#8a6a2e', x + 1, y + 8, 0.8, 9); K.rect('#8a6a2e', x + 14.2, y + 8, 0.8, 9);
      ['#7a1f1f', '#c9a14a', '#2f5f3a'].forEach((col, i) => { K.rr(col, x + 3 + i * 4, y + 2, 2, 6, 0.8); K.rect(col, x + 3.6 + i * 4, y, 0.8, 2.5); });
    } });
    list.push({ z: 9.2 * T, f: () => {                 // boardroom table, leather chairs
      const x = 16.3 * T, y = 6.9 * T, w = 4.8 * T, h = 1.9 * T;
      for (let i = 0; i < 5; i++) K.rr('#3a2016', x + 6 + i * ((w - 12) / 4) - 3, y - 5, 6, 6, 2);
      K.table(x, y, w, h, { top: '#5a3622', edge: '#3d2415', chairs: '#3a2016', chairCount: 5 });
      K.rect('rgba(255,255,255,.08)', x + 4, y + 2, w - 8, 1);
      for (let i = 0; i < 4; i++) K.rr('#f4f1ea', x + 10 + i * 16, y + 7, 5, 6.5, 0.4);    // papers
      K.rr('#e2bd66', x + w / 2 - 2, y + h / 2 - 2, 4, 4, 2);                             // bowl
    } });
    list.push({ z: (H - 0.4) * T, f: () => K.plant(21.4 * T, (H - 0.3) * T, { size: 1.3, pot: '#2a190f', leaf: '#2f7a45', leaf2: '#3f9a55' }) });
    list.push({ z: (H - 0.4) * T, f: () => K.plant(0.8 * T, (H - 0.3) * T, { size: 1.2, pot: '#2a190f' }) });
    list.push({ z: (H - 0.5) * T, f: () => K.waterCooler(15.4 * T, (H - 2) * T) });
  }

  function drawDesk(c, d, s) {
    K.begin(c);
    K.desk(c, d, s, {
      top: ['#6b4428', '#50311c'], front: '#3d2415', legs: '#2a190f', chair: '#3a2016',
      screens: 1, on: '#cfe3ff', lines: '#23324a', bezel: '#111', mug: null,
      extra: (x, y) => {                              // green banker's lamp at the end of the desk
        K.rect('#8a6a2e', x + 32, y + 5.5, 0.6, 4.5); K.rr('#8a6a2e', x + 30.8, y + 9.4, 3, 1, 0.4);
        K.rr('#1f6b43', x + 30, y + 4, 4.6, 2, 1);
        if (c.night || (s && s.seated)) K.glow(x + 32.3, y + 7.5, 6, 'rgba(255,230,160,.22)');
      },
    });
  }

  const SUITS = ['#1f2a3d', '#2b2f36', '#1c1c20', '#34383f', '#2a3550'];
  const TIES = ['#7a1f2b', '#1f3f7a', '#5a4a1f', '#2f5f3a', '#6b2f6b'];
  function drawChar(c, s) {
    K.begin(c);
    const senior = K.senior(s), skirt = K.rand(s, 'skirt') < 0.45;
    const suit = senior ? '#16161a' : K.pick(s, 'suit', SUITS);
    K.person(c, s, {
      top: suit, bottom: suit, skirt, heels: skirt, shoes: skirt ? K.pick(s, 'heels', ['#1c1c20', '#7a1f2b', '#3a2016']) : '#1a1410',
      inner: '#f4f4f6', tie: skirt ? null : K.pick(s, 'tie', TIES),
      hair: skirt ? K.pick(s, 'hair', ['long', 'bun', 'long', 'pony']) : K.pick(s, 'hair', ['short', 'short', 'bald', 'curly']),
      glasses: K.rand(s, 'glasses') < 0.3 ? '#8a6a2e' : null,
      insignia: senior ? (x, top) => K.rect('#e2bd66', x - 3.4, top + 1.6, 1.6, 0.8) : null,     // pocket square
    });
  }

  window.CubicleThemes.register({
    id: 'holding', name: { en: 'Holding HQ (HD)', tr: 'Holding (HD)' }, scale: 4, smooth: true,
    setup(opts) { view = opts.view === 'sea' ? 'sea' : 'city'; },
    drawRoom, props, drawDesk, drawChar,
  });
})();
