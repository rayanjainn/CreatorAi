"""Workspace members, invites and per-project roles (no FastAPI imports)."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import AppError, not_found
from app.models import (
    ContentItem,
    Invite,
    ProjectMember,
    User,
    Workspace,
    WorkspaceMember,
)
from app.models.base import utcnow
from app.services import access
from app.services.activity import log_activity

INVITE_DAYS = 7


def display_name(user: User) -> str:
    return user.display_name or user.email.split("@")[0]


# ── members ──────────────────────────────────────────────────────────────────────────────────
def workspace_out(db: Session, workspace_id: str, role: str) -> dict[str, Any]:
    ws = db.get(Workspace, workspace_id)
    if ws is None:
        raise not_found("Workspace")
    count = db.scalar(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace_id)
    )
    return {
        "id": ws.id,
        "name": ws.name,
        "role": role,
        "member_count": int(count or 0),
        "created_at": ws.created_at,
    }


def list_members(db: Session, workspace_id: str, me: str) -> list[dict[str, Any]]:
    rows = db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at)
    ).all()
    out = [
        {
            "user_id": u.id,
            "email": u.email,
            "display_name": display_name(u),
            "role": m.role,
            "joined_at": m.created_at,
            "is_me": u.id == me,
        }
        for m, u in rows
    ]
    out.sort(key=lambda r: (-access.RANK[r["role"]], r["joined_at"]))
    return out


def _owner_count(db: Session, workspace_id: str) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.role == "owner")
        )
        or 0
    )


def _member(db: Session, workspace_id: str, user_id: str) -> WorkspaceMember:
    row = db.get(WorkspaceMember, (workspace_id, user_id))
    if row is None:
        raise not_found("Member")
    return row


def _may_manage(actor_role: str, target_role: str, new_role: str | None) -> None:
    """Owners manage everyone; admins manage editors and viewers and cannot grant admin or owner."""
    if actor_role == "owner":
        return
    if access.at_least(target_role, "admin") or (new_role and access.at_least(new_role, "admin")):
        raise AppError("FORBIDDEN", "Only an owner can change admins and owners.", status=403)


def change_role(
    db: Session, workspace_id: str, actor: str, actor_role: str, user_id: str, role: str
) -> WorkspaceMember:
    target = _member(db, workspace_id, user_id)
    _may_manage(actor_role, target.role, role)
    if target.role == "owner" and role != "owner" and _owner_count(db, workspace_id) <= 1:
        raise AppError(
            "LAST_OWNER",
            "A workspace needs at least one owner. Make someone else an owner first.",
            status=409,
        )
    previous, target.role = target.role, role
    db.flush()
    log_activity(
        db, workspace_id, "member_role_changed", "user", user_id, **{"from": previous, "to": role}
    )
    return target


def remove_member(
    db: Session, workspace_id: str, actor: str, actor_role: str, user_id: str
) -> None:
    target = _member(db, workspace_id, user_id)
    leaving = user_id == actor
    home = db.scalar(select(Workspace.id).where(Workspace.owner_id == user_id))
    if home == workspace_id:
        raise AppError(
            "HOME_WORKSPACE",
            "That is this person's own workspace; they cannot be removed from it.",
            status=409,
        )
    if not leaving:
        _may_manage(actor_role, target.role, None)
    if target.role == "owner" and _owner_count(db, workspace_id) <= 1:
        raise AppError(
            "LAST_OWNER",
            "A workspace needs at least one owner. Make someone else an owner first.",
            status=409,
        )
    for pm in db.scalars(
        select(ProjectMember)
        .join(ContentItem, ContentItem.id == ProjectMember.content_item_id)
        .where(ContentItem.workspace_id == workspace_id, ProjectMember.user_id == user_id)
    ):
        db.delete(pm)
    db.delete(target)
    db.flush()
    log_activity(db, workspace_id, "member_left" if leaving else "member_removed", "user", user_id)


def rename_workspace(db: Session, workspace_id: str, name: str) -> Workspace:
    ws = db.get(Workspace, workspace_id)
    if ws is None:
        raise not_found("Workspace")
    ws.name = name.strip()
    db.flush()
    return ws


def my_workspaces(db: Session, user_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        select(WorkspaceMember, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(Workspace.created_at)
    ).all()
    return [
        {"id": w.id, "name": w.name, "role": m.role, "is_home": w.owner_id == user_id}
        for m, w in rows
    ]


# ── invites ──────────────────────────────────────────────────────────────────────────────────
def _status(inv: Invite) -> str:
    if inv.accepted_at:
        return "accepted"
    if inv.expires_at < utcnow():
        return "expired"
    return "pending"


def invite_link(token: str) -> str:
    return f"{get_settings().frontend_url.rstrip('/')}/invite/{token}"


def invite_out(db: Session, inv: Invite, *, with_token: bool = False) -> dict[str, Any]:
    inviter = db.get(User, inv.invited_by) if inv.invited_by else None
    item = db.get(ContentItem, inv.content_item_id) if inv.content_item_id else None
    return {
        "id": inv.id,
        "email": inv.email,
        "role": inv.role,
        "content_item_id": inv.content_item_id,
        "project_title": item.title if item else None,
        "project_role": inv.project_role,
        "invited_by_name": display_name(inviter) if inviter else None,
        "expires_at": inv.expires_at,
        "created_at": inv.created_at,
        "status": _status(inv),
        "token": inv.token if with_token else None,
        "link": invite_link(inv.token) if with_token else None,
    }


def create_invite(
    db: Session,
    workspace_id: str,
    actor: str,
    actor_role: str,
    *,
    email: str,
    role: str,
    content_item_id: str | None,
    project_role: str | None,
) -> Invite:
    if role == "admin" and actor_role != "owner":
        raise AppError("FORBIDDEN", "Only an owner can invite admins.", status=403)
    if bool(content_item_id) != bool(project_role):
        raise AppError("VALIDATION_ERROR", "Send content_item_id and project_role together.")
    if content_item_id:
        item = db.get(ContentItem, content_item_id)
        if item is None or item.workspace_id != workspace_id:
            raise not_found("Project")
    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user and db.get(WorkspaceMember, (workspace_id, existing_user.id)):
        raise AppError(
            "ALREADY_MEMBER", "That person is already a member of this workspace.", status=409
        )
    now = utcnow()
    for old in db.scalars(
        select(Invite).where(
            Invite.workspace_id == workspace_id, Invite.email == email, Invite.accepted_at.is_(None)
        )
    ):
        db.delete(old)  # one open invite per person: a new one replaces the old link
    inv = Invite(
        workspace_id=workspace_id,
        email=email,
        role=role,
        content_item_id=content_item_id,
        project_role=project_role,
        token=secrets.token_urlsafe(24),
        invited_by=actor,
        expires_at=(datetime.now(UTC) + timedelta(days=INVITE_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        created_at=now,
    )
    db.add(inv)
    db.flush()
    log_activity(db, workspace_id, "member_invited", "invite", inv.id, email=email, role=role)
    return inv


def list_invites(db: Session, workspace_id: str) -> list[Invite]:
    return list(
        db.scalars(
            select(Invite)
            .where(Invite.workspace_id == workspace_id, Invite.accepted_at.is_(None))
            .order_by(Invite.created_at.desc())
        )
    )


def revoke_invite(db: Session, workspace_id: str, invite_id: str) -> None:
    inv = db.get(Invite, invite_id)
    if inv is None or inv.workspace_id != workspace_id:
        raise not_found("Invite")
    db.delete(inv)
    db.flush()


def find_invite(db: Session, token: str) -> Invite:
    inv = db.scalar(select(Invite).where(Invite.token == token))
    if inv is None:
        raise AppError(
            "INVITE_INVALID", "This invite link is not valid. Ask for a new one.", status=404
        )
    return inv


def preview(db: Session, token: str) -> dict[str, Any]:
    inv = find_invite(db, token)
    ws = db.get(Workspace, inv.workspace_id)
    inviter = db.get(User, inv.invited_by) if inv.invited_by else None
    item = db.get(ContentItem, inv.content_item_id) if inv.content_item_id else None
    return {
        "workspace_name": ws.name if ws else "a workspace",
        "inviter_name": display_name(inviter) if inviter else None,
        "email": inv.email,
        "role": inv.role,
        "project_title": item.title if item else None,
        "project_role": inv.project_role,
        "expires_at": inv.expires_at,
        "status": _status(inv),
        "account_exists": db.scalar(select(User.id).where(User.email == inv.email)) is not None,
    }


def accept_invite(db: Session, token: str, user: User) -> dict[str, Any]:
    """Join the workspace (idempotent for the same person). The invite is for one email address."""
    inv = find_invite(db, token)
    if inv.accepted_at and inv.accepted_by != user.id:
        raise AppError("INVITE_USED", "This invite has already been used.", status=410)
    if not inv.accepted_at and _status(inv) == "expired":
        raise AppError("INVITE_EXPIRED", "This invite has expired. Ask for a new link.", status=410)
    if inv.email.lower() != user.email.lower():
        raise AppError(
            "INVITE_EMAIL_MISMATCH",
            f"This invite was sent to {inv.email}, but you are signed in as {user.email}.",
            status=403,
            details={"invited_email": inv.email, "signed_in_as": user.email},
        )
    member = db.get(WorkspaceMember, (inv.workspace_id, user.id))
    if member is None:
        member = WorkspaceMember(
            workspace_id=inv.workspace_id, user_id=user.id, role=inv.role, invited_by=inv.invited_by
        )
        db.add(member)
    elif access.RANK[inv.role] > access.RANK[member.role]:
        member.role = inv.role
    if (
        inv.content_item_id
        and inv.project_role
        and not db.get(ProjectMember, (inv.content_item_id, user.id))
    ):
        db.add(
            ProjectMember(
                content_item_id=inv.content_item_id, user_id=user.id, role=inv.project_role
            )
        )
    if not inv.accepted_at:
        inv.accepted_at, inv.accepted_by = utcnow(), user.id
        log_activity(db, inv.workspace_id, "member_joined", "user", user.id, role=inv.role)
    db.flush()
    ws = db.get(Workspace, inv.workspace_id)
    return {
        "workspace_id": inv.workspace_id,
        "workspace_name": ws.name if ws else "",
        "role": member.role,
        "content_item_id": inv.content_item_id,
    }


# ── per-project roles ────────────────────────────────────────────────────────────────────────
def project_members(db: Session, workspace_id: str, item_id: str) -> list[dict[str, Any]]:
    item = db.get(ContentItem, item_id)
    if item is None or item.workspace_id != workspace_id:
        raise not_found("Project")
    overrides = {
        pm.user_id: pm.role
        for pm in db.scalars(select(ProjectMember).where(ProjectMember.content_item_id == item_id))
    }
    rows = db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
    ).all()
    out = []
    for m, u in rows:
        override = overrides.get(u.id)
        effective = m.role if access.at_least(m.role, "admin") or override is None else override
        out.append(
            {
                "user_id": u.id,
                "email": u.email,
                "display_name": display_name(u),
                "workspace_role": m.role,
                "project_role": override,
                "effective_role": effective,
            }
        )
    out.sort(key=lambda r: (-access.RANK[r["effective_role"]], r["display_name"].lower()))
    return out


def set_project_role(db: Session, workspace_id: str, item_id: str, user_id: str, role: str) -> None:
    project_members(db, workspace_id, item_id)  # validates the project
    member = db.get(WorkspaceMember, (workspace_id, user_id))
    if member is None:
        raise not_found("Member")
    if access.at_least(member.role, "admin"):
        raise AppError(
            "VALIDATION_ERROR", "Admins and owners always have full access to every project."
        )
    row = db.get(ProjectMember, (item_id, user_id))
    if row is None:
        db.add(ProjectMember(content_item_id=item_id, user_id=user_id, role=role))
    else:
        row.role = role
    db.flush()
    log_activity(
        db, workspace_id, "project_role_set", "content_item", item_id, user_id=user_id, role=role
    )


def clear_project_role(db: Session, workspace_id: str, item_id: str, user_id: str) -> None:
    project_members(db, workspace_id, item_id)
    row = db.get(ProjectMember, (item_id, user_id))
    if row is not None:
        db.delete(row)
        db.flush()
