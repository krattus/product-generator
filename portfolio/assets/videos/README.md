# Video assets (placeholders)

Everything degrades gracefully while these files are missing — the hero
shows its CSS gradient, cards keep their gradient placeholders.

Expected files:

```
hero-base.mp4 / .webm        # top hero video (visible by default)
hero-base-poster.jpg
hero-reveal.mp4 / .webm      # bottom hero video (revealed on hover)
hero-reveal-poster.jpg

thumbs/<project-id>.mp4      # hover-play card loops, ids listed in
                             # js/portfolio-grid.js (PROJECTS array)

case/<project-id>-hero.mp4   # case-study page hero reels
case/<project-id>-poster.jpg
```

Encoding tips: hero loops ≤ 8 MB (1080p, ~10 s, H.264 CRF 26–28, no
audio); card thumbs ≤ 1.5 MB (720p, 3–5 s). Add a `.webm` (VP9/AV1)
variant of each for ~30 % smaller files where supported.
