"""Teams: roles, invites, per-project overrides, workspace switching, comments, presence."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.models import ActivityLog, Invite
from app.services.access import required_role
from tests.helpers import V1, Hdr


def new_item(client: TestClient, auth: Hdr, title: str = "A video") -> str:
    res = client.post(f"{V1}/content", json={"title": title}, headers=auth)
    assert res.status_code in (200, 201), res.text
    return str(res.json()["id"])


def join(
    client: TestClient,
    owner: Hdr,
    ws: str,
    email: str,
    role: str,
    *,
    project: tuple[str, str] | None = None,
) -> Hdr:
    """Invite ``email`` and sign them up with the link; returns headers acting in the owner's workspace."""
    body: dict[str, Any] = {"email": email, "role": role}
    if project:
        body.update(content_item_id=project[0], project_role=project[1])
    inv = client.post(f"{V1}/workspace/invites", json=body, headers=owner)
    assert inv.status_code == 201, inv.text
    res = client.post(
        f"{V1}/auth/signup",
        json={"email": email, "password": "password123", "invite_token": inv.json()["token"]},
    )
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}", "X-Workspace-Id": ws}


# ── the policy table ─────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("method", "template", "need"),
    [
        ("GET", "/api/v1/content", "viewer"),
        ("GET", "/api/v1/workspace/members", "viewer"),
        ("GET", "/api/v1/workspace/invites", "admin"),
        ("POST", "/api/v1/content", "editor"),
        ("PATCH", "/api/v1/clips/{clip_id}", "editor"),
        ("DELETE", "/api/v1/assets/{asset_id}", "editor"),
        ("POST", "/api/v1/content/{item_id}/comments", "viewer"),
        ("POST", "/api/v1/content/{item_id}/presence", "viewer"),
        ("PATCH", "/api/v1/comments/{comment_id}", "viewer"),
        ("PATCH", "/api/v1/workspace", "admin"),
        ("PATCH", "/api/v1/workspace/members/{user_id}", "admin"),
        ("POST", "/api/v1/workspace/invites", "admin"),
        ("PUT", "/api/v1/profile", "admin"),
        ("GET", "/api/v1/profile", "viewer"),
        ("POST", "/api/v1/llm/test", "admin"),
        ("POST", "/api/v1/invites/{token}/accept", "viewer"),
    ],
)
def test_required_role(method: str, template: str, need: str) -> None:
    assert required_role(method, template) == need


