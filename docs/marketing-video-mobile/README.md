# SMPIS — Quick-start mobile video

This 60-second portrait video shows the real SMPIS signup form and a fictional
demonstration school in the mobile layout. Animated taps follow a practical
setup sequence: choose a school portal name, create the administrator account,
select the free trial and school dates, add classes, create individual staff
accounts, add student records, and set up fees.

## Deliverables

- `SMPIS-Quick-Start-60s-1080x1920.mp4` — portrait master, 1080 × 1920, 30 fps.
- `SMPIS-Quick-Start-60s-720x1280.mp4` — portrait sharing copy.
- `SMPIS-Quick-Start-Captions.srt` and `.vtt` — timed English captions.
- `SMPIS-Quick-Start-Poster.jpg` — closing frame.
- `preview.html` — browser preview and download links.

The narration is generated locally with the installed Microsoft Zira Desktop
voice. The product screens use fictional records in an isolated test database;
signup is demonstrated without submitting an account or sending email. The
closing invitation offers the free 30-day trial at `smpis.digital/signup`.

## Rebuild

1. Run `npm run build`.
2. Generate `audio/narration.wav` with
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/marketing-mobile-voice.ps1`.
3. Record the mobile walkthrough with `node scripts/record-marketing-mobile.mjs`.
4. Render both MP4s with the configured Python environment and
   `python scripts/render-marketing-mobile.py`.

The capture requires Google Chrome and the project's existing Node dependencies.
Rendering requires `numpy` and `imageio-ffmpeg`.
