# SMPIS — A happier school day (60-second revision)

This version uses faster product demonstrations, an upbeat original 120 BPM instrumental, synchronized sound effects, and no voiceover. The supplied wide logo keeps its original 980:300 proportions in a larger, clear presentation.

The mouse visibly moves, clicks menu items and tabs, opens forms, and points to results on real pages of an isolated demonstration school. The screenshots are not substituted for the product interactions.

## Timeline

| Time | On screen |
| --- | --- |
| 00:00–00:03 | Short animated introduction |
| 00:03–00:09 | Overview and school metrics |
| 00:09–00:16 | Class settings and teacher assignment |
| 00:16–00:24 | Finance, fee structures and fee form |
| 00:24–00:31 | Attendance, All present and Save attendance |
| 00:31–00:39 | Academics and a populated class gradebook |
| 00:39–00:47 | Parent login view, children and invoices |
| 00:47–00:53 | Parent payment form and invoice selection |
| 00:53–01:00 | 30-day free trial invitation and signup URL |

## Files

- `SMPIS-60s-Upbeat-Product-Demo-1080p.mp4`: 1920 × 1080 presentation master, H.264 / AAC, 30 fps.
- `SMPIS-60s-Sharing-720p.mp4`: smaller sharing copy.
- `SMPIS-60s-Trial-Poster.jpg`: closing campaign still.
- `music-and-effects.wav`, `upbeat-music.wav`, `navigation-sound-effects.wav`: editable audio mix and stems; none includes speech.
- `sound-cues.json`: actual click, transition and confirmation timings.
- `validation.json`: final technical checks.
- `recordings/product-navigation.webm`: original browser recording.

The introductory and closing school pictorial was generated for the first video; the exact prompt is preserved in `../marketing-video/image-prompts.json`. No new AI logo or photographic image was generated for this revision. No customer data is used. Payment forms are demonstrated without starting an external payment.

The 30-day trial and no-card offer match the project and the public site checked during the preceding video production. Trial access pauses on expiry; the end card states that an upgrade is needed to continue.

## Regenerate

1. `npm run build`
2. `npx playwright install ffmpeg` if Playwright's video encoder is missing.
3. `node scripts/record-marketing-v2.mjs` (records in real time).
4. `python scripts/render-marketing-v2.py`

Use `node scripts/record-marketing-v2.mjs --dry-run` for an accelerated navigation/layout review. Record again before exporting: dry-run cues have no real-time positions. Requirements are the project's Node dependencies, Google Chrome, and Python packages `numpy` and `imageio-ffmpeg`.

The first video is preserved in `../marketing-video/`. The revision is a separate artifact and has not been published or mailed.
