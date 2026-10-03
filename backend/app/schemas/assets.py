"""Request and response models for uploads, assets, transcripts and search."""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

from app.schemas.common import Provenance

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class JobBrief(BaseModel):
    id: str
    status: str
    progress: int
    stage: str
    error: str | None = None


class AssetWarning(BaseModel):
    code: str
    stage: str
    message: str


class AssetOut(BaseModel):
    """Library card: everything the grid and list views need."""

    id: str
    kind: str
    filename: str
    mime: str
    size_bytes: int
    sha256: str
    duration_sec: float | None
    width: int | None
    height: int | None
    fps: float | None
    status: str
    error: str | None
    description: str
    tags: list[str]
    folder: str
    content_item_id: str | None
    created_at: str
    updated_at: str
    thumb_url: str | None
    stages_done: list[str]
    warnings: list[AssetWarning]
    job: JobBrief | None = None
    provenance: Provenance
    provenance_by_stage: dict[str, Provenance]


class AssetUrls(BaseModel):
    original: str | None = None
    proxy: str | None = None
    thumb: str | None = None
    audio: str | None = None


class ShotOut(BaseModel):
    idx: int
    start_sec: float
    end_sec: float
    caption: str
    tags: list[str]
    keyframe_url: str | None
    captioned: bool  # False: tags were inherited from the nearest captioned shot


class SegmentOut(BaseModel):
    idx: int
    start_sec: float
    end_sec: float
    text: str


class AssetDetail(AssetOut):
    urls: AssetUrls
    shots: list[ShotOut]
    segments: list[SegmentOut]
    analysis: dict[str, Any]


class AssetPatch(BaseModel):
    tags: list[str] | None = None
    folder: str | None = Field(None, max_length=300)
    description: str | None = Field(None, max_length=4000)
    content_item_id: str | None = None  # explicit null detaches the asset from its project


class UploadInit(BaseModel):
    filename: str = Field(min_length=1, max_length=400)
    mime: str = ""
    size_bytes: int = Field(gt=0)
    content_item_id: str | None = None


class UploadOut(BaseModel):
    id: str
    filename: str
    mime: str
    size_bytes: int
    chunk_size: int
    total_chunks: int
    received_chunks: list[int]
    status: str
    asset_id: str | None
    content_item_id: str | None
    created_at: str


class UploadComplete(BaseModel):
    upload: UploadOut
    asset: AssetOut
    job_id: str | None
    duplicate: bool


class AssetUploadResult(BaseModel):
    asset: AssetOut
    job_id: str | None
    duplicate: bool


class ReprocessRequest(BaseModel):
    stage: str | None = None


class ReprocessOut(BaseModel):
    job_id: str | None
    asset: AssetOut


class TranscriptWord(BaseModel):
    word: str
    start: float
    end: float


class TranscriptSegment(BaseModel):
    idx: int
    start: float
    end: float
    text: str
    words: list[TranscriptWord]


class TranscriptOut(BaseModel):
    asset_id: str
    source: str  # sidecar | asr
    provider: str | None
    model: str | None
    language: str | None
    words_estimated: bool
    segments: list[TranscriptSegment]
    provenance: Provenance


class SearchHit(BaseModel):
    asset_id: str
    filename: str
    start_sec: float
    end_sec: float
    kind: str  # speech | visual
    asset_kind: str
    snippet: str
    thumb_url: str | None
    score: float
    similarity: float | None = None


class SearchOut(BaseModel):
    query: str
    results: list[SearchHit]
    provenance: Provenance
    embedder: dict[str, Any]
    warnings: list[str]


class ReindexRequest(BaseModel):
    force: bool = False


class ReindexOut(BaseModel):
    queued: int
    job_ids: list[str]
    embedder: dict[str, Any]
    provenance: Provenance
