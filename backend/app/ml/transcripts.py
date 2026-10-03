"""Sidecar transcript parsing: ``*.words.json``, SRT and WebVTT (Plan.md section 8.2 + LOCAL_FIRST).

A sidecar is *user-provided* text, so its provenance is ``user`` (or ``demo`` when the file declares
``"provenance": "demo"``, as the generated demo footage does). Nothing here guesses speech: SRT and
VTT carry cue times only, so their word times are interpolated per cue and flagged
``words_estimated``.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any, Literal

from app.errors import AppError
from app.ml.asr.base import Segment, Transcript, Word, interpolate_words

SidecarFormat = Literal["words.json", "srt", "vtt"]
_TIME = r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})"
_CUE_RE = re.compile(rf"{_TIME}\s*-->\s*{_TIME}")
_TAG_RE = re.compile(r"<[^>]+>|\{\\[^}]*\}")


@dataclass
class SidecarTranscript:
    transcript: Transcript
    source: Literal["user", "demo"]
    format: SidecarFormat


def _bad(message: str) -> AppError:
    return AppError("VALIDATION_ERROR", f"Invalid transcript: {message}")


def detect_format(text: str, filename: str | None = None) -> SidecarFormat:
    """Pick the format from the file name, else sniff the content."""
    name = (filename or "").lower()
    if name.endswith(".json"):
        return "words.json"
    if name.endswith(".srt"):
        return "srt"
    if name.endswith(".vtt"):
        return "vtt"
    head = text.lstrip("﻿ \t\r\n")
    if head.startswith(("{", "[")):
        return "words.json"
    if head.upper().startswith("WEBVTT"):
        return "vtt"
    return "srt"


def parse_sidecar(
    text: str, fmt: SidecarFormat | None = None, filename: str | None = None
) -> SidecarTranscript:
    """Parse a transcript sidecar into a :class:`Transcript` (provider ``sidecar``)."""
    text = text.lstrip("﻿")
    fmt = fmt or detect_format(text, filename)
    if fmt == "words.json":
        return _parse_words_json(text)
    cues = _parse_cues(text, vtt=fmt == "vtt")
    if not cues:
        raise _bad("no timed cues found")
    segments = [Segment(t, s, e) for s, e, t in cues]
    return SidecarTranscript(
        Transcript(
            provider="sidecar",
            model=fmt,
            language=None,
            words=interpolate_words(segments),
            segments=segments,
            duration=segments[-1].end,
            words_estimated=True,
        ),
        "user",
        fmt,
    )


def _num(value: Any, what: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise _bad(f"{what} is not a number") from None
    if not math.isfinite(number):
        raise _bad(f"{what} is not finite")
    return number


def _parse_words_json(text: str) -> SidecarTranscript:
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise _bad(f"not valid JSON ({exc})") from None
    meta: dict[str, Any] = data if isinstance(data, dict) else {}
    raw = meta.get("words") if isinstance(data, dict) else data
    if not isinstance(raw, list) or not raw:
        raise _bad('expected a non-empty "words" list')
    words: list[Word] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise _bad(f"word {i} is not an object")
        token = item.get("word", item.get("text", item.get("w")))
        if token is None or not str(token).strip():
            raise _bad(f"word {i} has no text")
        start = _num(item.get("start", item.get("s")), f"word {i} start")
        end = _num(item.get("end", item.get("e")), f"word {i} end")
        if start < 0:
            raise _bad(f"word {i} starts before 0")
        words.append(Word(str(token).strip(), round(start, 3), round(max(end, start), 3)))
    words.sort(key=lambda w: (w.start, w.end))
    declared = str(meta.get("provenance", "")).lower()
    language = meta.get("language")
    return SidecarTranscript(
        Transcript(
            provider="sidecar",
            model="words.json",
            language=str(language) if language else None,
            words=words,
            segments=[],
            duration=words[-1].end,
            words_estimated=False,
        ),
        "demo" if declared == "demo" else "user",
        "words.json",
    )


def _seconds(groups: tuple[str | None, ...]) -> float:
    hours, minutes, secs, frac = groups
    return int(hours or 0) * 3600 + int(minutes) * 60 + int(secs) + int(frac.ljust(3, "0")) / 1000


def _parse_cues(text: str, *, vtt: bool) -> list[tuple[float, float, str]]:
    cues: list[tuple[float, float, str]] = []
    blocks = re.split(r"\r?\n\s*\r?\n", text.strip())
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines or (
            vtt and lines[0].upper().startswith(("WEBVTT", "NOTE", "STYLE", "REGION"))
        ):
            continue
        for pos, line in enumerate(lines):
            match = _CUE_RE.search(line)
            if match:
                g = match.groups()
                start, end = _seconds(g[:4]), _seconds(g[4:])
                body = " ".join(_TAG_RE.sub("", ln).strip() for ln in lines[pos + 1 :]).strip()
                if body and end > start:
                    cues.append((round(start, 3), round(end, 3), body))
                break
    cues.sort(key=lambda c: c[0])
    return cues


def transcript_to_json(
    transcript: Transcript, *, source: str, provenance: dict[str, Any]
) -> dict[str, Any]:
    """Serialisable form stored as ``transcript.json`` next to the asset."""
    return {
        "source": source,
        "provider": transcript.provider,
        "model": transcript.model,
        "language": transcript.language,
        "words_estimated": transcript.words_estimated,
        "provenance": provenance,
        "words": [{"word": w.word, "start": w.start, "end": w.end} for w in transcript.words],
        "segments": [{"text": s.text, "start": s.start, "end": s.end} for s in transcript.segments],
    }
