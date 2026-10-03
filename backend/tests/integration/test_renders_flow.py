"""render.run end to end: real ffmpeg on generated demo footage (small sources, ultrafast)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageChops

from app.config import get_settings
from app.db import session_scope
from app.media import ffmpeg as ffm
from app.models import ActivityLog, Asset, Job, Render
from app.schemas.timeline import (
    AudioItem,
    CaptionItem,
    CaptionWord,
    OverlayItem,
    Timeline,
    Transition,
    VideoItem,
)
from app.services import render_service
from tests.helpers import V1, Hdr
from tests.integration.test_clips_flow import generate, ready_item


def ffprobe(path: Path) -> dict[str, Any]:
    out = subprocess.run(
        [get_settings().ffprobe_bin, "-v", "error", "-print_format", "json", "-show_streams",
         "-show_format", str(path)],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    data: dict[str, Any] = json.loads(out.stdout)
    return data


def v(n: int, a: float, b: float, start: float, asset: str | None, **kw: Any) -> VideoItem:
    return VideoItem(
        id=f"v_{n}", source="user", status="accepted", asset_id=asset, src_in=a, src_out=b,
        tl_start=start, **kw,
    )  # fmt: skip


def cap(n: int, a: float, b: float, text: str, **kw: Any) -> CaptionItem:
    toks = text.split()
    step = (b - a) / len(toks)
    words = [
        CaptionWord(w=t, t0=round(a + i * step, 3), t1=round(a + (i + 1) * step, 3))
        for i, t in enumerate(toks)
    ]
    return CaptionItem(
        id=f"c_{n}", source="user", status="accepted", tl_start=a, tl_end=b, text=text,
        words=words, **kw,
    )  # fmt: skip


def show_timeline(asset_id: str) -> tuple[Timeline, float]:
    """3 s + 3 s (fade 0.4) + 2 s sponsor placeholder + 2 s (dissolve 0.3), with every layer."""
    tl = Timeline.empty("9:16", "bold_center")
    sponsor = VideoItem(
        id="v_s", source="user", status="accepted", kind="sponsor", placeholder=True,
        text="Brought to you by Acme", asset_id=None, src_in=0, src_out=2, tl_start=6.0,
    )  # fmt: skip
    tl.tracks.video = [
        v(1, 1.0, 4.0, 0.0, asset_id),
        v(2, 5.0, 8.0, 3.0, asset_id, transition_in=Transition(type="fade", dur=0.4)),
        sponsor,
        v(3, 12.0, 14.0, 8.0, asset_id, transition_in=Transition(type="dissolve", dur=0.3)),
    ]
    tl.duration = 10.0
    tl.tracks.captions = [
        cap(1, 0.2, 2.0, "here is how I edit"),
        cap(2, 3.2, 5.0, "next I trim the dead air"),
        cap(3, 6.2, 7.8, "sponsor words here"),
    ]
    tl.tracks.overlays = [
        OverlayItem(id="o_1", source="user", status="accepted", kind="lower_third",
                    tl_start=0.5, tl_end=2.5, text="Demo footage"),
    ]  # fmt: skip
    tl.tracks.audio = [
        AudioItem(id="a_1", source="user", status="accepted", kind="sfx", asset_id=asset_id,
                  src_in=0.0, src_out=4.0, tl_start=1.0, gain_db=-12),
    ]  # fmt: skip
    return tl, 10.0 - 0.4 - 0.3


def put_timeline(client: TestClient, auth: Hdr, clip_id: str, tl: Timeline) -> int:
    edit = client.get(f"{V1}/clips/{clip_id}/edit", headers=auth).json()
    res = client.put(
        f"{V1}/clips/{clip_id}/edit",
        json={"timeline": tl.dump(), "base_revision": edit["revision"], "note": "test show"},
        headers=auth,
    )
    assert res.status_code == 200, res.text
    return int(res.json()["revision"])


@pytest.fixture
def clip(client: TestClient, auth: Hdr, demo_media: Any, workspace_id: str) -> dict[str, str]:
    item, asset_id = ready_item(client, auth, demo_media, workspace_id)
    generate(client, auth, item, count=1)
    clip_id = client.get(f"{V1}/content/{item}/clips", headers=auth).json()[0]["id"]
    return {"item": item, "asset": asset_id, "clip": clip_id}


def request_render(
    client: TestClient, auth: Hdr, clip_id: str, preset: str, **body: Any
) -> dict[str, Any]:
    res = client.post(
        f"{V1}/clips/{clip_id}/renders", json={"preset": preset, **body}, headers=auth
    )
    assert res.status_code == 202, res.text
    out: dict[str, Any] = res.json()
    return out


def test_render_9x16_with_captions_transitions_sponsor_card_and_audio(
    client: TestClient, auth: Hdr, clip: dict[str, str], data_dir: Path
) -> None:
    tl, expected = show_timeline(clip["asset"])
    revision = put_timeline(client, auth, clip["clip"], tl)

    created = request_render(client, auth, clip["clip"], "tiktok")  # karaoke by default
    job = client.get(f"{V1}/jobs/{created['job_id']}", headers=auth).json()
    assert job["status"] == "succeeded", job
    done = client.get(f"{V1}/renders/{created['render']['id']}", headers=auth).json()
    assert done["status"] == "done" and done["preset"] == "tiktok"
    assert done["caption_style"] == "karaoke" and done["edit_revision"] == revision
    assert done["publishable"] is False and done["stale"] is False
    assert done["duration_sec"] == pytest.approx(expected, abs=0.2)
    assert done["job_id"] == created["job_id"] and done["size_bytes"] > 10_000

    probed = ffprobe(data_dir / f"renders/{done['id']}.mp4")
    video = next(s for s in probed["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert any(s["codec_type"] == "audio" for s in probed["streams"])
    assert float(probed["format"]["duration"]) == pytest.approx(expected, abs=0.2)
    assert (data_dir / f"renders/{done['id']}.jpg").stat().st_size > 1000

    # signed URLs: inline preview and an attachment variant of the same file
    preview = client.get(done["preview_url"], headers={"Range": "bytes=0-99"})
    assert preview.status_code == 206 and "content-disposition" not in preview.headers
    download = client.get(done["download_url"], headers={"Range": "bytes=0-99"})
    assert download.headers["content-disposition"].startswith('attachment; filename="')
    assert download.headers["content-disposition"].endswith('-tiktok.mp4"')
    assert client.get(done["thumbnail_url"]).headers["content-type"] == "image/jpeg"

    listed = client.get(f"{V1}/clips/{clip['clip']}/renders", headers=auth).json()
    by_item = client.get(f"{V1}/content/{clip['item']}/renders", headers=auth).json()
    assert [r["id"] for r in listed] == [r["id"] for r in by_item] == [done["id"]]
    assert by_item[0]["clip_title"]
    with session_scope() as db:
        log = db.query(ActivityLog).filter(ActivityLog.action == "render_done").one()
        assert log.entity_id == done["id"] and log.meta["preset"] == "tiktok"
        assert not (get_settings().tmp_dir / "renders" / done["id"]).exists()  # workdir cleaned

    # editing afterwards marks the render stale but does not touch the file
    tl.caption_style = "minimal_bottom"
    put_timeline(client, auth, clip["clip"], tl)
    assert client.get(f"{V1}/renders/{done['id']}", headers=auth).json()["stale"] is True

    assert client.delete(f"{V1}/renders/{done['id']}", headers=auth).status_code == 204
    assert not (data_dir / f"renders/{done['id']}.mp4").exists()
    assert client.get(f"{V1}/renders/{done['id']}", headers=auth).status_code == 404


def test_list_all_renders_with_status_filter(
    client: TestClient, auth: Hdr, clip: dict[str, str]
) -> None:
    assert client.get(f"{V1}/renders", headers=auth).json() == []
    created = request_render(client, auth, clip["clip"], "reels")
    rid = created["render"]["id"]
    everything = client.get(f"{V1}/renders", headers=auth).json()
    assert [r["id"] for r in everything] == [rid]
    assert everything[0]["clip_title"] and everything[0]["content_item_id"] == clip["item"]
    done = client.get(f"{V1}/renders", params={"status": "done"}, headers=auth).json()
    assert [r["id"] for r in done] == [rid] and done[0]["download_url"]
    assert client.get(f"{V1}/renders", params={"status": "failed"}, headers=auth).json() == []
    assert client.get(f"{V1}/renders", params={"status": "nope"}, headers=auth).status_code == 422
    assert client.get(f"{V1}/renders").status_code == 401


def test_render_16x9_minimal_captions_from_the_generated_clip(
    client: TestClient, auth: Hdr, clip: dict[str, str], data_dir: Path
) -> None:
    """Renders the AI-generated clip untouched; its 9:16 timeline is retargeted to 16:9."""
    stored = client.get(f"{V1}/clips/{clip['clip']}", headers=auth).json()
    created = request_render(client, auth, clip["clip"], "yt_long")
    done = client.get(f"{V1}/renders/{created['render']['id']}", headers=auth).json()
    assert done["status"] == "done", done
    assert done["caption_style"] == "minimal_bottom" and done["publishable"] is True
    probed = ffprobe(data_dir / f"renders/{done['id']}.mp4")
    video = next(s for s in probed["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1920, 1080)
    assert any(s["codec_type"] == "audio" for s in probed["streams"])
    assert float(probed["format"]["duration"]) == pytest.approx(
        stored["timeline_duration"], abs=0.2
    )


def test_render_16x9_with_a_transition_and_sponsor_card(
    client: TestClient, auth: Hdr, clip: dict[str, str], data_dir: Path
) -> None:
    tl, expected = show_timeline(clip["asset"])
    put_timeline(client, auth, clip["clip"], tl)
    created = request_render(client, auth, clip["clip"], "yt_long", caption_style="bold_center")
    done = client.get(f"{V1}/renders/{created['render']['id']}", headers=auth).json()
    assert done["status"] == "done", done
    probed = ffprobe(data_dir / f"renders/{done['id']}.mp4")
    video = next(s for s in probed["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1920, 1080)
    assert float(probed["format"]["duration"]) == pytest.approx(expected, abs=0.2)


def test_request_validation_duration_cap_and_asset_state(
    client: TestClient, auth: Hdr, clip: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    clip_id = clip["clip"]
    long = Timeline.empty("9:16", "bold_center")
    # the demo asset is only ~45 s long: save as two items from different ranges instead
    long.tracks.video = [v(1, 0.0, 40.0, 0.0, clip["asset"]), v(2, 2.0, 27.0, 40.0, clip["asset"])]
    long.duration = 65.0
    put_timeline(client, auth, clip_id, long)
    res = client.post(f"{V1}/clips/{clip_id}/renders", json={"preset": "yt_short"}, headers=auth)
    assert res.status_code == 422, res.text
    err = res.json()["error"]
    assert err["code"] == "DURATION_EXCEEDS_PRESET" and err["details"]["max_duration"] == 60.0
    assert err["details"]["duration"] == 65.0
    monkeypatch.setattr(render_service, "enqueue", lambda *a, **k: "job-stub")  # no real render
    reels = client.post(f"{V1}/clips/{clip_id}/renders", json={"preset": "reels"}, headers=auth)
    assert reels.status_code == 202  # the 90 s cap fits
    assert reels.json()["render"]["status"] == "queued"

    bad = client.post(f"{V1}/clips/{clip_id}/renders", json={"preset": "vimeo"}, headers=auth)
    assert bad.status_code == 422
    assert (
        client.post(f"{V1}/clips/nope/renders", json={"preset": "reels"}, headers=auth).status_code
        == 404
    )
    assert client.get(f"{V1}/renders/nope", headers=auth).status_code == 404
    assert client.get(f"{V1}/content/nope/renders", headers=auth).status_code == 404
    assert client.get(f"{V1}/clips/nope/renders", headers=auth).status_code == 404

    with session_scope() as db:
        db.get(Asset, clip["asset"]).status = "processing"  # type: ignore[union-attr]
    not_ready = client.post(f"{V1}/clips/{clip_id}/renders", json={"preset": "reels"}, headers=auth)
    assert not_ready.status_code == 409
    assert not_ready.json()["error"]["code"] == "ASSET_NOT_READY"


def test_render_requires_auth(client: TestClient) -> None:
    assert client.post(f"{V1}/clips/x/renders", json={"preset": "reels"}).status_code == 401


def test_failed_and_canceled_renders_are_recorded(
    client: TestClient, auth: Hdr, clip: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_a: Any, **_k: Any) -> None:
        raise ffm.FFmpegError("ffmpeg exited with code 1", "x\nError: Invalid argument\n")

    monkeypatch.setattr(render_service, "run", boom)
    created = request_render(client, auth, clip["clip"], "reels")
    failed = client.get(f"{V1}/renders/{created['render']['id']}", headers=auth).json()
    assert failed["status"] == "failed" and "Invalid argument" in failed["error"]
    assert failed["download_url"] is None
    job = client.get(f"{V1}/jobs/{created['job_id']}", headers=auth).json()
    assert job["status"] == "failed"

    def canceled(*_a: Any, **_k: Any) -> None:
        raise ffm.FFmpegCanceled("ffmpeg was canceled")

    monkeypatch.setattr(render_service, "run", canceled)
    created = request_render(client, auth, clip["clip"], "reels")
    row = client.get(f"{V1}/renders/{created['render']['id']}", headers=auth).json()
    assert row["status"] == "failed" and row["error"] == "Canceled"
    assert client.get(f"{V1}/jobs/{created['job_id']}", headers=auth).json()["status"] == "canceled"
    with session_scope() as db:
        assert db.query(Job).filter(Job.type == "render.run").count() == 2
        assert db.query(Render).count() == 2


def test_active_render_cannot_be_deleted(
    client: TestClient, auth: Hdr, clip: dict[str, str]
) -> None:
    with session_scope() as db:
        row = Render(
            workspace_id=db.get(Asset, clip["asset"]).workspace_id,  # type: ignore[union-attr]
            clip_id=clip["clip"], preset="reels", edit_revision=1, status="rendering",
        )  # fmt: skip
        db.add(row)
        db.flush()
        render_id = row.id
    res = client.delete(f"{V1}/renders/{render_id}", headers=auth)
    assert res.status_code == 409 and res.json()["error"]["code"] == "CONFLICT"


def test_ffmpeg_run_can_be_canceled() -> None:
    import time

    started = time.monotonic()
    with pytest.raises(ffm.FFmpegCanceled):
        ffm.run(
            ["-re", "-f", "lavfi", "-i", "testsrc=s=64x64:r=30", "-t", "60", "-f", "null", "-"],
            should_cancel=lambda: time.monotonic() - started > 0.6,
        )
    assert time.monotonic() - started < 10


# ── captions without libass: the Pillow renderer, burned in for real ─────────────────────────
def frame_at(video: Path, t: float, dest: Path) -> Image.Image:
    subprocess.run(
        [get_settings().ffmpeg_bin, "-v", "error", "-y", "-ss", f"{t}", "-i", str(video),
         "-frames:v", "1", str(dest)],
        check=True,
    )  # fmt: skip
    return Image.open(dest).convert("RGB")


def changed_box(a: Image.Image, b: Image.Image, threshold: int = 70) -> tuple[int, ...] | None:
    """Bounding box of pixels that differ clearly between two frames (None when identical)."""
    diff = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > threshold else 0)
    return diff.getbbox()


def caption_timeline(asset_id: str, aspect: str, style: str, captions: bool) -> Timeline:
    tl = Timeline.empty(aspect, style)  # type: ignore[arg-type]
    tl.tracks.video = [v(1, 1.0, 4.5, 0.0, asset_id)]
    tl.duration = 3.5
    if captions:
        tl.tracks.captions = [
            cap(1, 0.4, 1.8, "burned in captions work"),
            cap(2, 2.2, 3.2, "without libass"),
        ]
    return tl


@pytest.fixture
def no_libass(monkeypatch: pytest.MonkeyPatch) -> None:
    """Simulate an ffmpeg without the subtitles filter (Homebrew's ffmpeg 9): auto -> pillow."""
    from app.media import caption_support

    monkeypatch.setattr(caption_support, "libass_available", lambda: False)
    monkeypatch.setattr(get_settings(), "caption_renderer", "auto")


def render_path(
    client: TestClient, auth: Hdr, clip: dict[str, str], tl: Timeline, preset: str, data_dir: Path
) -> Path:
    put_timeline(client, auth, clip["clip"], tl)
    created = request_render(client, auth, clip["clip"], preset, caption_style=tl.caption_style)
    done = client.get(f"{V1}/renders/{created['render']['id']}", headers=auth).json()
    assert done["status"] == "done", done
    return data_dir / f"renders/{done['id']}.mp4"


@pytest.mark.parametrize(
    ("preset", "aspect", "style", "size", "region"),
    [
        ("tiktok", "9:16", "karaoke", (1080, 1920), (0, 1250, 1080, 1560)),
        ("yt_short", "9:16", "bold_center", (1080, 1920), (0, 760, 1080, 1160)),
        ("yt_long", "16:9", "minimal_bottom", (1920, 1080), (0, 880, 1920, 1080)),
    ],
)
def test_pillow_captions_are_burned_into_a_real_export(
    client: TestClient, auth: Hdr, clip: dict[str, str], data_dir: Path, tmp_path: Path,
    no_libass: None, preset: str, aspect: str, style: str, size: tuple[int, int],
    region: tuple[int, int, int, int],
) -> None:  # fmt: skip
    from app.media.render_graph import resolve_caption_renderer

    assert resolve_caption_renderer() == "pillow"  # no libass here, so auto picks pillow
    plain = render_path(client, auth, clip, caption_timeline(clip["asset"], aspect, style, False), preset, data_dir)  # fmt: skip
    capped = render_path(client, auth, clip, caption_timeline(clip["asset"], aspect, style, True), preset, data_dir)  # fmt: skip
    probed = ffprobe(capped)
    video = next(s for s in probed["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == size
    assert any(s["codec_type"] == "audio" for s in probed["streams"])
    assert float(probed["format"]["duration"]) == pytest.approx(3.5, abs=0.2)

    # inside a caption: pixels differ from the caption-free export, only in the caption zone
    with_cap = frame_at(capped, 1.0, tmp_path / "cap.png")
    without = frame_at(plain, 1.0, tmp_path / "plain.png")
    box = changed_box(with_cap, without)
    assert box is not None, "no caption pixels found in the exported frame"
    assert box[0] >= region[0] and box[2] <= region[2], box
    assert box[1] >= region[1] and box[3] <= region[3], box
    # between captions (t=2.0) the two exports show the same picture
    gap_cap = frame_at(capped, 2.0, tmp_path / "gap_cap.png")
    gap_plain = frame_at(plain, 2.0, tmp_path / "gap_plain.png")
    assert changed_box(gap_cap, gap_plain) is None
    # the second caption appears later with different pixels
    second = frame_at(capped, 2.7, tmp_path / "second.png")
    assert changed_box(second, frame_at(plain, 2.7, tmp_path / "p2.png")) is not None
    assert changed_box(with_cap, second) is not None


def test_karaoke_highlight_moves_between_word_windows_in_the_export(
    client: TestClient, auth: Hdr, clip: dict[str, str], data_dir: Path, tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:  # fmt: skip
    monkeypatch.setattr(get_settings(), "caption_renderer", "pillow")  # explicit setting
    tl = caption_timeline(clip["asset"], "9:16", "karaoke", False)
    tl.tracks.captions = [cap(1, 0.4, 3.2, "one two three four")]  # 0.7 s per word
    path = render_path(client, auth, clip, tl, "tiktok", data_dir)

    def yellow_columns(t: float) -> tuple[int, int]:
        px = frame_at(path, t, tmp_path / f"k{t}.png").load()
        assert px is not None
        xs = [
            x for x in range(0, 1080, 2) for y in range(1450, 1530, 4)
            if px[x, y][0] > 235 and px[x, y][1] > 235 and px[x, y][2] < 90
        ]  # fmt: skip
        return (min(xs), max(xs)) if xs else (-1, -1)

    first, third = yellow_columns(0.7), yellow_columns(2.1)
    assert first[0] >= 0 and third[0] >= 0 and first != third  # a different word is yellow


def test_forced_libass_setting_is_honoured(
    client: TestClient, auth: Hdr, clip: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.media import caption_support

    if not caption_support.libass_available():
        pytest.skip("ffmpeg here has no libass")
    monkeypatch.setattr(get_settings(), "caption_renderer", "libass")
    assert caption_support.resolve_caption_renderer() == "libass"
    health = client.get(f"{V1}/health").json()["features"]["captions"]
    assert health == {"renderer": "libass", "libass": True}


def test_health_reports_the_caption_renderer(client: TestClient, no_libass: None) -> None:
    features = client.get(f"{V1}/health").json()["features"]
    assert features["captions"] == {"renderer": "pillow", "libass": False}
