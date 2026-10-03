"""Workspace-scoped queries for the board, ideas, Director outputs and scripts."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import delete, func, select

from app.models import (
    Asset,
    Clip,
    ContentItem,
    DirectorOutput,
    IdeaSuggestion,
    Job,
    Script,
    ScriptBeat,
)
from app.repositories.base import WorkspaceRepository

STAGES: tuple[str, ...] = ("idea", "script", "shoot", "edit", "review", "published")
ACTIVE_JOB_STATUSES = ("queued", "running")


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class ContentItemRepository(WorkspaceRepository[ContentItem]):
    model = ContentItem
    entity_name = "Content item"

    def _filtered(
        self, workspace_id: str, stage: str | None, q: str | None, domain: str | None
    ) -> Any:
        stmt = self._scoped(workspace_id)
        if stage:
            stmt = stmt.where(ContentItem.stage == stage)
        if domain:
            stmt = stmt.where(ContentItem.domain == domain)
        if q and q.strip():
            pattern = _like(q.strip())
            stmt = stmt.where(
                ContentItem.title.ilike(pattern, escape="\\")
                | ContentItem.idea_text.ilike(pattern, escape="\\")
            )
        return stmt

    def search(
        self,
        workspace_id: str,
        *,
        stage: str | None = None,
        q: str | None = None,
        domain: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ContentItem], int]:
        stmt = self._filtered(workspace_id, stage, q, domain)
        total = self.db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
        rows = self.db.execute(
            stmt.order_by(ContentItem.updated_at.desc(), ContentItem.id).limit(limit).offset(offset)
        ).scalars()
        return list(rows), int(total)

    def board(
        self, workspace_id: str, q: str | None = None, domain: str | None = None
    ) -> list[ContentItem]:
        stmt = self._filtered(workspace_id, None, q, domain)
        return list(
            self.db.execute(
                stmt.order_by(ContentItem.position, ContentItem.created_at, ContentItem.id)
            ).scalars()
        )

    def in_stage(self, workspace_id: str, stage: str) -> list[ContentItem]:
        """The column in display order (position, then creation, then id for stable ties)."""
        stmt = (
            self._scoped(workspace_id)
            .where(ContentItem.stage == stage)
            .order_by(ContentItem.position, ContentItem.created_at, ContentItem.id)
        )
        return list(self.db.execute(stmt).scalars())

    def next_position(self, workspace_id: str, stage: str) -> int:
        stmt = select(func.max(ContentItem.position)).where(
            ContentItem.workspace_id == workspace_id, ContentItem.stage == stage
        )
        top = self.db.execute(stmt).scalar_one_or_none()
        return 0 if top is None else int(top) + 1

    def recent_titles(self, workspace_id: str, limit: int = 40) -> list[str]:
        stmt = (
            select(ContentItem.title)
            .where(ContentItem.workspace_id == workspace_id)
            .order_by(ContentItem.created_at.desc())
            .limit(limit)
        )
        return list(self.db.execute(stmt).scalars())

    # ── aggregates for cards (one query per kind, never one per card) ──────────────────────────
    def asset_stats(self, workspace_id: str, ids: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"total": 0, "ready": 0, "thumb_key": None}
        )
        if not ids:
            return out
        stmt = (
            select(Asset.content_item_id, Asset.kind, Asset.status, Asset.thumb_key)
            .where(Asset.workspace_id == workspace_id, Asset.content_item_id.in_(ids))
            .order_by(Asset.created_at, Asset.id)
        )
        for item_id, kind, status, thumb in self.db.execute(stmt):
            stat = out[item_id]
            stat["total"] += 1
            stat["ready"] += status == "ready"
            if stat["thumb_key"] is None and kind == "video" and thumb:
                stat["thumb_key"] = thumb
        return out

    def script_flags(self, workspace_id: str, ids: list[str]) -> dict[str, dict[str, Any]]:
        """Per item: current script version, whether it has scenes and whether it is approved."""
        out: dict[str, dict[str, Any]] = {}
        if not ids:
            return out
        stmt = select(Script.content_item_id, Script.version, Script.scenes, Script.meta).where(
            Script.workspace_id == workspace_id,
            Script.content_item_id.in_(ids),
            Script.is_current.is_(True),
        )
        for item_id, version, scenes, meta in self.db.execute(stmt):
            out[item_id] = {
                "version": version,
                "has_body": bool(scenes),
                "approved": bool((meta or {}).get("approval")),
            }
        return out

    def with_outputs(self, workspace_id: str, ids: list[str], kind: str) -> set[str]:
        if not ids:
            return set()
        stmt = (
            select(DirectorOutput.content_item_id)
            .where(
                DirectorOutput.workspace_id == workspace_id,
                DirectorOutput.content_item_id.in_(ids),
                DirectorOutput.kind == kind,
            )
            .distinct()
        )
        return set(self.db.execute(stmt).scalars())

    def clip_counts(self, workspace_id: str, ids: list[str]) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "accepted": 0})
        if not ids:
            return out
        stmt = (
            select(Clip.content_item_id, Clip.status, func.count())
            .where(Clip.workspace_id == workspace_id, Clip.content_item_id.in_(ids))
            .group_by(Clip.content_item_id, Clip.status)
        )
        for item_id, status, n in self.db.execute(stmt):
            out[item_id]["total"] += int(n)
            if status == "accepted":
                out[item_id]["accepted"] += int(n)
        return out

    def running_jobs(self, workspace_id: str, ids: list[str]) -> dict[str, list[str]]:
        """Active job types per item, counting jobs on the item itself and on its assets."""
        out: dict[str, list[str]] = defaultdict(list)
        if not ids:
            return out
        own = select(Job.entity_id, Job.type).where(
            Job.workspace_id == workspace_id,
            Job.entity_type == "content_item",
            Job.entity_id.in_(ids),
            Job.status.in_(ACTIVE_JOB_STATUSES),
        )
        for item_id, job_type in self.db.execute(own):
            out[item_id].append(job_type)
        via_assets = (
            select(Asset.content_item_id, Job.type)
            .join(Job, Job.entity_id == Asset.id)
            .where(
                Asset.workspace_id == workspace_id,
                Asset.content_item_id.in_(ids),
                Job.workspace_id == workspace_id,
                Job.entity_type == "asset",
                Job.status.in_(ACTIVE_JOB_STATUSES),
            )
        )
        for item_id, job_type in self.db.execute(via_assets):
            out[item_id].append(job_type)
        return out

    def cascade_counts(self, workspace_id: str, item_id: str) -> dict[str, int]:
        """What deleting an item removes (``assets_detached`` are kept, only unlinked)."""

        def count(model: Any) -> int:
            stmt = select(func.count()).where(
                model.workspace_id == workspace_id, model.content_item_id == item_id
            )
            return int(self.db.execute(stmt).scalar_one())

        return {
            "scripts": count(Script),
            "director_outputs": count(DirectorOutput),
            "clips": count(Clip),
            "assets_detached": count(Asset),
        }


class IdeaRepository(WorkspaceRepository[IdeaSuggestion]):
    model = IdeaSuggestion
    entity_name = "Idea"

    def search(
        self, workspace_id: str, *, status: str | None, limit: int, offset: int
    ) -> tuple[list[IdeaSuggestion], int]:
        stmt = self._scoped(workspace_id)
        if status:
            stmt = stmt.where(IdeaSuggestion.status == status)
        total = self.db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
        rows = self.db.execute(
            stmt.order_by(IdeaSuggestion.created_at.desc(), IdeaSuggestion.id)
            .limit(limit)
            .offset(offset)
        ).scalars()
        return list(rows), int(total)

    def recent_titles(self, workspace_id: str, limit: int = 40) -> list[str]:
        stmt = (
            select(IdeaSuggestion.title)
            .where(IdeaSuggestion.workspace_id == workspace_id)
            .order_by(IdeaSuggestion.created_at.desc())
            .limit(limit)
        )
        return list(self.db.execute(stmt).scalars())


class DirectorOutputRepository(WorkspaceRepository[DirectorOutput]):
    model = DirectorOutput
    entity_name = "Director output"

    def versions(self, workspace_id: str, item_id: str, kind: str) -> list[DirectorOutput]:
        """Newest version first."""
        stmt = (
            self._scoped(workspace_id)
            .where(DirectorOutput.content_item_id == item_id, DirectorOutput.kind == kind)
            .order_by(DirectorOutput.version.desc())
        )
        return list(self.db.execute(stmt).scalars())

    def latest(self, workspace_id: str, item_id: str, kind: str) -> DirectorOutput | None:
        rows = self.versions(workspace_id, item_id, kind)
        return rows[0] if rows else None

    def version(
        self, workspace_id: str, item_id: str, kind: str, version: int
    ) -> DirectorOutput | None:
        stmt = self._scoped(workspace_id).where(
            DirectorOutput.content_item_id == item_id,
            DirectorOutput.kind == kind,
            DirectorOutput.version == version,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def next_version(self, workspace_id: str, item_id: str, kind: str) -> int:
        stmt = select(func.max(DirectorOutput.version)).where(
            DirectorOutput.workspace_id == workspace_id,
            DirectorOutput.content_item_id == item_id,
            DirectorOutput.kind == kind,
        )
        top = self.db.execute(stmt).scalar_one_or_none()
        return 1 if top is None else int(top) + 1


class ScriptRepository(WorkspaceRepository[Script]):
    model = Script
    entity_name = "Script"

    def current(self, workspace_id: str, item_id: str) -> Script | None:
        stmt = self._scoped(workspace_id).where(
            Script.content_item_id == item_id, Script.is_current.is_(True)
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def versions(self, workspace_id: str, item_id: str) -> list[Script]:
        """Newest version first."""
        stmt = (
            self._scoped(workspace_id)
            .where(Script.content_item_id == item_id)
            .order_by(Script.version.desc())
        )
        return list(self.db.execute(stmt).scalars())

    def next_version(self, workspace_id: str, item_id: str) -> int:
        stmt = select(func.max(Script.version)).where(
            Script.workspace_id == workspace_id, Script.content_item_id == item_id
        )
        top = self.db.execute(stmt).scalar_one_or_none()
        return 1 if top is None else int(top) + 1

    def clear_current(self, workspace_id: str, item_id: str) -> None:
        """Unset ``is_current`` everywhere (the partial unique index allows only one)."""
        for script in self.versions(workspace_id, item_id):
            if script.is_current:
                script.is_current = False
        self.db.flush()


class ScriptBeatRepository:
    """Beats have no ``content_item_id``: reach them through their (workspace-scoped) script."""

    def __init__(self, db: Any) -> None:
        self.db = db

    def for_script(self, workspace_id: str, script_id: str) -> list[ScriptBeat]:
        stmt = (
            select(ScriptBeat)
            .where(ScriptBeat.workspace_id == workspace_id, ScriptBeat.script_id == script_id)
            .order_by(ScriptBeat.scene_idx, ScriptBeat.beat_idx)
        )
        return list(self.db.execute(stmt).scalars())

    def delete_for_script(self, workspace_id: str, script_id: str) -> None:
        self.db.execute(
            delete(ScriptBeat).where(
                ScriptBeat.workspace_id == workspace_id, ScriptBeat.script_id == script_id
            )
        )
