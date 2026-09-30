// Cubicle as a Paperclip plugin: the UI module Paperclip loads for the sidebar link and the page.
// Plain ESM, no build step: Paperclip resolves "react" to its own copy when it loads this file.
// The office itself is the normal Cubicle page (index.html next to this file), which Paperclip
// serves from the plugin folder and which reads Paperclip's API on the same origin, read-only.
import React from 'react';

const h = React.createElement;
const PLUGIN_KEY = 'caglarutkuguler.cubicle';
const ROUTE = 'cubicle';

// The two links above the office, in the language the office itself uses: the ⚙ menu's choice
// (same origin, so the same localStorage), then the browser language.
const WORDS = {
  en: ['New tab ↗', 'Open the office in a new browser tab', 'Full-screen office for a TV or second monitor'],
  tr: ['Yeni sekme ↗', 'Ofisi yeni bir tarayıcı sekmesinde aç', 'TV ya da ikinci ekran için tam ekran ofis'],
  de: ['Neuer Tab ↗', 'Das Büro in einem neuen Browser-Tab öffnen', 'Vollbild-Büro für einen Fernseher oder zweiten Monitor'],
  es: ['Nueva pestaña ↗', 'Abrir la oficina en una pestaña nueva', 'Oficina a pantalla completa para una TV o un segundo monitor'],
  fr: ['Nouvel onglet ↗', 'Ouvrir le bureau dans un nouvel onglet', 'Bureau plein écran pour une TV ou un second écran'],
  zh: ['新标签页 ↗', '在新的浏览器标签页中打开办公室', '全屏办公室，用于电视或第二块屏幕'],
  ar: ['علامة تبويب جديدة ↗', 'افتح المكتب في علامة تبويب جديدة', 'مكتب بملء الشاشة لتلفاز أو شاشة ثانية'],
};
function words() {
  let lang = '';
  try { lang = JSON.parse(localStorage.getItem('cubicle.settings') || '{}').lang || ''; } catch (_) {}
  lang = (lang || (typeof navigator !== 'undefined' && navigator.language) || 'en').slice(0, 2).toLowerCase();
  return WORDS[lang] || WORDS.en;
}

// Plugin files are served under /_plugins/<plugin id>/ui/. The id is the install's UUID
// (not every Paperclip version accepts the plugin key there), so look it up once.
let pluginIdPromise = null;
function pluginId() {
  if (!pluginIdPromise) {
    pluginIdPromise = fetch('/api/plugins/ui-contributions', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => (list.find((p) => p.pluginKey === PLUGIN_KEY) || {}).pluginId || PLUGIN_KEY)
      .catch(() => PLUGIN_KEY);
  }
  return pluginIdPromise;
}

function officeUrl(id, context, extra) {
  const q = new URLSearchParams({ embed: 'paperclip' });
  const company = context && (context.companyPrefix || context.companyId);   // the page accepts either
  if (company) q.set('company', company);
  for (const [k, v] of Object.entries(extra || {})) q.set(k, v);
  return `/_plugins/${encodeURIComponent(id)}/ui/index.html?${q}`;
}

// The company prefix for links. Not every slot gets it in `context` (the dashboard widget does not),
// but Paperclip's own URL starts with it: /<PREFIX>/dashboard. A bare /cubicle would be read as a
// company called "CUBICLE".
function companyPrefix(context) {
  if (context && context.companyPrefix) return context.companyPrefix;
  const first = typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : '';
  return first && !first.startsWith('_') && first !== 'api' && first.toLowerCase() !== ROUTE ? decodeURIComponent(first) : '';
}
function pageHref(context) {
  const prefix = companyPrefix(context);
  return prefix ? `/${encodeURIComponent(prefix)}/${ROUTE}` : `/${ROUTE}`;
}

export function CubicleSidebarLink({ context }) {
  const href = pageHref(context);
  const active = typeof window !== 'undefined' && window.location.pathname.startsWith(href);
  // The same classes as Paperclip's own sidebar items (Tasks, Routines...), so the link lines up with
  // them and follows the theme; they are in Paperclip's stylesheet because its own items use them.
  return h('a', {
    href,
    'aria-current': active ? 'page' : undefined,
    className: 'flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 text-(length:--text-compact) font-medium transition-colors ' +
      (active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'),
    style: { textDecoration: 'none' },
  }, h('span', { 'data-slot': 'sidebar-nav-icon', className: 'relative shrink-0' }, deskIcon()), h('span', { className: 'flex-1 truncate' }, 'Cubicle'));
}

// A 16 px line icon in the style of the others (lucide: 2 px stroke, round joins): a desk with a screen.
function deskIcon() {
  const p = (d) => h('path', { d });
  return h('svg', {
    className: 'h-4 w-4', width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  }, h('rect', { x: 6, y: 3, width: 12, height: 8, rx: 1.5 }), p('M12 11v3'), p('M3 14h18'), p('M5 14v7'), p('M19 14v7'));
}

export function CubicleOfficePage({ context }) {
  const [id, setId] = React.useState(null);
  React.useEffect(() => { let live = true; pluginId().then((v) => { if (live) setId(v); }); return () => { live = false; }; }, []);
  if (!id) return null;
  const src = officeUrl(id, context);
  const link = { target: '_blank', rel: 'noopener', style: { color: 'var(--muted-foreground)' } };
  const w = words();
  return h('div', { style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 170px)', minHeight: '420px' } },
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '14px', padding: '0 4px 6px', fontSize: '12px' } },
      // The full page (cards, ⚙ menu) in a tab of its own, and the full-screen office for a TV.
      h('a', { ...link, href: src, title: w[1] }, w[0]),
      h('a', { ...link, href: officeUrl(id, context, { kiosk: '' }), title: w[2] }, 'Kiosk / TV ↗')),
    h('iframe', {
      key: src, src, title: 'Cubicle office', allow: 'clipboard-write',
      style: { flex: 1, width: '100%', border: 0, borderRadius: '8px', background: '#1b1b2b' },
    }));
}

// A small live office on Paperclip's dashboard; clicking it opens the full page.
export function CubicleDashboardWidget({ context }) {
  const [id, setId] = React.useState(null);
  React.useEffect(() => { let live = true; pluginId().then((v) => { if (live) setId(v); }); return () => { live = false; }; }, []);
  if (!id) return null;
  const page = pageHref(context);
  const src = officeUrl(id, { ...context, companyPrefix: companyPrefix(context) }, { kiosk: '', widget: '', fps: '15' });
  return h('a', { href: page, title: 'Cubicle', style: { display: 'block', position: 'relative', textDecoration: 'none', color: 'inherit' } },
    h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, 'Cubicle'),
    h('iframe', {
      key: src, src, title: 'Cubicle office', tabIndex: -1,
      style: { width: '100%', aspectRatio: '352 / 208', border: 0, borderRadius: '8px', background: '#1b1b2b', pointerEvents: 'none', display: 'block' },
    }));
}
