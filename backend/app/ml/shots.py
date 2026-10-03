"""Shot detection (Plan.md section 8.1): PySceneDetect with a fixed-length fallback."""

from __future__ import annotations

import logging
from pathlib import Path

from app.config import get_settings

log = logging.getLogger(__name__)

Shot = tuple[float, float]
MIN_DETECTED_SHOTS = 3
FIXED_SHOT_SEC = 20.0


def fixed_shots(duration: float, length: float = FIXED_SHOT_SEC) -> list[Shot]:
    """Back-to-back ``length``-second shots; a trailing remainder under 20% of it is merged."""
    if duration <= 0:
        return []
    shots: list[Shot] = []
    start = 0.0
    while start < duration - 1e-6:
        end = min(start + length, duration)
        if duration - end < length * 0.2:
            end = duration
        shots.append((round(start, 3), round(end, 3)))
        start = end
    return shots


def normalize_shots(shots: list[Shot], duration: float) -> list[Shot]:
    """Make shots contiguous and covering ``[0, duration]``; drop empty ones."""
    cleaned = sorted((max(0.0, s), min(e, duration)) for s, e in shots if e > s)
    if not cleaned:
        return []
    out: list[Shot] = []
    cursor = 0.0
    for i, (_, end) in enumerate(cleaned):
        end = duration if i == len(cleaned) - 1 else end
        if end - cursor > 1e-6:
            out.append((round(cursor, 3), round(end, 3)))
            cursor = end
    return out


def detect_scene_cuts(path: Path, threshold: float, min_len_frames: int) -> list[Shot]:
    """Raw PySceneDetect ``ContentDetector`` scenes as ``(start_sec, end_sec)``."""
    from scenedetect import ContentDetector, detect

    scenes = detect(str(path), ContentDetector(threshold=threshold, min_scene_len=min_len_frames))
    return [(float(a.get_seconds()), float(b.get_seconds())) for a, b in scenes]


def detect_shots(path: Path, duration: float) -> tuple[list[Shot], str]:
    """Return ``(shots, method)``: ``scenedetect``, or ``fixed`` when fewer than 3 cuts."""
    settings = get_settings()
    try:
        raw = detect_scene_cuts(path, settings.shot_threshold, settings.shot_min_len_frames)
    except Exception as exc:  # decoder problems must not fail the whole asset
        log.warning("scene detection failed for %s (%s); using fixed shots", path.name, exc)
        raw = []
    shots = normalize_shots(raw, duration)
    if len(shots) < MIN_DETECTED_SHOTS:
        return fixed_shots(duration), "fixed"
    return shots, "scenedetect"


def select_evenly(count: int, limit: int) -> list[int]:
    """Up to ``limit`` indices from ``range(count)``, evenly spaced and always sorted."""
    if count <= 0 or limit <= 0:
        return []
    if count <= limit:
        return list(range(count))
    if limit == 1:
        return [count // 2]
    return sorted({round(i * (count - 1) / (limit - 1)) for i in range(limit)})


def nearest_index(target: int, candidates: list[int]) -> int | None:
    """The candidate closest to ``target`` (ties go to the earlier one)."""
    if not candidates:
        return None
    return min(candidates, key=lambda c: (abs(c - target), c))
