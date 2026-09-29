// Paperclip plugin manifest for Cubicle. Paperclip reads this when the package is installed
// with `paperclipai plugin install @caglarutkuguler/cubicle`; the standalone server ignores it.
'use strict';
const { version, author } = require('../package.json');

module.exports = {
  id: 'caglarutkuguler.cubicle',
  apiVersion: 1,
  version,
  displayName: 'Cubicle',
  description: 'A live office for your agents: they sit down and type while working, raise a hand when they need you, and go to the lounge when done. Read-only.',
  author,
  categories: ['ui'],
  capabilities: ['ui.sidebar.register', 'ui.page.register'],
  entrypoints: { worker: './paperclip/worker.js', ui: './public' },
  ui: {
    slots: [
      { type: 'sidebar', id: 'cubicle-sidebar', displayName: 'Cubicle', exportName: 'CubicleSidebarLink' },
      { type: 'page', id: 'cubicle-page', displayName: 'Cubicle', exportName: 'CubicleOfficePage', routePath: 'cubicle' },
    ],
  },
};
