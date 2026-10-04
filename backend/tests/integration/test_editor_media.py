"""Media dropped into the editor: light ingest (no AI needed) and still images on the video track."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import get_settings
from app.schemas.timeline import Timeline, VideoItem
from app.services.ingest.plan import stages_for
from tests.helpers import V1, Hdr
from tests.integration.test_renders_flow import (  # noqa: F401
    clip,
    ffprobe,
    put_timeline,
    request_render,
    v,
)


def test_light_mode_skips_understanding_stages() -> None:
    assert stages_for("audio", light=True) == ["probe", "audio", "silence", "finalize"]
    assert stages_for("image", light=True) == ["probe", "keyframes", "finalize"]
    assert stages_for("video", light=True) == ["probe", "audio", "proxy", "silence", "finalize"]
    assert stages_for("video", light=True, has_audio=False) == ["probe", "proxy", "finalize"]
    assert "transcribe" in stages_for("video") and "caption" in stages_for("image")


def chunked_upload(
    client: TestClient, auth: Hdr, path: Path, mime: str, mode: str
) -> dict[str, Any]:
    data = path.read_bytes()
    init = client.post(
        f"{V1}/uploads",
        json={"filename": path.name, "mime": mime, "size_bytes": len(data)},
        headers=auth,
    )
    assert init.status_code == 201, init.text
    up = init.json()
    size = up["chunk_size"]
    for n in range(up["total_chunks"]):
        res = client.put(
            f"{V1}/uploads/{up['id']}/chunks/{n}",
            content=data[n * size : (n + 1) * size],
            headers=auth,
        )
        assert res.status_code == 200, res.text
    done = client.post(f"{V1}/uploads/{up['id']}/complete", json={"mode": mode}, headers=auth)
    assert done.status_code == 200, done.text
    body: dict[str, Any] = done.json()
    return body


def test_light_upload_of_music_is_ready_without_any_transcription(
    client: TestClient, auth: Hdr, tmp_path: Path
) -> None:
    mp3 = tmp_path / "bed.mp3"
    subprocess.run(
        [
            get_settings().ffmpeg_bin,
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:duration=4",
            str(mp3),
        ],
        check=True,
    )
    out = chunked_upload(client, auth, mp3, "audio/mpeg", "light")
    asset = client.get(f"{V1}/assets/{out['asset']['id']}", headers=auth).json()
    assert asset["status"] == "ready", asset
    done = [s.split(":")[0] for s in asset["stages_done"]]
    assert done == ["probe", "audio", "silence", "finalize"]
    assert asset["analysis"]["mode"] == "light" and asset["duration_sec"] == pytest.approx(
        4, abs=0.3
    )
    assert asset["urls"]["audio"]


def test_light_upload_of_an_image_gets_a_thumbnail_and_dimensions(
    client: TestClient, auth: Hdr, tmp_path: Path
) -> None:
    png = tmp_path / "still.png"
    Image.new("RGB", (800, 600), (200, 40, 40)).save(png)
    out = chunked_upload(client, auth, png, "image/png", "light")
    asset = client.get(f"{V1}/assets/{out['asset']['id']}", headers=auth).json()
    assert asset["status"] == "ready" and asset["kind"] == "image"
    assert (asset["width"], asset["height"]) == (800, 600)
    assert asset["urls"]["thumb"] and asset["urls"]["original"]


def test_reprocess_full_upgrades_a_light_asset(
    client: TestClient, auth: Hdr, tmp_path: Path
) -> None:
    png = tmp_path / "still2.png"
    Image.new("RGB", (320, 240), (10, 90, 200)).save(png)
    out = chunked_upload(client, auth, png, "image/png", "light")
    asset_id = out["asset"]["id"]
    res = client.post(f"{V1}/assets/{asset_id}/reprocess", json={"mode": "full"}, headers=auth)
    assert res.status_code == 202, res.text
    asset = client.get(f"{V1}/assets/{asset_id}", headers=auth).json()
    assert "mode" not in asset["analysis"]


def test_an_image_item_validates_and_renders_in_a_real_export(
    client: TestClient,
    auth: Hdr,
    clip: dict[str, str],  # noqa: F811
    tmp_path: Path,
    data_dir: Path,
) -> None:
    png = tmp_path / "title.png"
    Image.new("RGB", (900, 900), (30, 160, 90)).save(png)
    still = chunked_upload(client, auth, png, "image/png", "light")["asset"]["id"]

    tl = Timeline.empty("9:16", "bold_center")
    still_item = VideoItem(
        id="v_img", source="user", status="accepted", kind="image", asset_id=still,
        src_in=0.0, src_out=2.0, tl_start=3.0,
    )  # fmt: skip
    tl.tracks.video = [v(1, 1.0, 4.0, 0.0, clip["asset"]), still_item]
    tl.duration = 5.0
    put_timeline(client, auth, clip["clip"], tl)  # 200: an image has no source duration to exceed

    created = request_render(client, auth, clip["clip"], "reels")
    done = client.get(f"{V1}/renders/{created['render']['id']}", headers=auth).json()
    assert done["status"] == "done", done
    probed = ffprobe(data_dir / f"renders/{done['id']}.mp4")
    video = next(s for s in probed["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert float(probed["format"]["duration"]) == pytest.approx(5.0, abs=0.25)
    assert any(
        s["codec_type"] == "audio" for s in probed["streams"]
    )  # silent audio under the still
