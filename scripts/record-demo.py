"""Deterministic frame capture of Cubicle for the demo GIF and the LinkedIn video.

A fake clock drives the page, so every frame is exact and lossless, and a scripted
feed makes every state (working, needs-you, done, error) appear within 15 seconds.
"""
import json, os, sys, datetime
from playwright.sync_api import sync_playwright

BASE = sys.argv[1]            # http://127.0.0.1:PORT
OUT = sys.argv[2]             # frames dir
W, H = int(sys.argv[3]), int(sys.argv[4])
PROMO = sys.argv[5] == 'promo'
FPS = 25
STEP = 1000 // FPS            # 40 ms
WARMUP = 10.5                 # seconds of virtual time before the first frame
LENGTH = 15.0                 # seconds recorded

os.makedirs(OUT, exist_ok=True)

ROSTER = [
    ('ceo', 'CEO', 'Chief Executive'),
    ('web', 'WebDev', 'Web Developer'),
    ('seo', 'SEO', 'SEO & Content'),
    ('growth', 'Growth', 'Growth Marketer'),
    ('analyst', 'Analyst', 'Functional Analyst'),
    ('qa', 'QA', 'QA & Testing'),
]

def state(t):
    """Agent states at virtual time t (seconds)."""
    s = {
        'ceo': ('running', {'id': 'MEG-12', 'title': 'Plan Q4 campaign'}),
        'web': ('running', 'Edit checkout.php'),
        'seo': ('running', 'Keyword research: winter'),
        'growth': ('idle', None),
        'analyst': ('running', 'Read orders.csv'),
        'qa': ('idle', None),
    }
    err = {}
    if t >= 12:
        s['qa'] = ('running', 'Bash: npm test')
        s['seo'] = ('idle', None)
    if t >= 16: s['web'] = ('waiting', 'allow Bash: git push?')
    if t >= 20:
        s['analyst'] = ('error', None); err['analyst'] = 'API rate limit (429)'
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
    return {'company': 'MEG Venture', 'agents': agents}

vt = 0.0  # virtual seconds, updated before each clock step

def on_feed(route):
    poll_t = (int(vt * 1000) // 4000) * 4
    route.fulfill(status=200, content_type='application/json', body=json.dumps(state(poll_t)))

PROMO_CSS = """
  body { font-size: 15px; padding-top: 92px; }
  .wrap { max-width: none; padding: 0 16px 0; }
  .wrap { margin: 0; width: 100%; }
  #promo-top { padding: 0 16px 26px; }
  #promo-top h2 { margin: 0; font: 700 58px/1.05 system-ui, sans-serif; color: #fff; letter-spacing: -1px; }
  #promo-top p { margin: 14px 0 0; font: 400 28px/1.3 system-ui, sans-serif; color: #b9bad0; }
  #promo-bottom { padding: 30px 0 0; display: flex; flex-direction: column; gap: 12px; }
  #promo-bottom code { font: 600 30px/1.2 "DejaVu Sans Mono", monospace; color: #9ff0b4; background: #0f1119; border: 1px solid #33374d; border-radius: 10px; padding: 12px 16px; align-self: flex-start; }
  #promo-bottom span { font: 400 22px/1.3 system-ui, sans-serif; color: #9a9bb3; }
  footer, #banner { display: none !important; }
  .card { padding: 11px 13px; }
  .card b { font-size: 16px; } .card .role, .card .st { font-size: 14px; }
  .bub { font-size: 13px; } .name { font-size: 13px; }
  h1 { font-size: 20px; } h1 small, #status { font-size: 15px; }
"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1,
                              timezone_id='Europe/Istanbul', locale='en-US')
    T0 = datetime.datetime(2026, 9, 28, 10, 30, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=3)))
    ctx.clock.install(time=T0)
    ctx.clock.pause_at(T0 + datetime.timedelta(milliseconds=1))  # no natural time flow: frames advance only via run_for
    page = ctx.new_page()
    page.route('**/api/feed', on_feed)
    page.goto(f'{BASE}/?lang=en')
    page.wait_for_timeout(400)            # real time: config.json + first poll resolve
    if PROMO:
        page.add_style_tag(content=PROMO_CSS)
        page.evaluate("""() => {
          const top = document.createElement('div'); top.id = 'promo-top';
          top.innerHTML = '<h2>Cubicle</h2><p>A live pixel-art office for your AI agents.<br>Claude Code, Paperclip, or any JSON feed.</p>';
          document.body.prepend(top);
          const bot = document.createElement('div'); bot.id = 'promo-bottom';
          bot.innerHTML = '<code>npx @caglarutkuguler/cubicle</code><span>Open source (MIT) · zero dependencies · read-only</span>';
          document.querySelector('.wrap').appendChild(bot);
          const h1 = document.querySelector('h1'); if (h1 && h1.firstChild) h1.firstChild.textContent = '';
        }""")

    total = int((WARMUP + LENGTH) * 1000 / STEP)
    first = int(WARMUP * 1000 / STEP)
    n = 0
    for i in range(total):
        before = vt
        vt = (i + 1) * STEP / 1000
        page.clock.run_for(STEP)
        if int(before * 1000) // 4000 != int(vt * 1000) // 4000:
            page.wait_for_timeout(80)     # let the poll's fetch resolve
            page.clock.run_for(0)
        if i >= first:
            page.screenshot(path=f'{OUT}/f{n:04d}.png')
            n += 1
    print('frames', n, 'last vt', vt)
    browser.close()
