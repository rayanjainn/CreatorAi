"""ASR providers with fake transports and stubbed model loaders (no network, no model files)."""

from __future__ import annotations

import itertools
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import numpy as np
import pytest

from app.config import Settings
from app.ml.asr import ASRError, GroqASR, LocalASR, get_asr_chain
from app.ml.asr.base import Segment, interpolate_words
from app.ml.asr.local import decode_pcm16k
from app.ml.models import preload_asr, preload_embedder


def cfg(tmp_path: Path, **kw: Any) -> Settings:
    return Settings(DATA_DIR=str(tmp_path), _env_file=None, **kw)  # type: ignore[call-arg]


def audio(tmp_path: Path) -> Path:
    path = tmp_path / "chunk.mp3"
    path.write_bytes(b"ID3fake-audio")
    return path


VERBOSE = {
    "language": "en",
    "duration": 4.0,
    "text": "hello world again",
    "segments": [
        {"start": 0.0, "end": 2.0, "text": " hello world"},
        {"start": 2.0, "end": 4.0, "text": " again"},
    ],
    "words": [
        {"word": "hello", "start": 0.0, "end": 0.9},
        {"word": "world", "start": 1.0, "end": 1.9},
        {"word": "again", "start": 2.1, "end": 3.9},
    ],
}


def test_groq_multipart_request_and_offset(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return httpx.Response(200, json=VERBOSE)

    p = GroqASR(
        cfg(tmp_path, GROQ_API_KEY="gk"), httpx.Client(transport=httpx.MockTransport(handler))
    )
    t = p.transcribe(audio(tmp_path), language="en", offset_sec=600.0)
    r = seen[0]
    assert str(r.url) == "https://api.groq.com/openai/v1/audio/transcriptions"
    assert r.headers["authorization"] == "Bearer gk"
    assert r.headers["content-type"].startswith("multipart/form-data")
    body = r.content.decode("latin-1")
    for needle in ("whisper-large-v3-turbo", "verbose_json", "timestamp_granularities[]", "word",
                   "segment", 'name="temperature"', 'name="language"', 'filename="chunk.mp3"'):  # fmt: skip
        assert needle in body, needle
    assert t.language == "en" and t.provider == "groq" and not t.words_estimated
    assert t.words[0].start == 600.0 and t.words[-1].end == pytest.approx(603.9)
    assert t.segments[1].start == 602.0 and t.text == "hello world again"
    assert t.provenance.source == "ai" and t.provenance.provider == "groq"


def test_groq_omits_language_when_auto(tmp_path: Path) -> None:
    seen: list[bytes] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r.content)
        return httpx.Response(200, json=VERBOSE)

    p = GroqASR(
        cfg(tmp_path, GROQ_API_KEY="gk"), httpx.Client(transport=httpx.MockTransport(handler))
    )
    p.transcribe(audio(tmp_path))
    assert b'name="language"' not in seen[0]


def test_groq_interpolates_words_when_missing(tmp_path: Path) -> None:
    body = {**VERBOSE, "words": []}
    p = GroqASR(cfg(tmp_path, GROQ_API_KEY="gk"),
                httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))))  # fmt: skip
    t = p.transcribe(audio(tmp_path))
    assert t.words_estimated and [w.word for w in t.words] == ["hello", "world", "again"]
    assert t.words[0].start == 0.0 and t.words[1].end == pytest.approx(2.0)
    assert t.words[0].end == pytest.approx(1.0)  # 5 of 10 chars of a 2 s segment


def test_interpolate_words_proportional_to_chars() -> None:
    words = interpolate_words([Segment("ab cdef", 10.0, 16.0)])
    assert [(w.word, w.start, w.end) for w in words] == [("ab", 10.0, 12.0), ("cdef", 12.0, 16.0)]


@pytest.mark.parametrize(("status", "retryable"), [(429, True), (500, True), (401, False)])
def test_groq_asr_errors(tmp_path: Path, status: int, retryable: bool) -> None:
    p = GroqASR(cfg(tmp_path, GROQ_API_KEY="gk"),
                httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(status, text="x"))))  # fmt: skip
    with pytest.raises(ASRError) as exc:
        p.transcribe(audio(tmp_path))
    assert exc.value.retryable is retryable and exc.value.status == status


def test_groq_asr_non_json_body(tmp_path: Path) -> None:
    p = GroqASR(cfg(tmp_path, GROQ_API_KEY="gk"),
                httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text="oops"))))  # fmt: skip
    with pytest.raises(ASRError, match="non-JSON"):
        p.transcribe(audio(tmp_path))


