"""Community feed: shared across every account on the server; posts copy the shared video."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import session_scope
from app.models import Clip, Edit, Render
from app.services.access import required_role
from app.storage.local import get_storage
from tests.helpers import V1, Hdr, upload_file


@pytest.fixture
def multi(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "auth_allow_multi", True)


def signup(client: TestClient, email: str, name: str) -> Hdr:
    res = client.post(
        f"{V1}/auth/signup", json={"email": email, "password": "password123", "display_name": name}
    )
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def ready_video(client: TestClient, auth: Hdr, media: Any) -> str:
    body = upload_file(client, auth, media.video, sidecar=media.sidecar)
    asset = client.get(f"{V1}/assets/{body['asset']['id']}", headers=auth).json()
    assert asset["status"] == "ready", asset
    return str(asset["id"])


def done_render(workspace_id: str, asset_id: str, media: Any) -> str:
    """A finished render row whose file exists (the render pipeline has its own tests)."""
    from app.models import ContentItem

    with session_scope() as db:
        item = ContentItem(workspace_id=workspace_id, title="Project", stage="edit", position=0)
        db.add(item)
        db.flush()
        clip = Clip(workspace_id=workspace_id, content_item_id=item.id, source_asset_id=asset_id,
                    kind="short", title="My best moment", start_sec=0, end_sec=5)  # fmt: skip
        db.add(clip)
        db.flush()
        db.add(Edit(workspace_id=workspace_id, clip_id=clip.id, revision=1, timeline={}))
        render = Render(workspace_id=workspace_id, clip_id=clip.id, preset="reels",
                        edit_revision=1, status="done", duration_sec=5.0)  # fmt: skip
        db.add(render)
        db.flush()
        key = f"renders/{render.id}.mp4"
        get_storage().put_file(key, media.video)
        render.output_key = key
        return str(render.id)


def test_policy_lets_viewers_like_and_comment_but_not_post() -> None:
    assert required_role("GET", "/api/v1/community/posts") == "viewer"
    assert required_role("POST", "/api/v1/community/posts") == "editor"
    assert required_role("PUT", "/api/v1/community/posts/{post_id}/like") == "viewer"
    assert required_role("POST", "/api/v1/community/posts/{post_id}/comments") == "viewer"
    assert required_role("DELETE", "/api/v1/community/comments/{community_comment_id}") == "viewer"
    assert required_role("PATCH", "/api/v1/community/posts/{post_id}") == "viewer"  # author-checked


def test_a_post_is_seen_liked_and_discussed_by_another_account(
    client: TestClient, auth: Hdr, workspace_id: str, tiny_media: Any, multi: None
) -> None:
    asset_id = ready_video(client, auth, tiny_media)
    render_id = done_render(workspace_id, asset_id, tiny_media)
    res = client.post(
        f"{V1}/community/posts",
        json={"render_id": render_id, "body": "Feedback on the hook?",
              "platforms": ["tiktok", "youtube"], "tags": ["#Editing", "editing", " shorts "]},
        headers=auth,
    )  # fmt: skip
    assert res.status_code == 201, res.text
    post = res.json()
    assert post["title"] == "My best moment"  # defaults to the clip title
    assert post["platforms"] == ["youtube", "tiktok"] and post["tags"] == ["editing", "shorts"]
    assert post["aspect"] == "9:16" and post["mine"] is True and post["like_count"] == 0
    assert post["video_url"].startswith("/media/community/")
    # the video is a copy: it survives deleting the render
    assert client.get(post["video_url"]).status_code == 200
    with session_scope() as db:
        db.delete(db.get(Render, render_id))

    bob = signup(client, "bob@example.com", "Bob")
    feed = client.get(f"{V1}/community/posts", headers=bob).json()
    assert feed["total"] == 1
    seen = feed["items"][0]
    assert seen["id"] == post["id"] and seen["mine"] is False and seen["author"]["name"]
    assert seen["render_id"] is None and client.get(seen["video_url"]).status_code == 200

    liked = client.put(f"{V1}/community/posts/{post['id']}/like", headers=bob).json()
    assert liked == {"post_id": post["id"], "liked": True, "like_count": 1}
    again = client.put(f"{V1}/community/posts/{post['id']}/like", headers=bob).json()
    assert again["like_count"] == 1  # idempotent

    c = client.post(f"{V1}/community/posts/{post['id']}/comments",
                    json={"body": "Hook lands, cut the first second."}, headers=bob)  # fmt: skip
    assert c.status_code == 201, c.text
    reply = client.post(
        f"{V1}/community/posts/{post['id']}/comments",
        json={"body": "Thanks, trimming it.", "parent_id": c.json()["id"]},
        headers=auth,
    ).json()
    nested = client.post(
        f"{V1}/community/posts/{post['id']}/comments",
        json={"body": "deeper", "parent_id": reply["id"]},
        headers=bob,
    ).json()
    assert reply["parent_id"] == c.json()["id"] and reply["by_post_author"] is True
    assert nested["parent_id"] == c.json()["id"]  # replies stay one level deep
    thread = client.get(f"{V1}/community/posts/{post['id']}/comments", headers=auth).json()
    assert [t["body"] for t in thread] == [
        "Hook lands, cut the first second.",
        "Thanks, trimming it.",
        "deeper",
    ]
    assert thread[0]["can_delete"] is True and thread[0]["mine"] is False  # post author moderates

    got = client.get(f"{V1}/community/posts/{post['id']}", headers=auth).json()
    assert got["like_count"] == 1 and got["comment_count"] == 3 and got["liked_by_me"] is False

    # only the author edits or deletes the post; comment authors edit their own comments
    assert (
        client.patch(
            f"{V1}/community/posts/{post['id']}", json={"title": "x"}, headers=bob
        ).status_code
        == 403
    )
    assert client.delete(f"{V1}/community/posts/{post['id']}", headers=bob).status_code == 403
    assert (
        client.patch(
            f"{V1}/community/comments/{c.json()['id']}", json={"body": "edit"}, headers=auth
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{V1}/community/comments/{c.json()['id']}", json={"body": "edited"}, headers=bob
        ).json()["body"]
        == "edited"
    )
    assert client.delete(f"{V1}/community/comments/{reply['id']}", headers=bob).status_code == 403
    assert (
        client.delete(f"{V1}/community/comments/{c.json()['id']}", headers=auth).status_code == 204
    )
    after = client.get(f"{V1}/community/posts/{post['id']}/comments", headers=auth).json()
    assert after == []  # deleting a thread removes its replies

    patched = client.patch(
        f"{V1}/community/posts/{post['id']}",
        json={"title": "Hook test v2", "platforms": ["instagram"]},
        headers=auth,
    ).json()
    assert patched["title"] == "Hook test v2" and patched["platforms"] == ["instagram"]
    unliked = client.delete(f"{V1}/community/posts/{post['id']}/like", headers=bob).json()
    assert unliked["liked"] is False and unliked["like_count"] == 0

    assert client.delete(f"{V1}/community/posts/{post['id']}", headers=auth).status_code == 204
    assert client.get(f"{V1}/community/posts/{post['id']}", headers=bob).status_code == 404
    assert not get_storage().exists(f"community/{post['id']}/video.mp4")


def test_filters_sorting_and_what_can_be_shared(
    client: TestClient, auth: Hdr, workspace_id: str, tiny_media: Any, multi: None
) -> None:
    asset_id = ready_video(client, auth, tiny_media)
    bob = signup(client, "bob@example.com", "Bob")

    def share(hdr: Hdr, title: str, platforms: list[str], tags: list[str]) -> dict[str, Any]:
        res = client.post(f"{V1}/community/posts", json={"asset_id": asset_id, "title": title,
                          "platforms": platforms, "tags": tags}, headers=hdr)  # fmt: skip
        assert res.status_code == 201, res.text
        return res.json()

    a = share(auth, "Talking head", ["youtube"], ["vlog"])
    b = share(auth, "Product demo", ["tiktok", "instagram"], ["demo"])
    client.put(f"{V1}/community/posts/{a['id']}/like", headers=bob)
    client.post(f"{V1}/community/posts/{b['id']}/comments", json={"body": "nice"}, headers=bob)

    def ids(**params: Any) -> list[str]:
        res = client.get(f"{V1}/community/posts", params=params, headers=bob)
        assert res.status_code == 200, res.text
        return [p["id"] for p in res.json()["items"]]

    assert set(ids()) == {a["id"], b["id"]}
    assert ids(platform="tiktok") == [b["id"]] and ids(tag="#VLOG") == [a["id"]]
    assert ids(sort="top")[0] == a["id"] and ids(sort="discussed")[0] == b["id"]
    assert ids(q="demo") == [b["id"]] and ids(author="me") == []
    assert (
        client.get(f"{V1}/community/posts", params={"platform": "myspace"}, headers=bob).status_code
        == 422
    )

    # Bob's workspace cannot share Alice's video; bad inputs are explained
    res = client.post(f"{V1}/community/posts", json={"asset_id": asset_id}, headers=bob)
    assert res.status_code == 404
    res = client.post(f"{V1}/community/posts", json={}, headers=auth)
    assert res.status_code == 422 and res.json()["error"]["code"] == "VALIDATION_ERROR"
    res = client.post(
        f"{V1}/community/posts", json={"asset_id": asset_id, "platforms": ["myspace"]}, headers=auth
    )
    assert res.status_code == 422
    rid = done_render(workspace_id, asset_id, tiny_media)
    with session_scope() as db:
        db.get(Render, rid).status = "rendering"  # type: ignore[union-attr]
    res = client.post(f"{V1}/community/posts", json={"render_id": rid}, headers=auth)
    assert res.status_code == 409 and res.json()["error"]["code"] == "ASSET_NOT_READY"
    empty = client.post(
        f"{V1}/community/posts/{a['id']}/comments", json={"body": "   "}, headers=bob
    )
    assert empty.status_code == 422
    assert client.get(f"{V1}/community/posts", headers={}).status_code == 401
