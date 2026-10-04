"""Local ``faster-whisper`` (CTranslate2) transcription; the model downloads on first use."""

from __future__ import annotations

import importlib.util
import subprocess
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from app.config import Settings
from app.ml.asr.base import ASRError, ASRProvider, Segment, Transcript, Word


def _load_model(name: str) -> Any:
    from faster_whisper import WhisperModel

    return WhisperModel(name, device="cpu", compute_type="int8")


def decode_pcm16k(path: Path, ffmpeg_bin: str = "ffmpeg") -> np.ndarray:
    """Decode any audio file to 16 kHz mono float32 with our own ffmpeg.

    faster-whisper would otherwise decode with PyAV (``av.open``), whose signature differs across
    versions and platforms (``unexpected keyword argument 'metadata_errors'``). Handing it a
    ready-made array removes that dependency on the PyAV/FFmpeg build entirely.
    """
    cmd = [ffmpeg_bin, "-nostdin", "-v", "error", "-i", str(path)]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=1800, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ASRError(f"could not decode audio with ffmpeg ({exc})") from exc
    if proc.returncode != 0 or not proc.stdout:
        detail = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or ["no output"]
        raise ASRError(f"could not decode audio with ffmpeg: {detail[0]}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


class LocalASR(ASRProvider):
    name = "faster-whisper"

    def __init__(
        self,
        settings: Settings,
        loader: Callable[[str], Any] = _load_model,
        decoder: Callable[[Path], np.ndarray] | None = None,
    ) -> None:
        self._settings = settings
        self._loader = loader
        self._decoder = decoder or (lambda p: decode_pcm16k(p, settings.ffmpeg_bin))
        self._model: Any = None
        self._lock = threading.Lock()

    def configured(self) -> bool:
        return importlib.util.find_spec("faster_whisper") is not None

    @property
    def model(self) -> str:
        return self._settings.whisper_local_model

    def _get_model(self) -> Any:
        with self._lock:
            if self._model is None:
                try:
                    self._model = self._loader(self.model)
                except Exception as exc:  # offline first run, corrupt cache, missing runtime
                    raise ASRError(
                        f"could not load faster-whisper model {self.model!r} ({exc}); "
                        "run `make models` while online"
                    ) from exc
            return self._model

    def transcribe(
        self, audio_path: Path, *, language: str | None = None, offset_sec: float = 0.0
    ) -> Transcript:
        model = self._get_model()
        language = language if language is not None else self._settings.asr_language
        audio = self._decoder(audio_path)
        try:
            seg_iter, info = model.transcribe(
                audio,
                language=None if not language or language == "auto" else language,
                word_timestamps=True,
                vad_filter=True,
            )
            segments: list[Segment] = []
            words: list[Word] = []
            for seg in seg_iter:  # generator: decoding happens here
                segments.append(
                    Segment(seg.text.strip(), seg.start + offset_sec, seg.end + offset_sec)
                )
                words += [
                    Word(w.word.strip(), w.start + offset_sec, w.end + offset_sec)
                    for w in seg.words or []
                ]
        except Exception as exc:
            raise ASRError(f"faster-whisper failed: {exc}") from exc
        return Transcript(
            provider=self.name,
            model=self.model,
            language=getattr(info, "language", None),
            words=words,
            segments=segments,
            duration=float(getattr(info, "duration", 0.0) or 0.0),
        )
