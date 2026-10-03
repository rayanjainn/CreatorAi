"""Full ``asset.process`` runs on generated DEMO footage (inline jobs, sidecar ASR, stubbed LLM)."""

from __future__ import annotations

import io
import subprocess
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.db import session_scope
from app.models import Asset, AssetSegment, AssetShot, Job
from app.services.ingest import transcribe as transcribe_mod
from app.services.ingest.pipeline import STAGE_FUNCS
from app.services.ingest.plan import STAGE_PROGRESS, STAGES
from app.workers.runner import JobContext
from tests.helpers import (
    V1,
    Hdr,
    gemini_caption_reply,
    gemini_gateway,
    get_asset,
    install_gateway,
    upload_file,
    wipe_provider_keys,
)

FULL_VIDEO_STAGES = list(STAGES)


@pytest.fixture
def progress_log(monkeypatch: pytest.MonkeyPatch) -> list[tuple[int, str]]:
    """Record every ``ctx.progress(pct, stage)`` the pipeline reports."""
    seen: list[tuple[int, str]] = []
    original = JobContext.progress

    def spy(self: JobContext, pct: float, stage: str, message: str | None = None) -> None:
        seen.append((int(pct), stage))
        original(self, pct, stage, message)

    monkeypatch.setattr(JobContext, "progress", spy)
    return seen


def stage_names(seen: list[tuple[int, str]]) -> list[str]:
    out: list[str] = []
    for _, stage in seen:
        if not out or out[-1] != stage:
            out.append(stage)
    return out


def run_demo(client: TestClient, auth: Hdr, demo: Any, sidecar: bool = True) -> dict[str, Any]:
    body = upload_file(client, auth, demo.video, sidecar=demo.sidecar if sidecar else None)
    return get_asset(client, auth, body["asset"]["id"])


def test_full_pipeline_on_demo_video(
    client: TestClient, auth: Hdr, demo_media: Any, progress_log: list[tuple[int, str]]
) -> None:
    asset = run_demo(client, auth, demo_media)
    assert asset["status"] == "ready" and asset["error"] is None and asset["kind"] == "video"
    assert asset["duration_sec"] == pytest.approx(demo_media.duration, abs=0.3)
    assert (asset["width"], asset["height"], asset["fps"]) == (320, 180, 10.0)
    assert asset["stages_done"] == FULL_VIDEO_STAGES
    assert asset["job"]["status"] == "succeeded" and asset["job"]["progress"] == 100

    # progress map of Plan 3.3: every stage reports its cumulative value on completion
    reported = dict.fromkeys(STAGES, 0)
    for pct, stage in progress_log:
        reported[stage] = max(reported[stage], pct)
    assert reported == STAGE_PROGRESS
    assert stage_names(progress_log) == FULL_VIDEO_STAGES

    # media outputs
    assert Image.open(io.BytesIO(client.get(asset["urls"]["thumb"]).content)).size[0] <= 640
    assert client.get(asset["urls"]["proxy"], headers={"Range": "bytes=0-99"}).status_code == 206
    assert client.get(asset["urls"]["audio"]).status_code == 200
    assert client.get(asset["urls"]["original"]).status_code == 200

    # transcript from the demo sidecar (provenance demo), segmented per Plan 8.3
    assert asset["provenance_by_stage"]["transcribe"]["source"] == "demo"
    texts = [s["text"] for s in asset["segments"]]
    assert len(texts) >= 5 and texts[0].startswith("Here is how I edit a video")
    assert asset["analysis"]["asr"]["source"] == "sidecar"
    transcript = client.get(f"{V1}/assets/{asset['id']}/transcript", headers=auth).json()
    assert transcript["provenance"]["source"] == "demo" and transcript["segments"][0]["words"]

    # shots: 5 scenes from the generated colour cuts, keyframes <= 384 px
    shots = asset["shots"]
    assert asset["analysis"]["shots"]["method"] == "scenedetect" and len(shots) == 5
    detected = [s["start_sec"] for s in shots[1:]]
    assert detected == pytest.approx(demo_media.scene_cuts, abs=0.35)  # 10 fps frame rounding
    frame = Image.open(io.BytesIO(client.get(shots[0]["keyframe_url"]).content))
    assert max(frame.size) <= 384
    assert all(s["captioned"] for s in shots)

    # silences and energy from the deliberate pauses
    assert len(asset["analysis"]["silences"]) >= 6
    assert "energy" not in asset["analysis"]
    energy = get_asset(client, auth, asset["id"], include_energy="true")["analysis"]["energy"]
    assert (
        len(energy) >= int(demo_media.duration / 0.5) - 1 and min(energy) < -60 < max(energy) + 60
    )

    # provenance: sidecar=demo, mock captions (LLM_ALLOW_MOCK in tests), hashing embedder=heuristic
    prov = asset["provenance_by_stage"]
    assert prov["caption"]["source"] == "mock" and prov["embed"]["source"] == "heuristic"
    assert prov["shots"]["source"] == "heuristic"
    assert asset["provenance"]["source"] == "mock"  # weakest of the generated stages
    assert asset["description"].startswith("[MOCK]")
    assert asset["analysis"]["embedder"]["backend"] == "hashing"
    with session_scope() as db:
        assert all(s.embedding for s in db.scalars(select(AssetSegment)))
        assert all(s.embedding for s in db.scalars(select(AssetShot)) if s.tags)