def test_local_whisper_with_stub_model(tmp_path: Path) -> None:
    calls: dict[str, Any] = {}
    seg = SimpleNamespace(
        text=" hi there ", start=0.5, end=1.5,
        words=[SimpleNamespace(word=" hi", start=0.5, end=0.9), SimpleNamespace(word=" there", start=1.0, end=1.5)],
    )  # fmt: skip

    class Model:
        def transcribe(self, path: Any, **kw: Any) -> Any:
            calls.update(kw, path=path)
            return iter([seg]), SimpleNamespace(language="en", duration=2.0)

    loads: list[str] = []

    def loader(name: str) -> Model:
        loads.append(name)
        return Model()

    pcm = np.zeros(16000, dtype=np.float32)
    p = LocalASR(cfg(tmp_path, WHISPER_LOCAL_MODEL="base"), loader, decoder=lambda _p: pcm)
    t = p.transcribe(audio(tmp_path), offset_sec=10.0)
    p.transcribe(audio(tmp_path))
    assert loads == ["base"]  # model loaded once
    assert calls["path"] is pcm  # decoded by us, never by PyAV
    assert (
        calls["word_timestamps"] is True
        and calls["vad_filter"] is True
        and calls["language"] is None
    )
    assert [w.word for w in t.words] == ["hi", "there"] and t.words[0].start == 10.5
    assert (
        t.segments[0].text == "hi there" and t.provider == "faster-whisper" and t.language == "en"
    )


def test_local_whisper_load_failure_is_actionable(tmp_path: Path) -> None:
    def loader(name: str) -> Any:
        raise OSError("offline")

    with pytest.raises(ASRError, match="make models"):
        LocalASR(cfg(tmp_path), loader).transcribe(audio(tmp_path))


def test_asr_chain_follows_config(tmp_path: Path) -> None:
    names = lambda **kw: [p.name for p in get_asr_chain(cfg(tmp_path, **kw))]  # noqa: E731
    assert names(GROQ_API_KEY="k") == ["groq", "faster-whisper"]
    assert names() == ["faster-whisper"]
    assert names(ASR_PROVIDER="groq") == []
    assert names(ASR_PROVIDER="groq", GROQ_API_KEY="k") == ["groq"]
    assert names(ASR_PROVIDER="faster-whisper", GROQ_API_KEY="k") == ["faster-whisper"]
    assert names(ASR_PROVIDER="none", GROQ_API_KEY="k") == []


# ── model preloading (stubbed downloaders) ───────────────────────────────────────────────────
def test_preload_helpers_use_stubs(tmp_path: Path) -> None:
    class Enc:
        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[0.0] * 384 for _ in texts]

    seen: list[str] = []

    def loader(model: str) -> Enc:
        seen.append(model)
        return Enc()

    msg = preload_embedder(cfg(tmp_path), loader)
    assert seen == ["sentence-transformers/all-MiniLM-L6-v2"] and "384-d" in msg
    assert "small" in preload_asr(None, cfg(tmp_path), lambda n: f"/cache/{n}")
    assert "base" in preload_asr("base", cfg(tmp_path), lambda n: f"/cache/{n}")


def test_download_script_reports_failure_offline(
    monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    import importlib.util

    from app.config import BACKEND_ROOT

    spec = importlib.util.spec_from_file_location(
        "download_models", BACKEND_ROOT / "scripts/download_models.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    def offline() -> str:
        raise ConnectionError("no network")

    monkeypatch.setattr(mod, "preload_embedder", offline)
    assert mod.main([]) == 1
    err = capsys.readouterr().err
    assert "FAILED" in err and "make models" in err
    monkeypatch.setattr(mod, "preload_embedder", lambda: "embedder ready")
    assert mod.main([]) == 0
    monkeypatch.setattr(mod, "preload_asr", lambda name=None: f"asr ready {name}")
    assert mod.main(["--asr", "--asr-model", "base"]) == 0
    assert "asr ready base" in capsys.readouterr().out


def test_decode_pcm16k_real_ffmpeg(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", str(wav)],
        check=True,
    )
    pcm = decode_pcm16k(wav)
    assert (
        pcm.dtype == np.float32 and abs(len(pcm) - 24000) < 800 and float(np.abs(pcm).max()) > 0.1
    )


def test_decode_pcm16k_bad_file_is_asr_error(tmp_path: Path) -> None:
    bad = tmp_path / "bad.wav"
    bad.write_bytes(b"not audio")
    with pytest.raises(ASRError, match="could not decode audio"):
        decode_pcm16k(bad)


def test_spoken_order_keeps_the_sentence_when_whisper_times_run_backwards() -> None:
    """Real Groq Whisper output: "speak" got the start of "the", which a time sort turned into
    "the speak time when we up"."""
    from app.ml.asr.base import Word
    from app.services.ingest.transcribe import spoken_order

    raw = [
        Word("Most", 78.818, 79.038), Word("of", 79.038, 79.178), Word("the", 79.178, 79.198),
        Word("time", 79.198, 79.358), Word("when", 79.358, 79.518), Word("we", 79.518, 79.618),
        Word("speak", 79.178, 79.978), Word("up,", 79.978, 80.318),
    ]  # fmt: skip
    out = spoken_order(raw)
    assert " ".join(w.word for w in out) == "Most of the time when we speak up,"
    assert all(a.start <= b.start and a.end <= b.start for a, b in itertools.pairwise(out))
    assert out[6].start == 79.518 and out[6].end == 79.978  # repaired, not dropped
    assert spoken_order([]) == []
