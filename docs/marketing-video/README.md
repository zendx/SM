# SMPIS — More Possibility

A cinematic landscape promotional video with an English synthetic voiceover, original ambient music, photographic pictorials and screenshots of the actual portal.

## Deliverables

- `SMPIS-Cinematic-Marketing-1080p.mp4`: presentation and publishing master; 1920 × 1080, H.264, 24 fps, AAC audio and selectable English subtitles.
- `SMPIS-Marketing-Share-720p.mp4`: smaller sharing copy; 1280 × 720.
- `SMPIS-Marketing-Captions.srt`: editable captions for social platforms.
- `SMPIS-Marketing-Poster.jpg`: campaign still with the free-trial invitation.
- `assets/`: generated school, administrator and family pictorials plus product screenshots.
- `narration-script.txt`, `scenes.json`, `timeline.json`: copy and timing for future edits.
- `image-prompts.json`: the exact prompts used with the built-in imagegen tool.

## Creative direction

Forest green and cream brand colours, warm school imagery, slow camera pushes and fades through black. The story moves from daily school challenges to a connected workspace, finance visibility, academic progress and family access. It closes with a 30-day free trial, no card required, and `smpis.digital/signup`.

The public website was checked during production on 13 October 2026; its text is saved in `live-offer-check.txt`. Trial access pauses after expiry and an upgrade is needed to continue. The video includes this condition on the closing card. Recheck the offer before running a future campaign.

Photographic school/family scenes were generated with the built-in imagegen tool and do not depict customer testimonials. Portal screenshots use fictional demonstration data. The music is procedurally composed for this project. Narration uses Microsoft Zira Desktop; the initially attempted Nigerian English online speech service was unavailable. No third-party song or stock footage is used.

## Rebuild

Requirements: existing Node dependencies and Google Chrome, Python with `numpy`, `edge-tts`, and `imageio-ffmpeg`, plus Windows System.Speech for the local voice.

1. `node scripts/create-marketing-scenes.mjs`
2. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/marketing-local-voice.ps1`
3. `python scripts/render-marketing-video.py`

The renderer keeps intermediate clips for reproducibility. Delete only the clips you want to regenerate after changing scene images or timings; otherwise unchanged clips are reused. Files are prepared locally and have not been posted to social media or sent to customers.
