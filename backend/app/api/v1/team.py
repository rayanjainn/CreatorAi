"""Team: workspace, members, invites, per-project roles and the public invite endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.deps import CtxDep, DbDep, UserDep
from app.errors import AppError
from app.models import User
from app.schemas.team import (
    InviteAccepted,
    InviteCreate,
    InviteOut,
    InvitePreview,
    MemberOut,
    MemberRoleUpdate,
    ProjectMemberOut,
    ProjectMemberSet,
    WorkspaceOut,
    WorkspaceRename,
)
from app.services import account_admin, team

router = APIRouter(tags=["team"])


@router.get("/workspace", response_model=WorkspaceOut)
def get_workspace(ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    return team.workspace_out(db, ctx.workspace_id, ctx.role)


@router.patch("/workspace", response_model=WorkspaceOut)
def rename(body: WorkspaceRename, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    team.rename_workspace(db, ctx.workspace_id, body.name)
    return team.workspace_out(db, ctx.workspace_id, ctx.role)


@router.get("/workspace/export")
def export_data(ctx: CtxDep, db: DbDep) -> JSONResponse:
    """Everything you made here as one JSON file (projects, scripts, plans, transcripts, deals,
    research, Twin memories). Media files are not included."""
    data = account_admin.export(db, ctx.workspace_id)
    name = f"creatorai-export-{data['exported_at'][:10]}.json"
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="{name}"'})


class WipeBody(BaseModel):
    confirm: str = Field(description='Type "DELETE" to confirm')


@router.post("/workspace/wipe")
def wipe_data(body: WipeBody, ctx: CtxDep, db: DbDep) -> dict[str, int]:
    """Owner only: delete every project, file and generated row; keep the account and team."""
    if body.confirm != "DELETE":
        raise AppError("CONFIRMATION_REQUIRED", "Type DELETE to confirm.", status=409)
    return account_admin.wipe(db, ctx.workspace_id, ctx.role)


@router.get("/workspace/members", response_model=list[MemberOut])
def members(ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return team.list_members(db, ctx.workspace_id, ctx.user_id)


@router.patch("/workspace/members/{user_id}", response_model=MemberOut)
def set_role(user_id: str, body: MemberRoleUpdate, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    team.change_role(db, ctx.workspace_id, ctx.user_id, ctx.role, user_id, body.role)
    return next(
        m for m in team.list_members(db, ctx.workspace_id, ctx.user_id) if m["user_id"] == user_id
    )


@router.delete("/workspace/members/{user_id}", status_code=204)
def remove(user_id: str, ctx: CtxDep, db: DbDep) -> Response:
    """Remove someone, or leave yourself (``user_id`` = you). The last owner cannot leave."""
    team.remove_member(db, ctx.workspace_id, ctx.user_id, ctx.role, user_id)
    return Response(status_code=204)


@router.get("/workspace/invites", response_model=list[InviteOut])
def invites(ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return [
        team.invite_out(db, i, with_token=True) for i in team.list_invites(db, ctx.workspace_id)
    ]


@router.post("/workspace/invites", response_model=InviteOut, status_code=201)
def invite(body: InviteCreate, ctx: CtxDep, db: DbDep) -> dict[str, Any]:
    """Create an invite link. No email is sent: copy the link and share it with the person."""
    inv = team.create_invite(
        db,
        ctx.workspace_id,
        ctx.user_id,
        ctx.role,
        email=body.email,
        role=body.role,
        content_item_id=body.content_item_id,
        project_role=body.project_role,
    )
    return team.invite_out(db, inv, with_token=True)


@router.delete("/workspace/invites/{invite_id}", status_code=204)
def revoke(invite_id: str, ctx: CtxDep, db: DbDep) -> Response:
    team.revoke_invite(db, ctx.workspace_id, invite_id)
    return Response(status_code=204)


# ── public + account-level (no workspace needed) ─────────────────────────────────────────────
@router.get("/invites/{token}", response_model=InvitePreview)
def preview(token: str, db: DbDep) -> dict[str, Any]:
    """What an invite is for, so the invited person can decide. Public: the token is the secret."""
    return team.preview(db, token)


@router.post("/invites/{token}/accept", response_model=InviteAccepted)
def accept(token: str, user_id: UserDep, db: DbDep) -> dict[str, Any]:
    user = db.get(User, user_id)
    assert user is not None  # UserDep verified it
    return team.accept_invite(db, token, user)


# ── per-project roles ────────────────────────────────────────────────────────────────────────
@router.get("/content/{item_id}/members", response_model=list[ProjectMemberOut])
def project_members(item_id: str, ctx: CtxDep, db: DbDep) -> list[dict[str, Any]]:
    return team.project_members(db, ctx.workspace_id, item_id)


@router.put("/workspace/projects/{project_item_id}/members/{user_id}", status_code=204)
def set_project_role(
    project_item_id: str, user_id: str, body: ProjectMemberSet, ctx: CtxDep, db: DbDep
) -> Response:
    """Override a member's role on one project (admins only; admins/owners are unrestricted)."""
    team.set_project_role(db, ctx.workspace_id, project_item_id, user_id, body.role)
    return Response(status_code=204)


@router.delete("/workspace/projects/{project_item_id}/members/{user_id}", status_code=204)
def clear_project_role(project_item_id: str, user_id: str, ctx: CtxDep, db: DbDep) -> Response:
    team.clear_project_role(db, ctx.workspace_id, project_item_id, user_id)
    return Response(status_code=204)
