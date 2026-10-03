"""Stage plan for ``asset.process`` (Plan.md sections 3.3 and 8.1). No heavy imports."""

from __future__ import annotations

STAGES: tuple[str, ...] = (
    "probe",
    "audio",
    "proxy",
    "silence",
    "transcribe",
    "segments",
    "shots",
    "keyframes",
    "caption",
    "embed",
    "finalize",
)

# Cumulative progress reached when a stage completes (Plan.md 3.3: probe 5 -> ... -> finalize 100).
STAGE_PROGRESS: dict[str, int] = {
    "probe": 5,
    "audio": 15,
    "proxy": 30,
    "silence": 38,
    "transcribe": 60,
    "segments": 66,
    "shots": 72,
    "keyframes": 78,
    "caption": 88,
    "embed": 97,
    "finalize": 100,
}


def stage_start(stage: str) -> int:
    """Progress at the moment a stage starts (the previous stage's cumulative value)."""
    index = STAGES.index(stage)
    return STAGE_PROGRESS[STAGES[index - 1]] if index else 0


def stages_for(kind: str, *, has_audio: bool = True) -> list[str]:
    """The stages that apply to an asset kind (audio-only skips video stages, images skip ASR)."""
    if kind == "video":
        wanted = {"probe", "proxy", "shots", "keyframes", "caption", "embed", "finalize"}
        if has_audio:
            wanted |= {"audio", "silence", "transcribe", "segments"}
    elif kind == "audio":
        wanted = {"probe", "audio", "silence", "transcribe", "segments", "embed", "finalize"}
    elif kind == "image":
        wanted = {"probe", "keyframes", "caption", "embed", "finalize"}
    else:
        wanted = {"probe", "finalize"}
    return [s for s in STAGES if s in wanted]


def invalidate_from(done: list[str], stage: str) -> list[str]:
    """``done`` minus ``stage`` and every later stage (re-running invalidates downstream work)."""
    cut = STAGES.index(stage)
    return [s for s in done if s in STAGES and STAGES.index(s) < cut]