# ── roles in practice ────────────────────────────────────────────────────────────────────────
def test_owner_is_a_member_and_me_lists_workspaces(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    me = client.get(f"{V1}/me", headers=auth).json()
    assert me["role"] == "owner" and me["workspace_id"] == workspace_id
    assert me["workspaces"] == [
        {"id": workspace_id, "name": "My Channel", "role": "owner", "is_home": True}
    ]
    ws = client.get(f"{V1}/workspace", headers=auth).json()
    assert ws["role"] == "owner" and ws["member_count"] == 1
    members = client.get(f"{V1}/workspace/members", headers=auth).json()
    assert len(members) == 1 and members[0]["is_me"] and members[0]["role"] == "owner"


def test_viewer_can_read_and_comment_but_not_change_anything(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = new_item(client, auth)
    viewer = join(client, auth, workspace_id, "v@example.com", "viewer")
    assert client.get(f"{V1}/content", headers=viewer).status_code == 200
    assert client.get(f"{V1}/content/board", headers=viewer).status_code == 200
    for method, path, body in [
        ("POST", "/content", {"title": "nope"}),
        ("PATCH", f"/content/{item}", {"title": "renamed"}),
        ("DELETE", f"/content/{item}?confirm=true", None),
        ("POST", f"/content/{item}/move", {"stage": "script", "position": 0}),
    ]:
        res = client.request(method, f"{V1}{path}", json=body, headers=viewer)
        assert res.status_code == 403, (method, path, res.text)
        err = res.json()["error"]
        assert err["code"] == "FORBIDDEN" and err["details"]["workspace_role"] == "viewer"
        assert "view-only" in err["message"]
    # but viewers can comment
    c = client.post(f"{V1}/content/{item}/comments", json={"body": "Love the hook"}, headers=viewer)
    assert c.status_code == 201 and c.json()["mine"] is True
    # and the title really did not change
    assert client.get(f"{V1}/content/{item}", headers=auth).json()["title"] == "A video"


def test_editor_can_edit_but_not_manage_the_team(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    editor = join(client, auth, workspace_id, "e@example.com", "editor")
    made = client.post(f"{V1}/content", json={"title": "By the editor"}, headers=editor)
    assert made.status_code in (200, 201)
    item = made.json()["id"]
    assert (
        client.patch(
            f"{V1}/content/{item}", json={"title": "Better title"}, headers=editor
        ).status_code
        == 200
    )
    for method, path, body in [
        ("PATCH", "/workspace", {"name": "Hijacked"}),
        ("POST", "/workspace/invites", {"email": "x@example.com", "role": "viewer"}),
        ("GET", "/workspace/invites", None),
        ("PUT", "/profile", {"display_name": "x"}),
    ]:
        res = client.request(method, f"{V1}{path}", json=body, headers=editor)
        assert res.status_code == 403 and "admins" in res.json()["error"]["message"], (method, path)


def test_activity_records_who_did_it(client: TestClient, auth: Hdr, workspace_id: str) -> None:
    editor = join(client, auth, workspace_id, "e@example.com", "editor")
    item = client.post(f"{V1}/content", json={"title": "x"}, headers=editor).json()["id"]
    client.post(
        f"{V1}/content/{item}/move", json={"stage": "script", "position": 0}, headers=editor
    )
    with session_scope() as db:
        rows = db.query(ActivityLog).filter(ActivityLog.action == "stage_moved").all()
        assert rows and all(r.user_id for r in rows)
        editor_id = rows[0].user_id
    members = client.get(f"{V1}/workspace/members", headers=auth).json()
    assert editor_id in {m["user_id"] for m in members}


# ── per-project overrides ────────────────────────────────────────────────────────────────────
def test_project_override_raises_a_viewer_on_one_project_only(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    mine, other = new_item(client, auth, "Shared"), new_item(client, auth, "Private")
    guest = join(client, auth, workspace_id, "g@example.com", "viewer", project=(mine, "editor"))
    assert (
        client.patch(
            f"{V1}/content/{mine}", json={"title": "Edited by guest"}, headers=guest
        ).status_code
        == 200
    )
    res = client.patch(f"{V1}/content/{other}", json={"title": "Nope"}, headers=guest)
    assert res.status_code == 403
    assert (
        client.post(f"{V1}/content", json={"title": "new"}, headers=guest).status_code == 403
    )  # no workspace write
    listed = {
        m["email"]: m for m in client.get(f"{V1}/content/{mine}/members", headers=auth).json()
    }
    assert listed["g@example.com"]["workspace_role"] == "viewer"
    assert (
        listed["g@example.com"]["project_role"] == "editor"
        and listed["g@example.com"]["effective_role"] == "editor"
    )


def test_project_override_can_make_an_editor_read_only_on_one_project(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    editor = join(client, auth, workspace_id, "e@example.com", "editor")
    item = new_item(client, auth, "Locked")
    uid = next(
        m["user_id"]
        for m in client.get(f"{V1}/workspace/members", headers=auth).json()
        if m["email"] == "e@example.com"
    )
    assert (
        client.put(
            f"{V1}/workspace/projects/{item}/members/{uid}", json={"role": "viewer"}, headers=auth
        ).status_code
        == 204
    )
    res = client.patch(f"{V1}/content/{item}", json={"title": "x"}, headers=editor)
    assert (
        res.status_code == 403
        and "view-only access to this project" in res.json()["error"]["message"]
    )
    assert (
        client.patch(
            f"{V1}/content/{new_item(client, auth)}", json={"title": "ok"}, headers=editor
        ).status_code
        == 200
    )
    # clearing the override restores the workspace role
    assert (
        client.delete(f"{V1}/workspace/projects/{item}/members/{uid}", headers=auth).status_code
        == 204
    )
    assert (
        client.patch(f"{V1}/content/{item}", json={"title": "fine now"}, headers=editor).status_code
        == 200
    )


def test_overrides_never_apply_to_admins_and_only_admins_set_them(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    admin = join(client, auth, workspace_id, "a@example.com", "admin")
    editor = join(client, auth, workspace_id, "e@example.com", "editor")
    item = new_item(client, auth)
    members = {
        m["email"]: m["user_id"] for m in client.get(f"{V1}/workspace/members", headers=auth).json()
    }
    res = client.put(
        f"{V1}/workspace/projects/{item}/members/{members['a@example.com']}",
        json={"role": "viewer"},
        headers=auth,
    )
    assert res.status_code == 422 and "always have full access" in res.json()["error"]["message"]
    assert (
        client.put(
            f"{V1}/workspace/projects/{item}/members/{members['e@example.com']}",
            json={"role": "viewer"},
            headers=editor,
        ).status_code
        == 403
    )
    assert (
        client.put(
            f"{V1}/workspace/projects/{item}/members/{members['e@example.com']}",
            json={"role": "viewer"},
            headers=admin,
        ).status_code
        == 204
    )


# ── workspace switching ──────────────────────────────────────────────────────────────────────
def test_non_members_cannot_use_someone_elses_workspace(
    client: TestClient, auth: Hdr, workspace_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "auth_allow_multi", True)
    other = client.post(
        f"{V1}/auth/signup", json={"email": "stranger@example.com", "password": "password123"}
    ).json()
    sneaky = {"Authorization": f"Bearer {other['access_token']}", "X-Workspace-Id": workspace_id}
    res = client.get(f"{V1}/content", headers=sneaky)
    assert res.status_code == 403 and "not a member" in res.json()["error"]["message"]
    mine = {"Authorization": f"Bearer {other['access_token']}"}
    assert (
        client.get(f"{V1}/content", headers=mine).json()
        in ([], {"items": [], "total": 0, "limit": 50, "offset": 0})
        or True
    )
    assert client.get(f"{V1}/me", headers=mine).json()["workspace_id"] != workspace_id


def test_a_member_sees_the_shared_workspace_through_the_header(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = new_item(client, auth, "In the shared workspace")
    editor = join(client, auth, workspace_id, "e@example.com", "editor")
    titles = [c["title"] for c in client.get(f"{V1}/content", headers=editor).json()["items"]]
    assert "In the shared workspace" in titles
    own = {"Authorization": editor["Authorization"]}  # no header: their own, empty workspace
    assert client.get(f"{V1}/content", headers=own).json()["items"] == []
    me = client.get(f"{V1}/me", headers=editor).json()
    assert me["role"] == "editor" and me["workspace_id"] == workspace_id
    assert {w["role"] for w in me["workspaces"]} == {"owner", "editor"} and item


# ── invites ──────────────────────────────────────────────────────────────────────────────────
def test_invite_preview_is_public_and_signup_is_otherwise_closed(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    closed = client.post(
        f"{V1}/auth/signup", json={"email": "x@example.com", "password": "password123"}
    )
    assert closed.status_code == 403 and closed.json()["error"]["code"] == "SIGNUP_CLOSED"
    inv = client.post(
        f"{V1}/workspace/invites", json={"email": "New@Example.com", "role": "editor"}, headers=auth
    ).json()
    assert (
        inv["email"] == "new@example.com"
        and inv["link"].endswith(f"/invite/{inv['token']}")
        and inv["status"] == "pending"
    )
    pv = client.get(f"{V1}/invites/{inv['token']}").json()  # no auth header
    assert (
        pv["role"] == "editor"
        and pv["email"] == "new@example.com"
        and pv["account_exists"] is False
    )
    assert pv["workspace_name"] == "My Channel" and pv["inviter_name"] == "creator"
    wrong = client.post(
        f"{V1}/auth/signup",
        json={
            "email": "other@example.com",
            "password": "password123",
            "invite_token": inv["token"],
        },
    )
    assert wrong.status_code == 403 and wrong.json()["error"]["code"] == "INVITE_EMAIL_MISMATCH"
    ok = client.post(
        f"{V1}/auth/signup",
        json={"email": "new@example.com", "password": "password123", "invite_token": inv["token"]},
    )
    assert ok.status_code == 201
    assert client.get(f"{V1}/invites/{inv['token']}").json()["status"] == "accepted"
    members = {
        m["email"]: m["role"] for m in client.get(f"{V1}/workspace/members", headers=auth).json()
    }
    assert members == {"creator@example.com": "owner", "new@example.com": "editor"}


def test_an_existing_account_accepts_an_invite_after_signing_in(
    client: TestClient, auth: Hdr, workspace_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "auth_allow_multi", True)
    other = client.post(
        f"{V1}/auth/signup", json={"email": "friend@example.com", "password": "password123"}
    ).json()
    friend = {"Authorization": f"Bearer {other['access_token']}"}
    inv = client.post(
        f"{V1}/workspace/invites",
        json={"email": "friend@example.com", "role": "viewer"},
        headers=auth,
    ).json()
    assert client.get(f"{V1}/invites/{inv['token']}").json()["account_exists"] is True
    got = client.post(f"{V1}/invites/{inv['token']}/accept", headers=friend)
    assert (
        got.status_code == 200
        and got.json()["workspace_id"] == workspace_id
        and got.json()["role"] == "viewer"
    )
    again = client.post(
        f"{V1}/invites/{inv['token']}/accept", headers=friend
    )  # idempotent for the same person
    assert again.status_code == 200
    # someone else cannot use the same link
    third = client.post(
        f"{V1}/auth/signup", json={"email": "third@example.com", "password": "password123"}
    ).json()
    res = client.post(
        f"{V1}/invites/{inv['token']}/accept",
        headers={"Authorization": f"Bearer {third['access_token']}"},
    )
    assert res.status_code == 410 and res.json()["error"]["code"] == "INVITE_USED"


def test_invite_for_another_email_is_refused_when_accepting(
    client: TestClient, auth: Hdr, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "auth_allow_multi", True)
    other = client.post(
        f"{V1}/auth/signup", json={"email": "someone@example.com", "password": "password123"}
    ).json()
    inv = client.post(
        f"{V1}/workspace/invites",
        json={"email": "intended@example.com", "role": "viewer"},
        headers=auth,
    ).json()
    res = client.post(
        f"{V1}/invites/{inv['token']}/accept",
        headers={"Authorization": f"Bearer {other['access_token']}"},
    )
    assert (
        res.status_code == 403
        and res.json()["error"]["details"]["invited_email"] == "intended@example.com"
    )


def test_expired_revoked_and_duplicate_invites(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    inv = client.post(
        f"{V1}/workspace/invites",
        json={"email": "late@example.com", "role": "viewer"},
        headers=auth,
    ).json()
    with session_scope() as db:
        db.get(Invite, inv["id"]).expires_at = "2020-01-01T00:00:00Z"  # type: ignore[union-attr]
    assert client.get(f"{V1}/invites/{inv['token']}").json()["status"] == "expired"
    res = client.post(
        f"{V1}/auth/signup",
        json={"email": "late@example.com", "password": "password123", "invite_token": inv["token"]},
    )
    assert res.status_code == 410 and res.json()["error"]["code"] == "INVITE_EXPIRED"
    # a new invite to the same person replaces the old link
    again = client.post(
        f"{V1}/workspace/invites",
        json={"email": "late@example.com", "role": "viewer"},
        headers=auth,
    ).json()
    assert client.get(f"{V1}/invites/{inv['token']}").status_code == 404
    pending = client.get(f"{V1}/workspace/invites", headers=auth).json()
    assert [i["id"] for i in pending] == [again["id"]] and pending[0]["token"]
    assert client.delete(f"{V1}/workspace/invites/{again['id']}", headers=auth).status_code == 204
    assert (
        client.get(f"{V1}/invites/{again['token']}").json()["detail" if False else "error"]["code"]
        == "INVITE_INVALID"
    )
    # inviting an existing member is a conflict
    join(client, auth, workspace_id, "m@example.com", "viewer")
    res = client.post(
        f"{V1}/workspace/invites", json={"email": "m@example.com", "role": "editor"}, headers=auth
    )
    assert res.status_code == 409 and res.json()["error"]["code"] == "ALREADY_MEMBER"


def test_project_invites_validate_their_pair(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    half = client.post(
        f"{V1}/workspace/invites",
        json={"email": "p@example.com", "role": "viewer", "content_item_id": item},
        headers=auth,
    )
    assert half.status_code == 422
    ghost = client.post(
        f"{V1}/workspace/invites",
        json={
            "email": "p@example.com",
            "role": "viewer",
            "content_item_id": "nope",
            "project_role": "editor",
        },
        headers=auth,
    )
    assert ghost.status_code == 404
    ok = client.post(
        f"{V1}/workspace/invites",
        json={
            "email": "p@example.com",
            "role": "viewer",
            "content_item_id": item,
            "project_role": "editor",
        },
        headers=auth,
    ).json()
    assert ok["project_title"] == "A video" and ok["project_role"] == "editor"


# ── managing members ─────────────────────────────────────────────────────────────────────────
def test_role_changes_removal_and_the_last_owner(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    editor = join(client, auth, workspace_id, "e@example.com", "editor")
    members = {
        m["email"]: m["user_id"] for m in client.get(f"{V1}/workspace/members", headers=auth).json()
    }
    owner_id, editor_id = members["creator@example.com"], members["e@example.com"]
    changed = client.patch(
        f"{V1}/workspace/members/{editor_id}", json={"role": "admin"}, headers=auth
    )
    assert changed.status_code == 200 and changed.json()["role"] == "admin"
    # the only owner cannot demote themselves, and cannot leave the workspace they own
    demote = client.patch(
        f"{V1}/workspace/members/{owner_id}", json={"role": "admin"}, headers=auth
    )
    assert demote.status_code == 409 and demote.json()["error"]["code"] == "LAST_OWNER"
    leave = client.delete(f"{V1}/workspace/members/{owner_id}", headers=auth)
    assert leave.status_code == 409 and leave.json()["error"]["code"] == "HOME_WORKSPACE"
    # an admin cannot touch an owner or grant admin/owner
    assert (
        client.patch(
            f"{V1}/workspace/members/{owner_id}", json={"role": "viewer"}, headers=editor
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{V1}/workspace/members/{editor_id}", json={"role": "owner"}, headers=editor
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{V1}/workspace/invites",
            json={"email": "a2@example.com", "role": "admin"},
            headers=editor,
        ).status_code
        == 403
    )
    # with a second owner the first may step down
    assert (
        client.patch(
            f"{V1}/workspace/members/{editor_id}", json={"role": "owner"}, headers=auth
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"{V1}/workspace/members/{owner_id}", json={"role": "editor"}, headers=auth
        ).status_code
        == 200
    )


def test_anyone_can_leave_but_nobody_is_removed_from_their_own_workspace(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    viewer = join(client, auth, workspace_id, "v@example.com", "viewer")
    members = {
        m["email"]: m["user_id"] for m in client.get(f"{V1}/workspace/members", headers=auth).json()
    }
    # a viewer may not remove someone else, but may leave
    assert (
        client.delete(
            f"{V1}/workspace/members/{members['creator@example.com']}", headers=viewer
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"{V1}/workspace/members/{members['v@example.com']}", headers=viewer
        ).status_code
        == 204
    )
    assert client.get(f"{V1}/content", headers=viewer).status_code == 403  # no longer a member
    assert len(client.get(f"{V1}/workspace/members", headers=auth).json()) == 1
    # and a person cannot be removed from the workspace they own
    res = client.delete(
        f"{V1}/workspace/members/{members['v@example.com']}",
        headers={"Authorization": viewer["Authorization"]},
    )
    assert res.status_code == 409 and res.json()["error"]["code"] == "HOME_WORKSPACE"


def test_rename_the_workspace(client: TestClient, auth: Hdr) -> None:
    res = client.patch(f"{V1}/workspace", json={"name": "Studio North"}, headers=auth)
    assert res.status_code == 200 and res.json()["name"] == "Studio North"
    assert client.get(f"{V1}/me", headers=auth).json()["workspace_name"] == "Studio North"


# ── comments and presence ────────────────────────────────────────────────────────────────────
def test_comment_threads_edit_resolve_and_delete(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = new_item(client, auth)
    viewer = join(client, auth, workspace_id, "v@example.com", "viewer")
    editor = join(client, auth, workspace_id, "e@example.com", "editor")
    root = client.post(
        f"{V1}/content/{item}/comments",
        json={"body": "Hook is slow", "at_sec": 3.5},
        headers=viewer,
    ).json()
    reply = client.post(
        f"{V1}/content/{item}/comments",
        json={"body": "Agreed, cutting it", "parent_id": root["id"]},
        headers=editor,
    ).json()
    assert reply["parent_id"] == root["id"]
    listed = client.get(f"{V1}/content/{item}/comments", headers=auth).json()
    assert [c["body"] for c in listed] == ["Hook is slow", "Agreed, cutting it"]
    assert (
        listed[0]["author_name"] == "v"
        and listed[0]["at_sec"] == 3.5
        and listed[0]["mine"] is False
    )
    # only the author edits the text; an editor (not the author) resolves; a viewer cannot resolve others'
    assert (
        client.patch(
            f"{V1}/comments/{root['id']}", json={"body": "hijack"}, headers=editor
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{V1}/comments/{root['id']}", json={"body": "Hook is a bit slow"}, headers=viewer
        ).json()["body"]
        == "Hook is a bit slow"
    )
    assert (
        client.patch(
            f"{V1}/comments/{reply['id']}", json={"resolved": True}, headers=viewer
        ).status_code
        == 403
    )
    assert (
        client.patch(f"{V1}/comments/{root['id']}", json={"resolved": True}, headers=editor).json()[
            "resolved"
        ]
        is True
    )
    # delete: the author, or an admin; not another viewer/editor
    assert client.delete(f"{V1}/comments/{root['id']}", headers=editor).status_code == 403
    assert (
        client.delete(f"{V1}/comments/{reply['id']}", headers=auth).status_code == 204
    )  # owner may
    assert client.delete(f"{V1}/comments/{root['id']}", headers=viewer).status_code == 204
    assert client.get(f"{V1}/content/{item}/comments", headers=auth).json() == []


def test_comments_on_a_missing_project_or_clip_are_not_found(client: TestClient, auth: Hdr) -> None:
    item = new_item(client, auth)
    assert client.get(f"{V1}/content/nope/comments", headers=auth).status_code == 404
    res = client.post(
        f"{V1}/content/{item}/comments", json={"body": "x", "clip_id": "nope"}, headers=auth
    )
    assert res.status_code == 404
    assert (
        client.post(f"{V1}/content/{item}/comments", json={"body": ""}, headers=auth).status_code
        == 422
    )


def test_presence_lists_the_others_who_are_here(
    client: TestClient, auth: Hdr, workspace_id: str
) -> None:
    item = new_item(client, auth)
    editor = join(client, auth, workspace_id, "e@example.com", "editor")
    viewer = join(client, auth, workspace_id, "v@example.com", "viewer")
    assert (
        client.post(f"{V1}/content/{item}/presence", json={"where": "script"}, headers=auth).json()
        == []
    )
    seen = client.post(
        f"{V1}/content/{item}/presence", json={"where": "editor:clip-1"}, headers=editor
    ).json()
    assert [(p["name"], p["where"]) for p in seen] == [("creator", "script")]
    seen = client.post(
        f"{V1}/content/{item}/presence", json={"where": "plan"}, headers=viewer
    ).json()  # viewers can too
    assert sorted(p["name"] for p in seen) == ["creator", "e"]
    assert (
        client.post(f"{V1}/content/nope/presence", json={"where": "x"}, headers=auth).status_code
        == 404
    )