def test_caption_with_real_provider_is_ai_provenance(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return gemini_caption_reply(request)

    install_gateway(monkeypatch, gemini_gateway(handler))
    asset = run_demo(client, auth, tiny_media)
    assert asset["status"] == "ready"
    assert len(requests) == 1  # ONE caption call for the whole video
    assert requests[0].content.count(b"inline_data") == 3  # one keyframe per shot (<= 12)
    prov = asset["provenance_by_stage"]
    assert prov["caption"] == {
        "source": "ai",
        "provider": "gemini",
        "model": prov["caption"]["model"],
    }
    assert asset["provenance"]["source"] == "heuristic"  # hashing embedder is the weakest link
    assert asset["tags"] == ["editing", "workflow", "tutorial"]
    assert asset["shots"][0]["caption"] == "Editing desk scene 0"
    assert asset["description"] == "A creator explains a video editing workflow."


def test_caption_skipped_gracefully_without_llm(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    wipe_provider_keys(monkeypatch, allow_mock=False)
    asset = run_demo(client, auth, tiny_media)
    assert asset["status"] == "ready"  # the asset is NOT failed
    assert "caption: skipped (llm unavailable)" in asset["stages_done"]
    assert "caption" not in asset["stages_done"] and "embed" in asset["stages_done"]
    warning = asset["warnings"][0]
    assert warning["code"] == "CAPTIONS_UNAVAILABLE" and "GEMINI_API_KEY" in warning["message"]
    assert "caption" not in asset["provenance_by_stage"]  # provenance absent, nothing fabricated
    assert asset["description"] == "" and asset["tags"] == []
    assert all(s["caption"] == "" and not s["captioned"] for s in asset["shots"])

    # a plain reprocess retries the skipped stage once an LLM is available
    monkeypatch.setattr(
        __import__("app.config", fromlist=["x"]).get_settings(), "llm_allow_mock", True
    )
    from app.llm.gateway import reset_gateway

    reset_gateway()
    res = client.post(f"{V1}/assets/{asset['id']}/reprocess", headers=auth)
    assert res.status_code == 202
    again = get_asset(client, auth, asset["id"])
    assert "caption" in again["stages_done"] and again["warnings"] == []
    assert again["provenance_by_stage"]["caption"]["source"] == "mock"


def test_asr_unavailable_then_attach_transcript_resumes(
    client: TestClient,
    auth: Hdr,
    tiny_media: Any,
    monkeypatch: pytest.MonkeyPatch,
    progress_log: list[tuple[int, str]],
) -> None:
    monkeypatch.setattr(transcribe_mod, "get_asr_chain", lambda: [])
    asset = run_demo(client, auth, tiny_media, sidecar=False)
    assert asset["status"] == "failed"
    assert asset["analysis"]["error_code"] == "ASR_UNAVAILABLE"
    assert asset["analysis"]["failed_stage"] == "transcribe"
    for hint in ("GROQ_API_KEY", "make models-asr", ".srt"):
        assert hint in asset["error"]
    assert asset["stages_done"] == ["probe", "audio", "proxy", "silence"]
    assert asset["segments"] == [] and asset["job"]["status"] == "failed"
    with session_scope() as db:
        job = db.scalars(select(Job).where(Job.entity_id == asset["id"])).one()
        assert job.attempts == 1  # ASR_UNAVAILABLE is not retried
    assert client.get(f"{V1}/assets/{asset['id']}/transcript", headers=auth).status_code == 404

    progress_log.clear()
    words = tiny_media.sidecar.read_text()
    res = client.put(f"{V1}/assets/{asset['id']}/transcript", content=words, headers=auth)
    assert res.status_code == 202, res.text
    resumed = get_asset(client, auth, asset["id"])
    assert resumed["status"] == "ready" and resumed["error"] is None
    assert stage_names(progress_log)[0] == "transcribe"  # probe/audio/proxy/silence were not redone
    assert resumed["analysis"]["asr"]["source"] == "sidecar"
    assert "failed_stage" not in resumed["analysis"]


def test_asr_chain_provider_is_ai_provenance(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import Settings
    from app.ml.asr import GroqASR

    seen: list[httpx.Request] = []

    def groq(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        words = [
            {"word": w, "start": 0.5 + i * 0.4, "end": 0.8 + i * 0.4}
            for i, w in enumerate("here is how I edit a video from start to finish".split())
        ]
        return httpx.Response(
            200,
            json={"language": "en", "duration": 6.0, "text": "x", "segments": [], "words": words},
        )

    provider = GroqASR(
        Settings(GROQ_API_KEY="gk", _env_file=None),  # type: ignore[call-arg]
        httpx.Client(transport=httpx.MockTransport(groq)),
    )
    monkeypatch.setattr(transcribe_mod, "get_asr_chain", lambda: [provider])
    asset = run_demo(client, auth, tiny_media, sidecar=False)
    assert asset["status"] == "ready" and len(seen) == 1  # one chunk (< 600 s)
    prov = asset["provenance_by_stage"]["transcribe"]
    assert prov == {"source": "ai", "provider": "groq", "model": "whisper-large-v3-turbo"}
    assert asset["analysis"]["asr"]["source"] == "asr" and asset["segments"][0]["text"].startswith(
        "here is"
    )


def test_reprocess_from_stage_reruns_only_downstream(
    client: TestClient, auth: Hdr, tiny_media: Any, progress_log: list[tuple[int, str]]
) -> None:
    asset = run_demo(client, auth, tiny_media)
    progress_log.clear()
    res = client.post(f"{V1}/assets/{asset['id']}/reprocess", json={"stage": "embed"}, headers=auth)
    assert res.status_code == 202 and res.json()["job_id"]
    assert stage_names(progress_log) == ["embed", "finalize"]
    progress_log.clear()
    client.post(f"{V1}/assets/{asset['id']}/reprocess", json={"stage": "shots"}, headers=auth)
    assert stage_names(progress_log) == ["shots", "keyframes", "caption", "embed", "finalize"]
    assert (
        client.post(
            f"{V1}/assets/{asset['id']}/reprocess", json={"stage": "nope"}, headers=auth
        ).status_code
        == 422
    )
    progress_log.clear()
    client.post(f"{V1}/assets/{asset['id']}/reprocess", headers=auth)  # nothing missing
    assert stage_names(progress_log) == []


def test_embedder_change_triggers_reembed_on_reprocess(
    client: TestClient, auth: Hdr, tiny_media: Any, progress_log: list[tuple[int, str]]
) -> None:
    asset = run_demo(client, auth, tiny_media)
    with session_scope() as db:
        row = db.get(Asset, asset["id"])
        assert row is not None
        analysis = dict(row.analysis)
        analysis["embedder"] = {**analysis["embedder"], "backend": "fastembed", "model": "other"}
        row.analysis = analysis
    progress_log.clear()
    client.post(f"{V1}/assets/{asset['id']}/reprocess", headers=auth)
    assert stage_names(progress_log) == ["embed", "finalize"]
    assert get_asset(client, auth, asset["id"])["analysis"]["embedder"]["backend"] == "hashing"


def test_cancel_between_stages_then_resume(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = STAGE_FUNCS["shots"]

    def cancel_after_shots(run: Any) -> None:
        original(run)
        run.job._cancel.set()  # the user pressed cancel while shots was running

    monkeypatch.setitem(STAGE_FUNCS, "shots", cancel_after_shots)
    asset = run_demo(client, auth, tiny_media)
    assert asset["status"] == "uploaded" and asset["error"] == "Processing canceled"
    assert asset["job"]["status"] == "canceled"
    assert asset["stages_done"][-1] == "shots" and "keyframes" not in asset["stages_done"]
    monkeypatch.setitem(STAGE_FUNCS, "shots", original)
    client.post(f"{V1}/assets/{asset['id']}/reprocess", headers=auth)
    done = get_asset(client, auth, asset["id"])
    assert done["status"] == "ready" and done["stages_done"] == FULL_VIDEO_STAGES


def test_corrupt_media_fails_at_probe_with_message(
    client: TestClient, auth: Hdr, tmp_path: Path
) -> None:
    bad = tmp_path / "broken.mp4"
    bad.write_bytes(b"this is not a video at all" * 20)
    asset = get_asset(client, auth, upload_file(client, auth, bad)["asset"]["id"])
    assert asset["status"] == "failed" and "corrupt or unsupported" in asset["error"]
    assert (
        asset["analysis"]["failed_stage"] == "probe"
        and asset["analysis"]["error_code"] == "MEDIA_FAILED"
    )
    assert asset["job"]["status"] == "failed"


def test_unexpected_stage_error_marks_asset_failed(
    client: TestClient, auth: Hdr, tiny_media: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(run: Any) -> None:
        raise RuntimeError("disk exploded")

    monkeypatch.setitem(STAGE_FUNCS, "proxy", boom)
    asset = run_demo(client, auth, tiny_media)
    assert asset["status"] == "failed" and "disk exploded" in asset["error"]
    assert asset["analysis"]["failed_stage"] == "proxy" and asset["stages_done"] == [
        "probe",
        "audio",
    ]


def test_text_document_and_stored_only_document(
    client: TestClient, auth: Hdr, tmp_path: Path
) -> None:
    note = tmp_path / "notes.md"
    note.write_text("# Shoot notes\nBring the tripod.", encoding="utf-8")
    asset = get_asset(client, auth, upload_file(client, auth, note)["asset"]["id"])
    assert asset["status"] == "ready" and asset["analysis"]["text"].startswith("# Shoot notes")
    assert asset["stages_done"] == ["probe", "finalize"] and asset["segments"] == []
    pdf = tmp_path / "brief.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    stored = get_asset(client, auth, upload_file(client, auth, pdf)["asset"]["id"])
    assert stored["status"] == "ready" and stored["analysis"]["stored_only"] is True


def test_image_gets_thumb_shot_caption_and_embedding(
    client: TestClient, auth: Hdr, tmp_path: Path
) -> None:
    img = tmp_path / "poster.png"
    Image.new("RGB", (800, 600), (200, 30, 30)).save(img)
    asset = get_asset(client, auth, upload_file(client, auth, img)["asset"]["id"])
    assert asset["status"] == "ready" and asset["kind"] == "image"
    assert (asset["width"], asset["height"], asset["duration_sec"]) == (800, 600, None)
    assert asset["stages_done"] == ["probe", "keyframes", "caption", "embed", "finalize"]
    assert (
        len(asset["shots"]) == 1
        and asset["shots"][0]["keyframe_url"]
        and asset["shots"][0]["caption"]
    )
    assert asset["thumb_url"] and asset["provenance_by_stage"]["caption"]["source"] == "mock"
    with session_scope() as db:
        assert db.scalars(select(AssetShot)).one().embedding is not None


def test_audio_only_asset_skips_video_stages(
    client: TestClient, auth: Hdr, tiny_media: Any, tmp_path: Path
) -> None:
    audio = tmp_path / "voiceover.mp3"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(tiny_media.video),
            "-vn",
            "-c:a",
            "libmp3lame",
            str(audio),
        ],
        check=True,
    )
    asset = get_asset(
        client, auth, upload_file(client, auth, audio, sidecar=tiny_media.sidecar)["asset"]["id"]
    )
    assert asset["status"] == "ready" and asset["kind"] == "audio"
    assert asset["stages_done"] == [
        "probe",
        "audio",
        "silence",
        "transcribe",
        "segments",
        "embed",
        "finalize",
    ]
    assert asset["shots"] == [] and asset["thumb_url"] is None and asset["urls"]["proxy"] is None
    assert len(asset["segments"]) >= 1 and asset["width"] is None


def test_video_without_audio_track_skips_asr(client: TestClient, auth: Hdr, tmp_path: Path) -> None:
    silent = tmp_path / "silent.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=s=160x90:d=3:r=25",
            "-c:v",
            "libx264",
            str(silent),
        ],
        check=True,
    )
    asset = get_asset(client, auth, upload_file(client, auth, silent)["asset"]["id"])
    assert asset["status"] == "ready" and asset["analysis"]["probe"]["has_audio"] is False
    assert asset["stages_done"] == [
        "probe",
        "proxy",
        "shots",
        "keyframes",
        "caption",
        "embed",
        "finalize",
    ]
