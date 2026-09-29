// Cubicle theme: Plaza office (HD). A high floor of a glass tower: a window wall across the
// room, white desks, a coffee bar in the lounge, smart-casual clothes. View: city or sea.
(() => {
  const K = window.CubicleKit, T = K.T;
  let view = 'city';

  function drawRoom(c) {
    K.begin(c);
    K.floor(c, { work: ['#c9ccd1', '#c3c6cc'], lounge: ['#c9ccd1', '#c3c6cc'], grout: 'rgba(0,0,0,.05)', tile: 8 });
    K.planks(c, 15 * T, c.CW, ['#c89f6d', '#bd935f']);
    // floor-to-ceiling glass: one long window with thin mullions
    const outside = view === 'sea' ? K.sea : (cc, x, y, w, h) => K.skyline(cc, x, y, w, h, 11);
    K.rect('#dfe3e8', 0, 0, c.CW, 2 * T);
    K.window(c, 1, 1.5, c.CW - 2, 2 * T - 5, outside, { frame: '#9aa3ad', mullions: 10 });
    K.rect('#aeb6bf', 0, 2 * T - 3.5, c.CW, 3.5);                           // sill
    K.rect('rgba(255,255,255,.35)', 0, 2 * T - 3.5, c.CW, 0.6);
    // ceiling light strips reflect on the floor
    for (let x = 2 * T; x < 14 * T; x += 4 * T) K.rect('rgba(255,255,255,.18)', x, 2 * T + 2, 2 * T, 0.8);
    K.partition(c, { glass: 'rgba(170,210,255,.22)', frame: '#9aa3ad' });
  }

  function props(c, list) {
    K.begin(c);
    const H = c.CH / T;
    list.push({ z: 3.3 * T, f: () => {                 // coffee bar with an espresso machine
      const x = 15.5 * T, y = 2.2 * T;
      K.shadow(() => K.rr('#f2f2f0', x, y + 8, 3.6 * T, 12, 1.5));
      K.rect('#2b2f36', x, y + 17, 3.6 * T, 3);
      K.coffeeMachine(c, x + 4, y - 3);
      for (let i = 0; i < 4; i++) K.rr(['#e05d5d', '#4f9dde', '#f2f2f0', '#57b86b'][i], x + 22 + i * 4.5, y + 5.5, 3, 3.2, 0.6);   // cups
      for (let i = 0; i < 3; i++) { K.rr('#2b2f36', x + 8 + i * 14, y + 23, 5, 2, 1); K.rect('#8d939b', x + 10.2 + i * 14, y + 25, 0.6, 5); }     // stools
    } });
    list.push({ z: 3.3 * T, f: () => {                 // screen with the office status
      K.statusBoard(c, 20.3 * T, 2.3 * T, 1.4 * T, 16, { frame: '#2b2f36' });
    } });
    list.push({ z: 9.4 * T, f: () => {                 // lounge sofa and low table
      K.sofa(16 * T, 8.6 * T, 4.4 * T, { color: '#3d6f8f' });
      K.rr('#f2f2f0', 17.2 * T, 10.2 * T, 2 * T, 7, 3);
      K.rr('#57b86b', 17.2 * T + 6, 10.2 * T + 2, 4, 3, 1.5);
    } });
    list.push({ z: (H - 0.3) * T, f: () => K.plant(21.3 * T, (H - 0.2) * T, { size: 1.5, pot: '#f2f2f0' }) });
    list.push({ z: (H - 0.3) * T, f: () => K.plant(15.8 * T, (H - 0.2) * T, { size: 1.1, pot: '#2b2f36' }) });
    list.push({ z: (H - 0.3) * T, f: () => K.plant(0.7 * T, (H - 0.2) * T, { size: 1.2, pot: '#f2f2f0' }) });
    list.push({ z: 6.1 * T, f: () => K.plant(13.6 * T, 6.2 * T, { size: 0.9, pot: '#f2f2f0' }) });
  }

  function drawDesk(c, d, s) {
    K.begin(c);
    K.desk(c, d, s, {
      top: ['#fbfbfa', '#e6e7e8'], front: '#d4d6d9', legs: '#2b2f36', chair: '#2b2f36',
      screens: 2, on: '#eef4ff', lines: '#3b5b8a', bezel: '#2a2d33', mug: K.pick(s || { id: d.join() }, 'mug', ['#e05d5d', '#4f9dde', '#f2f2f0', '#e0a33b']),
      extra: (x, y) => { K.plant(x + 32, y + 9, { size: 0.35, pot: '#f2f2f0' }); },
    });
  }

  const JACKETS = ['#2b3a55', '#5a5f69', '#8a6f5a', '#2f4f4f', '#6b2f3a', '#e8e4dc'];
  const BOTTOMS = ['#2b2f36', '#3a4a66', '#c9b89a', '#4a4f57', '#1f2a3d'];
  function drawChar(c, s) {
    K.begin(c);
    const skirt = K.rand(s, 'skirt') < 0.4, blazer = K.senior(s) || K.rand(s, 'blazer') < 0.4;
    const jacket = K.pick(s, 'jacket', JACKETS);
    K.person(c, s, {
      top: blazer ? jacket : s.shirt, sleeve: blazer ? jacket : s.shirt, inner: blazer ? '#f4f4f6' : null,
      bottom: K.pick(s, 'bottom', BOTTOMS), skirt, heels: skirt && K.rand(s, 'heels') < 0.8,
      shoes: skirt ? K.pick(s, 'shoes', ['#1c1c20', '#b23a48', '#1c1c20']) : K.pick(s, 'sneak', ['#f2f2f0', '#1c1c20', '#6b4226']),
      hair: skirt ? K.pick(s, 'hair', ['long', 'bun', 'pony', 'curly']) : K.pick(s, 'hair', ['short', 'short', 'curly', 'bald']),
      glasses: K.rand(s, 'glasses') < 0.3,
      badge: '#2f6fd6',
    });
  }

  window.CubicleThemes.register({
    id: 'plaza', name: { en: 'Plaza office (HD)', tr: 'Plaza ofisi (HD)' }, scale: 4, smooth: true,
    setup(opts) { view = opts.view === 'sea' ? 'sea' : 'city'; },
    drawRoom, props, drawDesk, drawChar,
  });
})();
