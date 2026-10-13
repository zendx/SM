"""Render the recorded portrait SMPIS walkthrough with narration and music."""
import json
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "marketing-video-mobile"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VIDEO = OUTPUT / "recordings" / "mobile-quick-start.webm"
NARRATION = OUTPUT / "audio" / "narration.wav"
MUSIC = ROOT / "docs" / "marketing-video-v2" / "music-and-effects.wav"


def run(args):
    result = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *map(str, args)],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])


def inspect(path):
    result = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", str(path)],
        capture_output=True,
        text=True,
    )
    match = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", result.stderr)
    if not match:
        raise RuntimeError(f"Cannot read duration for {path.name}")
    hours, minutes, seconds = map(float, match.groups())
    return hours * 3600 + minutes * 60 + seconds, result.stderr


for source in (VIDEO, NARRATION, MUSIC):
    if not source.is_file():
        raise FileNotFoundError(f"Missing render input: {source}")

duration, _ = inspect(VIDEO)
if duration < 60 or duration > 64:
    raise RuntimeError(f"Capture should be about 60 seconds; found {duration:.2f}s.")
narration_duration, _ = inspect(NARRATION)
if narration_duration > 59.5:
    raise RuntimeError(
        f"Narration is {narration_duration:.2f}s; adjust the local voice rate "
        "so the final trial invitation is not cut off."
    )

master = OUTPUT / "SMPIS-Quick-Start-60s-1080x1920.mp4"
trim = duration - 60
run(
    [
        "-ss",
        f"{trim:.3f}",
        "-i",
        VIDEO,
        "-i",
        NARRATION,
        "-i",
        MUSIC,
        "-filter_complex",
        "[1:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=8,apad,atrim=0:60[voice];"
        "[2:a]volume=0.09[bed];"
        "[voice][bed]amix=inputs=2:duration=longest:normalize=0,"
        "alimiter=limit=0.90,afade=t=out:st=59:d=1[mix]",
        "-map",
        "0:v:0",
        "-map",
        "[mix]",
        "-vf",
        "fps=30,format=yuv420p",
        "-t",
        "60",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "19",
        "-threads",
        "4",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-metadata",
        "title=SMPIS — Quick-start mobile walkthrough",
        "-metadata",
        "comment=60-second portrait product demo with local narration and animated taps.",
        master,
    ]
)
share = OUTPUT / "SMPIS-Quick-Start-60s-720x1280.mp4"
run(
    [
        "-i",
        master,
        "-vf",
        "scale=720:1280",
        "-t",
        "60",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "24",
        "-threads",
        "4",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        share,
    ]
)
for output in (master, share):
    result = subprocess.run(
        [FFMPEG, "-v", "error", "-i", str(output), "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(f"Full decode failed for {output.name}: {result.stderr}")

summary = json.loads((OUTPUT / "validation.json").read_text(encoding="utf-8"))
summary.update(
    {
        "master": master.name,
        "sharing_copy": share.name,
        "audio": "local English narration over original music and click effects",
        "full_decode": "both MP4 exports passed",
        "recording_trimmed_seconds": round(trim, 3),
    }
)
(OUTPUT / "validation.json").write_text(
    json.dumps(summary, indent=2), encoding="utf-8"
)
print(json.dumps(summary, indent=2))
