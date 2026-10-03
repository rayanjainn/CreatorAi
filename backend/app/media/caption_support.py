"""Which caption burn-in renderer this machine can use.

``libass``  the ffmpeg ``subtitles`` filter fed an ASS file (needs an ffmpeg built with libass;
            Homebrew's ffmpeg 9 is not).
``pillow``  transparent PNGs drawn by Pillow and overlaid with core filters only (works on any
            ffmpeg, no libass / freetype).

``CAPTION_RENDERER=auto`` (default) picks libass when its filter really works, else pillow. The
probe runs the filter on a tiny ASS file instead of grepping ``-filters``, so a build that lists
the filter but cannot run it is handled, and the result is cached for the process.
"""

from __future__ import annotations

import functools
import subprocess
import tempfile
from pathlib import Path

from app.config import get_settings

_PROBE_ASS = "\n".join(
    [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 64",
        "PlayResY: 64",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,"
        "Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,"
        "Alignment,MarginL,MarginR,MarginV,Encoding",
        "Style: Default,sans-serif,12,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,"
        "100,100,0,0,1,1,0,2,2,2,2,1",
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
        "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,probe",
        "",
    ]
)


@functools.lru_cache(maxsize=1)
def libass_available() -> bool:
    """True when ``ffmpeg`` can run ``subtitles=filename=...`` (explicit form, FFmpeg 9 safe)."""
    with tempfile.TemporaryDirectory(prefix="creatorai-libass-") as tmp:
        (Path(tmp) / "t.ass").write_text(_PROBE_ASS, encoding="utf-8")
        try:
            out = subprocess.run(
                [
                    get_settings().ffmpeg_bin,
                    "-hide_banner",
                    "-nostdin",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=64x64:r=5:d=0.4",
                    "-vf",
                    "subtitles=filename=t.ass",
                    "-frames:v",
                    "1",
                    "-f",
                    "null",
                    "-",
                ],
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
                cwd=tmp,
            )
        except (OSError, subprocess.SubprocessError):
            return False
    return out.returncode == 0


def captions_supported_renderers() -> tuple[str, ...]:
    """Renderers usable here, best first: ``("libass", "pillow")`` or ``("pillow",)``."""
    return ("libass", "pillow") if libass_available() else ("pillow",)


def resolve_caption_renderer(setting: str | None = None) -> str:
    """The renderer exports use: ``libass`` or ``pillow``.

    An explicit ``libass`` is honoured even when the probe fails (the operator asked for it).
    """
    choice = setting or get_settings().caption_renderer
    if choice in ("libass", "pillow"):
        return choice
    return "libass" if libass_available() else "pillow"


def caption_features() -> dict[str, object]:
    """Shape of ``features.captions`` in ``GET /api/v1/health``."""
    return {"renderer": resolve_caption_renderer(), "libass": libass_available()}
