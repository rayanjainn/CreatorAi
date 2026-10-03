"""Render presets (Plan.md section 8.9). Duration caps are conservative defaults: confirm each
platform's current limits before relying on them."""

from __future__ import annotations

from dataclasses import dataclass

from app.errors import AppError


@dataclass(frozen=True)
class Preset:
    name: str
    label: str
    aspect: str  # "9:16" | "16:9"
    width: int
    height: int
    max_duration: float | None  # seconds; None = unlimited
    caption_style: str  # default caption style for this preset
    publishable: bool  # can be published straight to YouTube (the others are download only)


PRESETS: dict[str, Preset] = {
    p.name: p
    for p in (
        Preset("yt_short", "YouTube Short", "9:16", 1080, 1920, 60.0, "bold_center", True),
        Preset("reels", "Instagram Reels", "9:16", 1080, 1920, 90.0, "bold_center", False),
        Preset("tiktok", "TikTok", "9:16", 1080, 1920, 60.0, "karaoke", False),
        Preset("yt_long", "YouTube (16:9)", "16:9", 1920, 1080, None, "minimal_bottom", True),
    )
}


def get_preset(name: str) -> Preset:
    try:
        return PRESETS[name]
    except KeyError:
        raise AppError(
            "VALIDATION_ERROR",
            f"Unknown preset {name!r}",
            details={"presets": list(PRESETS)},
        ) from None


def check_duration(preset: Preset, duration: float) -> None:
    """``422 DURATION_EXCEEDS_PRESET`` (with the cap) when ``duration`` is over the preset's cap."""
    cap = preset.max_duration
    if cap is not None and duration > cap + 1e-3:
        raise AppError(
            "DURATION_EXCEEDS_PRESET",
            f"This clip is {duration:.1f} s but {preset.label} allows at most {cap:g} s. "
            "Trim it in the editor or pick another preset.",
            details={
                "preset": preset.name,
                "max_duration": cap,
                "duration": round(duration, 3),
                "over_by": round(duration - cap, 3),
            },
        )
