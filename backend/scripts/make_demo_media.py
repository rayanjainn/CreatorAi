#!/usr/bin/env python
"""Generate synthetic DEMO footage plus a matching transcript sidecar (no network, ffmpeg only).

Creates ``<name>.mp4`` and ``<name>.words.json`` in ``--out``:

* video: ~50 s of solid colour scenes (cuts line up with the script's topics) labelled
  "DEMO FOOTAGE" so nobody mistakes it for real footage;
* audio: speech-LIKE tone bursts, one per word, with real pauses and a deliberate retake;
* sidecar: word timings for a spoken script about a video-editing workflow, declared
  ``"provenance": "demo"`` so every API response badges it as demo data.

The tones are not speech: the transcript is the ground truth the sidecar provides. Used by the
ingest integration tests (generated on the fly, never committed) and by ``make seed``.

    python backend/scripts/make_demo_media.py --out data/demo
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000
# (sentence, pause_after_seconds). The first take of sentence 2 is a deliberate retake.
SCRIPT: list[tuple[str, float]] = [
    ("Here is how I edit a video from start to finish.", 0.7),
    ("So the first step is, so the", 0.9),
    ("So the first step is to import every clip into one bin.", 1.8),
    ("Next I trim the dead air and cut out the long pauses.", 0.7),
    ("Then I add b-roll over the boring parts so the story keeps moving.", 2.0),
    ("Color correction comes after the rough cut is locked.", 0.7),
    ("Finally I export a vertical version for shorts and a wide version for youtube.", 1.5),
    ("That is my whole editing workflow in under a minute.", 0.8),
]
# Scene cuts happen at the start of these sentence indexes.
SCENE_STARTS = (0, 3, 4, 5, 6)
SCENE_COLORS = ("0x1f4e9c", "0xc2571a", "0x2a8f4e", "0x8e3a9d", "0x1f8f8f")
LEAD_IN_SEC = 0.5
TAIL_SEC = 1.0


@dataclass
class DemoMedia:
    video: Path
    sidecar: Path
    duration: float
    words: list[dict[str, object]]
    scene_cuts: list[float]


def _tokens(sentence: str) -> list[str]:
    return sentence.split()


def build_timings() -> tuple[list[dict[str, object]], list[float], float]:
    """Word timings, scene cut times (seconds) and total duration. Deterministic."""
    words: list[dict[str, object]] = []
    sentence_starts: list[float] = []
    cursor = LEAD_IN_SEC
    for sentence, pause in SCRIPT:
        sentence_starts.append(cursor)
        for token in _tokens(sentence):
            length = 0.13 + 0.05 * len(token.strip(",.!?"))
            words.append(
                {"word": token, "start": round(cursor, 3), "end": round(cursor + length, 3)}
            )
            cursor += length + 0.06
        cursor += pause
    duration = round(cursor + TAIL_SEC, 3)
    cuts = [round(sentence_starts[i] - 0.1, 3) for i in SCENE_STARTS[1:]]
    return words, cuts, duration


def synth_audio(words: list[dict[str, object]], duration: float, path: Path) -> None:
    """One tone burst per word (pitch wobbles with the word), digital near-silence elsewhere."""
    total = int(duration * SAMPLE_RATE)
    rng = np.random.default_rng(7)
    signal = rng.normal(0.0, 0.0004, total)  # faint room tone, about -68 dBFS
    for i, w in enumerate(words):
        start, end = int(float(w["start"]) * SAMPLE_RATE), int(float(w["end"]) * SAMPLE_RATE)
        n = max(1, end - start)
        t = np.arange(n) / SAMPLE_RATE
        pitch = 130 + 28 * ((i * 7) % 5)
        tone = np.sin(2 * np.pi * pitch * t) + 0.5 * np.sin(2 * np.pi * 2 * pitch * t)
        env = np.minimum(1.0, np.minimum(t / 0.02, (n / SAMPLE_RATE - t) / 0.03))
        signal[start : start + n] += 0.32 * tone * np.clip(env, 0.0, 1.0)
    pcm = (np.clip(signal, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(pcm.tobytes())


def _video_filter(
    cuts: list[float], duration: float, width: int, height: int, fps: int, label: bool
) -> str:
    bounds = [0.0, *cuts, duration]
    parts, names = [], []
    for i in range(len(bounds) - 1):
        color = SCENE_COLORS[i % len(SCENE_COLORS)]
        text = ""
        if label:
            text = (
                f",drawtext=text='DEMO FOOTAGE - scene {i + 1}':fontcolor=white:"
                f"fontsize={max(14, height // 12)}:x=(w-text_w)/2:y=(h-text_h)/2"
            )
        parts.append(
            f"color=c={color}:s={width}x{height}:r={fps}:"
            f"d={bounds[i + 1] - bounds[i]:.3f}{text}[v{i}]"
        )
        names.append(f"[v{i}]")
    return ";".join(parts) + f";{''.join(names)}concat=n={len(names)}:v=1:a=0[v]"


def generate(
    out_dir: Path, name: str = "hero_demo", width: int = 640, height: int = 360, fps: int = 25
) -> DemoMedia:
    """Write ``<name>.mp4`` and ``<name>.words.json`` to ``out_dir`` and describe them."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required to generate demo media")
    out_dir.mkdir(parents=True, exist_ok=True)
    words, cuts, duration = build_timings()
    wav = out_dir / f"{name}.tmp.wav"
    video = out_dir / f"{name}.mp4"
    synth_audio(words, duration, wav)
    for label in (True, False):  # drawtext needs libfreetype + a font; fall back to plain colour
        cmd = [
            "ffmpeg", "-y", "-v", "error", "-filter_complex",
            _video_filter(cuts, duration, width, height, fps, label), "-i", str(wav), "-map", "[v]",
            "-map", "0:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
            "-shortest", str(video),
        ]  # fmt: skip
        # the wav must be input 0 for "-map 0:a"; filter_complex sources need no -i
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode == 0:
            break
        if not label:
            raise RuntimeError(f"ffmpeg failed: {proc.stderr[-800:]}")
    wav.unlink(missing_ok=True)
    sidecar = out_dir / f"{name}.words.json"
    sidecar.write_text(
        json.dumps(
            {
                "provenance": "demo",
                "note": "DEMO DATA: synthetic tones and a scripted transcript, not real speech.",
                "language": "en",
                "words": words,
            },
            indent=1,
        ),
        encoding="utf-8",
    )
    return DemoMedia(video, sidecar, duration, words, cuts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", type=Path, default=Path("data/demo"), help="output directory")
    parser.add_argument("--name", default="hero_demo")
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=360)
    parser.add_argument("--fps", type=int, default=25)
    args = parser.parse_args(argv)
    media = generate(args.out, args.name, args.width, args.height, args.fps)
    print(f"video   : {media.video} ({media.duration:.1f} s, DEMO data)")
    print(f"sidecar : {media.sidecar} ({len(media.words)} words, provenance=demo)")
    print(f"scene cuts at: {', '.join(f'{c:.1f}s' for c in media.scene_cuts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
