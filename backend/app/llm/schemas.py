"""Pydantic output models for every LLM task (Plan.md sections 6 and 7)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

HookType = Literal["question", "number", "bold_claim", "story", "contrast"]
Severity = Literal["low", "medium", "high"]

# Twin actions the server will accept (Plan.md section 6.8). Anything else is dropped.
ALLOWED_ACTION_TYPES: tuple[str, ...] = (
    "tighten_pauses",
    "set_caption_style",
    "trim_clip",
    "regenerate_hooks",
    "create_idea",
    "toggle_music",
)


# ── director ─────────────────────────────────────────────────────────────────────────────────
class PlanSection(BaseModel):
    section: str
    goal: str
    duration_sec: float = Field(ge=0)
    notes: str = ""


class ShotListEntry(BaseModel):
    scene: int
    shot_type: str
    framing: str
    b_roll: str = ""
    note: str = ""


class DirectorPlan(BaseModel):
    """``director.plan`` output and the ``director_outputs`` plan payload (section 6.4)."""

    domain: str
    objective: str
    audience: str
    angle: str
    structure: list[PlanSection] = Field(min_length=1)
    storytelling: list[str] = Field(default_factory=list)
    shot_list: list[ShotListEntry] = Field(default_factory=list)
    hook_ideas: list[str] = Field(default_factory=list)
    cta: str = ""
    risks: list[str] = Field(default_factory=list)


class ReviewIssue(BaseModel):
    type: str
    severity: Severity = "medium"
    at_sec: float | None = None
    scene_idx: int | None = None
    fix: str


class DirectorReviewOutput(BaseModel):
    """``director.review`` LLM output. Scores are computed in code and never written by the LLM."""

    strengths: list[str] = Field(default_factory=list)
    issues: list[ReviewIssue] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)


class MissingScene(BaseModel):
    scene_idx: int
    beat_idx: int
    text: str
    suggestion: str = ""


class DirectorReviewPayload(DirectorReviewOutput):
    """Stored review (section 6.5): deterministic scores merged with the LLM text."""

    overall_score: float
    scores: dict[str, float]
    missing_scenes: list[MissingScene] = Field(default_factory=list)


# ── scripts ──────────────────────────────────────────────────────────────────────────────────
class Hook(BaseModel):
    text: str
    type: HookType
    why: str = ""


class HooksOutput(BaseModel):
    hooks: list[Hook] = Field(min_length=1)


class ScriptBeatOut(BaseModel):
    idx: int
    text: str
    intent: str = ""
    est_sec: float = Field(default=5.0, ge=0)


class ScriptScene(BaseModel):
    idx: int
    title: str
    intent: str = ""
    est_sec: float = Field(default=0.0, ge=0)
    text: str
    beats: list[ScriptBeatOut] = Field(min_length=1)


class ScriptSupporting(BaseModel):
    pinned_comment: str = ""
    thumbnail_text: list[str] = Field(default_factory=list)


class ScriptMeta(BaseModel):
    """``script.meta`` output and ``scripts.meta`` (section 6.6)."""

    titles: list[str] = Field(min_length=1)
    description: str = ""
    ctas: list[str] = Field(default_factory=list)
    captions: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    supporting: ScriptSupporting = Field(default_factory=ScriptSupporting)


class ScriptGenerateOutput(BaseModel):
    body_md: str
    scenes: list[ScriptScene] = Field(min_length=1)
    meta: ScriptMeta


# ── assets / matching / clips ────────────────────────────────────────────────────────────────
class ShotCaption(BaseModel):
    id: str
    caption: str
    tags: list[str] = Field(default_factory=list)


class CaptionKeyframesOutput(BaseModel):
    shots: list[ShotCaption]
    description: str = ""
    tags: list[str] = Field(default_factory=list)


class MatchDisambiguateOutput(BaseModel):
    best_id: str
    confidence: float = Field(ge=0, le=1)


class ClipCopy(BaseModel):
    candidate_id: str
    keep: bool
    rank: int = Field(ge=1)
    title: str
    hook: str
    caption: str
    reason: str = ""


class ClipRerankOutput(BaseModel):
    """``clips.rerank_copy`` output (section 6.7)."""

    clips: list[ClipCopy]


# ── sponsors ─────────────────────────────────────────────────────────────────────────────────
class SponsorSlotCopy(BaseModel):
    slot_id: str
    integration_script: str
    lower_third: str
    transition_back: str = ""


class SponsorIntegrationOutput(BaseModel):
    slots: list[SponsorSlotCopy]


# ── twin ─────────────────────────────────────────────────────────────────────────────────────
class TwinAction(BaseModel):
    type: Literal[
        "tighten_pauses",
        "set_caption_style",
        "trim_clip",
        "regenerate_hooks",
        "create_idea",
        "toggle_music",
    ]
    clip_id: str | None = None
    content_item_id: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class TwinChatOutput(BaseModel):
    """``twin.chat`` output (section 6.8). Actions with unknown types are dropped, not rejected."""

    reply: str
    actions: list[TwinAction] = Field(default_factory=list)

    @field_validator("actions", mode="before")
    @classmethod
    def _drop_unknown_actions(cls, value: Any) -> Any:
        if not isinstance(value, list):
            return []
        return [a for a in value if isinstance(a, dict) and a.get("type") in ALLOWED_ACTION_TYPES]


class Vocabulary(BaseModel):
    favor: list[str] = Field(default_factory=list)
    avoid: list[str] = Field(default_factory=list)


class StyleExtractOutput(BaseModel):
    tone_descriptors: list[str]
    vocabulary: Vocabulary
    dos: list[str] = Field(default_factory=list)
    donts: list[str] = Field(default_factory=list)
    summary: str


# ── insights ─────────────────────────────────────────────────────────────────────────────────
class NextIdea(BaseModel):
    title: str
    rationale: str


class InsightsNarrateOutput(BaseModel):
    narrative: list[str] = Field(min_length=1)
    caveats: list[str] = Field(default_factory=list)
    ideas: list[NextIdea] = Field(default_factory=list)


TASK_SCHEMAS: dict[str, type[BaseModel]] = {
    "director.plan": DirectorPlan,
    "director.review": DirectorReviewOutput,
    "script.hooks": HooksOutput,
    "script.generate": ScriptGenerateOutput,
    "script.meta": ScriptMeta,
    "assets.caption_keyframes": CaptionKeyframesOutput,
    "match.disambiguate": MatchDisambiguateOutput,
    "clips.rerank_copy": ClipRerankOutput,
    "sponsors.integration": SponsorIntegrationOutput,
    "twin.chat": TwinChatOutput,
    "twin.style_extract": StyleExtractOutput,
    "insights.narrate_ideas": InsightsNarrateOutput,
}
