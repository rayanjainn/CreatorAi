"""Timeline contract (Plan.md section 6.1), stored in ``edits.timeline`` and ``edit_revisions``.

Names for other modules (renders, sponsors, twin): :class:`Timeline`, :class:`Tracks`,
:class:`VideoItem`, :class:`CaptionItem`, :class:`AudioItem`, :class:`OverlayItem`,
:class:`Transition`, :class:`CaptionWord`. Every item carries the layer provenance fields
``source`` (``ai`` | ``user``), ``status`` (``suggested`` | ``accepted`` | ``rejected``; a render
includes every layer that is not ``rejected``) and an optional ``reason``. That layer provenance is
unrelated to :class:`app.schemas.common.Provenance` (the API-level badge of generated content).

Structural rules live here (types, ranges, ids). The cross-item invariants (gapless video track,
durations, source ranges against the asset) are in ``services/timeline_service.validate``.
Sponsor video items (section 8.10) are ``VideoItem(kind="sponsor")``: ``asset_id`` may be ``None``
only while ``placeholder`` is true. A still image dropped on the video track is ``kind="image"``:
``src_in`` is 0 and ``src_out`` is how long it is shown (an image has no source duration to check).
"""

from __future__ import annotations

import secrets
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

LayerSource = Literal["ai", "user"]
LayerStatus = Literal["suggested", "accepted", "rejected"]
CaptionStyle = Literal["bold_center", "minimal_bottom", "karaoke"]
Aspect = Literal["9:16", "16:9"]

SIZES: dict[str, tuple[int, int]] = {"9:16": (1080, 1920), "16:9": (1920, 1080)}
ID_PREFIX = {"video": "v_", "captions": "c_", "audio": "a_", "overlays": "o_"}
DEFAULT_MUSIC_GAIN_DB = -18.0


def new_item_id(prefix: str) -> str:
    """``"v_1a2b3c4d5e"``-style id. ``prefix`` is ``v``, ``c``, ``a`` or ``o``."""
    return f"{prefix.rstrip('_')}_{secrets.token_hex(5)}"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LayerBase(_Strict):
    """Layer provenance shared by every timeline item (Plan 6.1 ``Provenance``)."""

    id: str = Field(min_length=3)
    source: LayerSource
    status: LayerStatus
    reason: str | None = None


class Transition(_Strict):
    type: Literal["cut", "fade", "dissolve"] = "cut"
    dur: float = Field(default=0.0, ge=0.0, le=0.5)

    @model_validator(mode="after")
    def _duration(self) -> Transition:
        if self.type != "cut" and self.dur < 0.1:
            raise ValueError("fade and dissolve transitions need dur between 0.1 and 0.5")
        return self


class VideoItem(LayerBase):
    kind: Literal["clip", "sponsor", "image"] = "clip"
    asset_id: str | None = None
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    tl_start: float = Field(ge=0)
    crop_x: float = Field(default=0.5, ge=0.0, le=1.0)
    transition_in: Transition | None = None
    speed: Literal[1] = 1
    placeholder: bool = False
    text: str | None = None

    @model_validator(mode="after")
    def _shape(self) -> VideoItem:
        if self.asset_id is None and not (self.kind == "sponsor" and self.placeholder):
            raise ValueError("asset_id may be null only for a sponsor placeholder")
        if self.kind == "clip" and self.placeholder:
            raise ValueError("only sponsor items can be placeholders")
        return self

    @property
    def duration(self) -> float:
        return self.src_out - self.src_in

    @property
    def tl_end(self) -> float:
        return self.tl_start + self.duration


class CaptionWord(_Strict):
    w: str
    t0: float
    t1: float


class CaptionItem(LayerBase):
    tl_start: float = Field(ge=0)
    tl_end: float = Field(gt=0)
    text: str = Field(min_length=1)
    words: list[CaptionWord] | None = None
    style_override: CaptionStyle | None = None


class AudioItem(LayerBase):
    kind: Literal["music", "sfx", "voiceover"]
    asset_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    tl_start: float = Field(ge=0)
    gain_db: float = Field(default=DEFAULT_MUSIC_GAIN_DB, ge=-60.0, le=12.0)


TextFont = Literal["montserrat", "inter", "serif", "mono"]


class TextStyle(_Strict):
    """How a text overlay looks and where it sits.

    ``x``/``y`` are the centre of the box as a share of the frame (0 to 1); ``size`` is the text
    height as a share of the frame height; ``width`` is the wrap width as a share of the frame
    width. ``None`` on the item means the built-in look."""

    x: float = Field(default=0.5, ge=0.0, le=1.0)
    y: float = Field(default=0.25, ge=0.0, le=1.0)
    font: TextFont = "montserrat"
    size: float = Field(default=0.045, ge=0.015, le=0.2)
    color: str = Field(default="#FFFFFF", pattern=r"^#[0-9A-Fa-f]{6}$")
    bg: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    bg_opacity: float = Field(default=0.6, ge=0.0, le=1.0)
    align: Literal["left", "center", "right"] = "center"
    width: float = Field(default=0.8, ge=0.2, le=1.0)
    shadow: bool = True


class OverlayItem(LayerBase):
    kind: Literal["sponsor_card", "lower_third", "text"]
    style: TextStyle | None = None
    tl_start: float = Field(ge=0)
    tl_end: float = Field(gt=0)
    text: str = ""
    asset_id: str | None = None
    placeholder: bool = False
    sponsor_slot_id: str | None = None


class Tracks(_Strict):
    video: list[VideoItem] = Field(default_factory=list)
    captions: list[CaptionItem] = Field(default_factory=list)
    audio: list[AudioItem] = Field(default_factory=list)
    overlays: list[OverlayItem] = Field(default_factory=list)


class Timeline(_Strict):
    version: Literal[1] = 1
    fps: Literal[30] = 30
    aspect: Aspect = "9:16"
    width: int = 1080
    height: int = 1920
    duration: float = Field(default=0.0, ge=0)
    caption_style: CaptionStyle = "bold_center"
    tracks: Tracks = Field(default_factory=Tracks)

    @classmethod
    def empty(
        cls, aspect: Aspect = "9:16", caption_style: CaptionStyle = "bold_center"
    ) -> Timeline:
        width, height = SIZES[aspect]
        return cls(aspect=aspect, width=width, height=height, caption_style=caption_style)

    def dump(self) -> dict[str, Any]:
        """JSON-safe dict (what is stored in ``edits.timeline``)."""
        return self.model_dump(mode="json")


class TimelineViolation(BaseModel):
    """One broken invariant: stable ``code``, JSON-ish ``path`` and the offending ``item_id``."""

    code: str
    message: str
    path: str = ""
    item_id: str | None = None
