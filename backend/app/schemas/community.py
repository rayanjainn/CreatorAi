"""Request and response models of the community feed (``/api/v1/community``)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Platform = Literal["youtube", "instagram", "tiktok"]


class CommunityAuthor(BaseModel):
    id: str | None
    name: str


class PostCreate(BaseModel):
    """Share exactly one of ``render_id`` (a finished render) or ``asset_id`` (a ready video)."""

    render_id: str | None = None
    asset_id: str | None = None
    title: str | None = Field(default=None, max_length=200)
    body: str = Field(default="", max_length=5000)
    platforms: list[Platform] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list, max_length=20)


class PostPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=5000)
    platforms: list[Platform] | None = None
    tags: list[str] | None = Field(default=None, max_length=20)


class PostOut(BaseModel):
    id: str
    title: str
    body: str
    platforms: list[Platform]
    tags: list[str]
    author: CommunityAuthor
    workspace_name: str | None
    video_url: str
    thumbnail_url: str | None
    duration_sec: float | None
    aspect: str | None
    render_id: str | None
    asset_id: str | None
    mine: bool
    like_count: int
    comment_count: int
    liked_by_me: bool
    created_at: str
    updated_at: str


class PostPage(BaseModel):
    items: list[PostOut]
    total: int
    limit: int
    offset: int


class LikeOut(BaseModel):
    post_id: str
    liked: bool
    like_count: int


class CommunityCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_id: str | None = None


class CommunityCommentPatch(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class CommunityCommentOut(BaseModel):
    id: str
    post_id: str
    parent_id: str | None
    body: str
    author: CommunityAuthor
    mine: bool
    can_delete: bool
    by_post_author: bool
    created_at: str
    updated_at: str
