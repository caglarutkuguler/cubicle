# Demo recording

`record-demo.py` renders the demo GIF in `docs/` and the square/portrait promo video from a scripted feed, frame by frame under a frozen Playwright clock, so every frame is exact and every state (working, needs-you, done, error) appears within 15 seconds.

```bash
pip install playwright && python -m playwright install chromium   # once
node bin/cubicle.js --port 3399 --source examples/feed.json &      # any feed source; /api/feed is intercepted
python scripts/record-demo.py http://127.0.0.1:3399 /tmp/plain 1080 1080 plain
python scripts/record-demo.py http://127.0.0.1:3399 /tmp/promo 1080 1350 promo

# README GIF (header + office, 720 px, 12.5 fps)
ffmpeg -framerate 25 -i /tmp/plain/f%04d.png -vf "crop=1080:676:0:0,fps=12.5,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" docs/demo.gif
# Social video (4:5, H.264)
ffmpeg -framerate 25 -i /tmp/promo/f%04d.png -vf "tpad=stop_mode=clone:stop_duration=1.5,format=yuv420p" -c:v libx264 -crf 16 -tune animation -movflags +faststart cubicle.mp4
```

# README hero GIF

`record-hero.py` records the GIF at the top of the README the same way: the office with its cards beside it, a conversation in the lounge, a raised hand, an error and the agent panel.

```bash
node bin/cubicle.js --port 3399 --source examples/feed.json &
python scripts/record-hero.py http://127.0.0.1:3399 /tmp/hero pixel
ffmpeg -framerate 25 -i /tmp/hero/f%04d.png -vf "fps=12.5,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" docs/hero.gif
```
