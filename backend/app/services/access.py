"""Who may do what: workspace roles, per-project overrides and the request policy.

Roles, lowest to highest: ``viewer`` (read, comment), ``editor`` (create and change content),
``admin`` (team, settings, integrations) and ``owner`` (like admin; the last owner is protected).

A row in ``project_members`` overrides the workspace role on that one project (a viewer can be
made editor of a single video, an editor made read-only on one). Admins and owners are never
restricted. The policy below is enforced once, in ``deps.get_ctx``, so an endpoint cannot forget it:

* any member may read (GET/HEAD/OPTIONS);
* every other request needs ``editor`` (on its project when it belongs to one), except
  :data:`VIEWER_WRITES` (comments, presence) and :data:`ADMIN_RULES` (team and settings).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import (
    Asset,
    BeatMatch,
    Clip,
    Comment,
    ProjectMember,
    Render,
    Script,
    WorkspaceMember,
)

ROLES = ("viewer", "editor", "admin", "owner")
RANK = {role: n for n, role in enumerate(ROLES, start=1)}
PROJECT_ROLES = ("viewer", "editor")
READ_METHODS = {"GET", "HEAD", "OPTIONS"}
PREFIX = "/api/v1"

# (methods, route template regex, minimum role). First match wins. Templates are matched without
# the /api/v1 prefix; ``None`` methods means every method.
ADMIN_RULES: list[tuple[set[str] | None, str, str]] = [
    ({"GET"}, r"^/workspace/invites", "admin"),
    (None, r"^/workspace(/.*)?$", "admin"),
    (None, r"^/youtube/(oauth|connection|disconnect|sync).*", "admin"),
    ({"PUT", "POST"}, r"^/(profile|onboarding)$", "admin"),
    ({"POST"}, r"^/llm/test$", "admin"),
]
# Viewers may do these writes (they are scoped to the caller's own data in the handlers).
VIEWER_WRITES = [
    re.compile(r"^/content/\{item_id\}/comments$"),
    re.compile(r"^/comments/\{comment_id\}$"),
    re.compile(r"^/content/\{item_id\}/presence$"),
    re.compile(r"^/invites/\{token\}/accept$"),
    # the community feed: anyone signed in may like and comment; authors edit their own posts
    re.compile(r"^/community/posts/\{post_id\}(/like|/comments)?$"),
    re.compile(r"^/community/comments/\{community_comment_id\}$"),
]


def at_least(role: str | None, need: str) -> bool:
    return RANK.get(role or "", 0) >= RANK[need]


def workspace_role(db: Session, user_id: str, workspace_id: str) -> str | None:
    return db.scalar(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
        )
    )


def project_role(db: Session, user_id: str, content_item_id: str) -> str | None:
    return db.scalar(
        select(ProjectMember.role).where(
            ProjectMember.content_item_id == content_item_id, ProjectMember.user_id == user_id
        )
    )


def effective_role(
    db: Session, user_id: str, workspace_id: str, role: str, content_item_id: str | None
) -> str:
    """The role that applies to a project: its override, unless the user is admin/owner."""
    if content_item_id is None or at_least(role, "admin"):
        return role
    return project_role(db, user_id, content_item_id) or role


def project_of(db: Session, workspace_id: str, params: dict[str, str]) -> str | None:
    """The content item (project) a request is about, from its path parameters (or ``None``)."""
    if item := params.get("item_id"):
        return item
    lookups: list[tuple[str, type, str]] = [
        ("clip_id", Clip, "content_item_id"),
        ("script_id", Script, "content_item_id"),
        ("match_id", BeatMatch, "content_item_id"),
        ("asset_id", Asset, "content_item_id"),
        ("comment_id", Comment, "content_item_id"),
    ]
    for name, model, column in lookups:
        if name in params:
            row = db.get(model, params[name])
            return (
                getattr(row, column)
                if row is not None and row.workspace_id == workspace_id
                else None
            )
    if render_id := params.get("render_id"):
        render = db.get(Render, render_id)
        if render is not None and render.workspace_id == workspace_id:
            clip = db.get(Clip, render.clip_id)
            return clip.content_item_id if clip is not None else None
    return None


def required_role(method: str, template: str) -> str:
    """The minimum role for ``method`` on a route ``template`` (before project overrides)."""
    path = template.removeprefix(PREFIX) or "/"
    for methods, pattern, need in ADMIN_RULES:
        if (methods is None or method in methods) and re.match(pattern, path):
            if (
                methods is None
                and method in READ_METHODS
                and not path.startswith("/workspace/invites")
            ):
                return "viewer"
            return need
    if method in READ_METHODS:
        return "viewer"
    if any(p.match(path) for p in VIEWER_WRITES):
        return "viewer"
    return "editor"


@dataclass(frozen=True)
class Decision:
    role: str  # the workspace role
    effective: str  # the role on the project the request is about (same when there is none)
    need: str


def authorize(
    db: Session,
    *,
    user_id: str,
    workspace_id: str,
    role: str,
    method: str,
    template: str,
    params: dict[str, str],
) -> Decision:
    """Raise ``FORBIDDEN`` unless ``role`` may make this request."""
    need = required_role(method, template)
    if (
        need == "admin"
        and method == "DELETE"
        and template.removeprefix(PREFIX).startswith("/workspace/members/")
        and params.get("user_id") == user_id
    ):
        need = "viewer"  # anyone may leave a workspace themselves
    project = project_of(db, workspace_id, params) if need == "editor" else None
    effective = effective_role(db, user_id, workspace_id, role, project)
    if not at_least(effective, need):
        if need == "admin":
            msg = "Only workspace admins can do this."
        elif project and at_least(role, "editor"):
            msg = "You have view-only access to this project."
        else:
            msg = "You have view-only access to this workspace. Ask an admin for editor access."
        raise AppError(
            "FORBIDDEN",
            msg,
            status=403,
            details={"role": effective, "needs": need, "workspace_role": role},
        )
    return Decision(role=role, effective=effective, need=need)
