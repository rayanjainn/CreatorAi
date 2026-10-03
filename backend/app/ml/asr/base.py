"""ASR provider interface and transcript types (Plan.md section 8.2)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from app.schemas.common import Provenance


class ASRError(Exception):
    """Transcription failed; ``retryable`` marks 429/5xx and network errors."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        retry_after: float | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after
        self.retryable = retryable


@dataclass(frozen=True)
class Word:
    word: str
    start: float
    end: float


@dataclass(frozen=True)
class Segment:
    text: str
    start: float
    end: float


@dataclass
class Transcript:
    """Words and segments in seconds from the start of the *original* audio (offset applied)."""

    provider: str
    model: str
    language: str | None
    words: list[Word] = field(default_factory=list)
    segments: list[Segment] = field(default_factory=list)
    duration: float = 0.0
    words_estimated: bool = False  # True when word times were interpolated from segments

    @property
    def text(self) -> str:
        return " ".join(s.text.strip() for s in self.segments if s.text.strip())

    @property
    def provenance(self) -> Provenance:
        return Provenance(source="ai", provider=self.provider, model=self.model)


class ASRProvider(ABC):
    name: str

    @abstractmethod
    def configured(self) -> bool:
        """Whether this provider can be used right now."""

    @property
    @abstractmethod
    def model(self) -> str: ...

    @abstractmethod
    def transcribe(
        self, audio_path: Path, *, language: str | None = None, offset_sec: float = 0.0
    ) -> Transcript:
        """Transcribe one audio file (chunk). ``offset_sec`` is added to every timestamp."""


def interpolate_words(segments: list[Segment]) -> list[Word]:
    """Plan 8.2 step 4: split segments on whitespace, times proportional to character length."""
    words: list[Word] = []
    for seg in segments:
        tokens = seg.text.split()
        total = sum(len(t) for t in tokens)
        if not tokens or total == 0:
            continue
        cursor, span = seg.start, max(0.0, seg.end - seg.start)
        for token in tokens:
            end = cursor + span * len(token) / total
            words.append(Word(token, round(cursor, 3), round(end, 3)))
            cursor = end
    return words
