// Cubicle as a Paperclip plugin: the UI module Paperclip loads for the sidebar link and the page.
// Plain ESM, no build step: Paperclip resolves "react" to its own copy when it loads this file.
// The office itself is the normal Cubicle page (index.html next to this file), which Paperclip
// serves from the plugin folder and which reads Paperclip's API on the same origin, read-only.
import React from 'react';

const h = React.createElement;
const PLUGIN_KEY = 'caglarutkuguler.cubicle';
const ROUTE = 'cubicle';

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
  return h('a', {
    href,
    'aria-current': active ? 'page' : undefined,
    style: {
      display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', fontSize: '13px', fontWeight: 500,
      textDecoration: 'none', borderRadius: '6px', color: 'var(--foreground)', background: active ? 'var(--accent)' : undefined,
    },
  }, h('span', { 'aria-hidden': 'true' }, '▦'), 'Cubicle');
}

export function CubicleOfficePage({ context }) {
  const [id, setId] = React.useState(null);
  React.useEffect(() => { let live = true; pluginId().then((v) => { if (live) setId(v); }); return () => { live = false; }; }, []);
  if (!id) return null;
  const src = officeUrl(id, context);
  const link = { target: '_blank', rel: 'noopener', style: { color: 'var(--muted-foreground)' } };
  return h('div', { style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 170px)', minHeight: '420px' } },
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '14px', padding: '0 4px 6px', fontSize: '12px' } },
      // The full page (cards, ⚙ menu) in a tab of its own, and the full-screen office for a TV.
      h('a', { ...link, href: src, title: 'Open the office in a new browser tab' }, 'New tab ↗'),
      h('a', { ...link, href: officeUrl(id, context, { kiosk: '' }), title: 'Full-screen office for a TV or second monitor' }, 'Kiosk / TV ↗')),
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
