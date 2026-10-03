"""Models for hooks, scripts, scenes and script metadata."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Provenance


class HooksRequest(BaseModel):
    count: int = Field(default=5, ge=1, le=10)
    tone: str | None = Field(default=None, max_length=60)
    platform: str | None = Field(default=None, max_length=40)


class HookOut(BaseModel):
    text: str
    type: str
    why: str = ""
    signal_score: float = Field(description="ml.hooks.hook_signals of the text, 0-1")
    detected_type: str = Field(description="ml.hooks.classify_hook of the text")


class HooksOut(BaseModel):
    script_id: str
    hooks: list[HookOut]
    provenance: Provenance


class GenerateScriptRequest(BaseModel):
    hook: str = Field(min_length=1, max_length=400)
    tone: str | None = Field(default=None, max_length=60)
    platform: str | None = Field(default=None, max_length=40)
    length_sec: int | None = Field(default=None, ge=10, le=900)


class SceneIn(BaseModel):
    """A scene sent by the editor. ``beats`` is optional: without it (or when the beats no longer
    add up to ``text``) the text is re-split into beats of 1-2 sentences."""

    title: str = Field(default="", max_length=120)
    intent: str = Field(default="", max_length=300)
    text: str = Field(default="", max_length=20000)
    beats: list[dict[str, Any]] | None = None


class MetaPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    titles: list[str] | None = None
    description: str | None = None
    ctas: list[str] | None = None
    captions: list[str] | None = None
    tags: list[str] | None = None
    supporting: dict[str, Any] | None = None


class ScriptPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body_md: str | None = Field(default=None, max_length=100000)
    scenes: list[SceneIn] | None = None
    selected_hook: str | None = Field(default=None, max_length=400)
    meta: MetaPatch | None = None


class RegenerateSceneRequest(BaseModel):
    instruction: str = Field(default="", max_length=500)


class TightenRequest(BaseModel):
    target_ratio: float = Field(default=0.75, ge=0.3, le=0.95)


class ScriptOut(BaseModel):
    id: str
    content_item_id: str
    version: int
    is_current: bool
    hook_options: list[dict[str, Any]]
    selected_hook: str
    body_md: str
    scenes: list[dict[str, Any]]
    meta: dict[str, Any]
    tone: str | None
    platform: str | None
    length_sec: int | None
    provider: str | None
    model: str | None
    created_at: str
    updated_at: str
    counters: dict[str, Any]
    style_applied: bool = Field(description="Twin style profile revision > 0 (banner flag)")
    approved: bool
    approved_at: str | None
    edited_by_user: dict[str, Any]
    generation: dict[str, Any]
    provenance: Provenance
    provenance_by_part: dict[str, Any]


class ScriptVersionOut(BaseModel):
    id: str
    version: int
    is_current: bool
    created_at: str
    updated_at: str
    tone: str | None
    platform: str | None
    length_sec: int | None
    selected_hook: str
    word_count: int
    scene_count: int
    approved: bool
    edited: bool
    provenance: Provenance


class SceneRewriteOut(BaseModel):
    script: ScriptOut
    scene: dict[str, Any]
    words_before: int
    words_after: int
    provenance: Provenance


class ScriptMetaOut(BaseModel):
    script_id: str
    meta: dict[str, Any]
    provenance: Provenance
