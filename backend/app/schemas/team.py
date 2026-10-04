"""Teams, invites, comments and presence: request and response models."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Role = Literal["viewer", "editor", "admin", "owner"]
InviteRole = Literal["viewer", "editor", "admin"]
ProjectRole = Literal["viewer", "editor"]
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class WorkspaceOut(BaseModel):
    id: str
    name: str
    role: Role
    member_count: int
    created_at: str


class WorkspaceRename(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class MemberOut(BaseModel):
    user_id: str
    email: str
    display_name: str
    role: Role
    joined_at: str
    is_me: bool = False


class MemberRoleUpdate(BaseModel):
    role: Role


class InviteCreate(BaseModel):
    email: str = Field(max_length=254)
    role: InviteRole = "editor"
    content_item_id: str | None = None
    project_role: ProjectRole | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_RE.match(value):
            raise ValueError("must be a valid email address")
        return value


class InviteOut(BaseModel):
    id: str
    email: str
    role: InviteRole
    content_item_id: str | None
    project_title: str | None
    project_role: ProjectRole | None
    invited_by_name: str | None
    expires_at: str
    created_at: str
    status: Literal["pending", "accepted", "expired"]
    token: str | None = None  # only in the response that creates it, and to admins
    link: str | None = None


class InvitePreview(BaseModel):
    """What the invited person sees before accepting (no sign-in needed)."""

    workspace_name: str
    inviter_name: str | None
    email: str
    role: InviteRole
    project_title: str | None
    project_role: ProjectRole | None
    expires_at: str
    status: Literal["pending", "accepted", "expired"]
    account_exists: bool


class InviteAccepted(BaseModel):
    workspace_id: str
    workspace_name: str
    role: Role
    content_item_id: str | None


class ProjectMemberOut(BaseModel):
    user_id: str
    email: str
    display_name: str
    workspace_role: Role
    project_role: ProjectRole | None  # None = inherits the workspace role
    effective_role: Role


class ProjectMemberSet(BaseModel):
    role: ProjectRole


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    clip_id: str | None = None
    at_sec: float | None = Field(default=None, ge=0)
    parent_id: str | None = None


class CommentPatch(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=4000)
    resolved: bool | None = None


class CommentOut(BaseModel):
    id: str
    content_item_id: str
    clip_id: str | None
    parent_id: str | None
    at_sec: float | None
    body: str
    resolved: bool
    author_id: str
    author_name: str
    created_at: str
    updated_at: str
    mine: bool = False


class PresenceBeat(BaseModel):
    where: str = Field(min_length=1, max_length=80)  # e.g. "editor:<clip id>", "script", "plan"


class PresenceOut(BaseModel):
    user_id: str
    name: str
    where: str
    seconds_ago: int
