"""Frame capture for the README hero GIF: the office with its cards beside it, a conversation in the
lounge, an agent raising its hand, an error, and the agent panel opening on it.

Same method as record-demo.py: a frozen Playwright clock and a scripted feed, so every frame is exact.

    node bin/cubicle.js --port 3399 --source examples/feed.json &      # /api/feed is intercepted
    python scripts/record-hero.py http://127.0.0.1:3399 /tmp/hero [pixel|plaza]
    ffmpeg -framerate 25 -i /tmp/hero/f%04d.png -vf "fps=12.5,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" docs/hero.gif
"""
import json, os, sys, datetime
from playwright.sync_api import sync_playwright

BASE, OUT = sys.argv[1], sys.argv[2]
THEME = sys.argv[3] if len(sys.argv) > 3 else 'pixel'
W, H, FPS = 1280, 720, 25
STEP = 1000 // FPS
WARMUP, LENGTH = 10.5, 16.0
os.makedirs(OUT, exist_ok=True)

ROSTER = [('ceo', 'CEO', 'Chief Executive'), ('web', 'WebDev', 'Web Developer'), ('seo', 'SEO', 'SEO & Content'),
          ('growth', 'Growth', 'Growth Marketer'), ('analyst', 'Analyst', 'Data Analyst'), ('qa', 'QA', 'QA & Testing'),
          ('design', 'Designer', 'Product Designer')]

def state(t):
    s = {
        'ceo': ('running', {'id': 'ACME-12', 'title': 'Plan Q4 roadmap'}),
        'web': ('running', 'Edit checkout.tsx'),
        'seo': ('idle', None), 'growth': ('idle', None),
        'analyst': ('running', 'Read orders.csv'),
        'qa': ('running', 'Bash: npm test'),
        'design': ('running', {'id': 'ACME-15', 'title': 'Landing page hero'}),
    }
    err = {}
    if t >= 14: s['web'] = ('waiting', 'Allow: git push to main?')
    if t >= 17: s['analyst'] = ('error', None); err['analyst'] = 'API rate limit (429): retry in 60 s'
    if t >= 24:
        s['web'] = ('running', 'Bash: git push origin main')
        s['growth'] = ('running', 'Draft newsletter')
    agents = []
    for i, (aid, name, role) in enumerate(ROSTER):
        st, task = s[aid]
        a = {'id': aid, 'name': name, 'role': role, 'status': st, 'since': i}
        if task: a['task'] = task
        if aid in err: a['error'] = err[aid]
        agents.append(a)
    return {'company': 'Acme Labs', 'agents': agents}

vt = 0.0
def on_feed(route):
    route.fulfill(status=200, content_type='application/json', body=json.dumps(state((int(vt * 1000) // 4000) * 4)))

EVENTS = {  # virtual second -> page script
    # a conversation in the lounge as soon as two agents are free (tried every frame until it starts)
    11.0: "() => { const d = window.CubicleDebug, now = performance.now() / 1000, idle = [...d.sprites.values()].filter(s => s.status === 'idle');"
          " if (idle.some(s => s.chat)) return true; for (const s of idle) { s.lastChat = -100; s.lastDone = { id: 'ACME-9', at: Date.now() }; }"
          " return idle.some(s => d.startChat(s, now)); }",
    19.0: "() => { const d = window.CubicleDebug; d.select([...d.sprites.values()].find(s => s.name === 'Analyst')); return true; }",
    23.5: "() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true; }",
}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM') or None)
    ctx = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, timezone_id='Europe/Istanbul', locale='en-US')
    T0 = datetime.datetime(2026, 10, 2, 10, 30, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=3)))
    ctx.clock.install(time=T0)
    ctx.clock.pause_at(T0 + datetime.timedelta(milliseconds=1))
    page = ctx.new_page()
    page.route('**/api/feed/**', on_feed)
    page.goto(f'{BASE}/?lang=en&layout=side&debug&theme={THEME}')
    page.wait_for_timeout(500)
    total, first, n = int((WARMUP + LENGTH) * 1000 / STEP), int(WARMUP * 1000 / STEP), 0
    done = set()
    for i in range(total):
        before = vt
        vt = (i + 1) * STEP / 1000
        page.clock.run_for(STEP)
        if int(before * 1000) // 4000 != int(vt * 1000) // 4000:
            page.wait_for_timeout(80); page.clock.run_for(0)
        for at, js in EVENTS.items():
            if at not in done and vt >= at and page.evaluate(js) is not False:
                done.add(at)
        if i >= first:
            page.screenshot(path=f'{OUT}/f{n:04d}.png'); n += 1
    print('frames', n)
    browser.close()
