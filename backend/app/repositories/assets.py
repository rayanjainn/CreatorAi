"""Workspace-scoped queries for uploads, assets, segments and shots."""

from __future__ import annotations

from typing import Any

from sqlalchemy import String, cast, delete, func, or_, select, text

from app.models import Asset, AssetSegment, AssetShot, Job, Upload
from app.repositories.base import WorkspaceRepository

SORTS = {
    "created_at": Asset.created_at,
    "filename": func.lower(Asset.filename),
    "duration": Asset.duration_sec,
    "size": Asset.size_bytes,
    "status": Asset.status,
}


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class UploadRepository(WorkspaceRepository[Upload]):
    model = Upload
    entity_name = "Upload"

    def stale(self, cutoff_iso: str) -> list[Upload]:
        """Unfinished uploads older than ``cutoff_iso`` across ALL workspaces (maintenance only)."""
        stmt = select(Upload).where(Upload.status == "uploading", Upload.created_at < cutoff_iso)
        return list(self.db.execute(stmt).scalars())


class AssetRepository(WorkspaceRepository[Asset]):
    model = Asset
    entity_name = "Asset"

    def find_by_sha(self, workspace_id: str, sha256: str) -> Asset | None:
        stmt = self._scoped(workspace_id).where(Asset.sha256 == sha256)
        return self.db.execute(stmt).scalar_one_or_none()

    def search(
        self,
        workspace_id: str,
        *,
        kind: str | None = None,
        status: str | None = None,
        tag: str | None = None,
        content_item_id: str | None = None,
        q: str | None = None,
        sort: str = "-created_at",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Asset], int]:
        """Filtered, sorted page of assets plus the total match count."""
        stmt = self._scoped(workspace_id)
        if kind:
            stmt = stmt.where(Asset.kind == kind)
        if status:
            stmt = stmt.where(Asset.status == status)
        if content_item_id:
            stmt = stmt.where(Asset.content_item_id == content_item_id)
        if tag:
            stmt = stmt.where(
                text(
                    "EXISTS (SELECT 1 FROM json_each(assets.tags) "
                    "WHERE lower(json_each.value) = :tag)"
                ).bindparams(tag=tag.strip().lower())
            )
        if q and q.strip():
            pattern = _like(q.strip())
            stmt = stmt.where(
                or_(
                    Asset.filename.ilike(pattern, escape="\\"),
                    Asset.description.ilike(pattern, escape="\\"),
                    cast(Asset.tags, String).ilike(pattern, escape="\\"),
                )
            )
        total = self.db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
        key = sort.lstrip("-+")
        column = SORTS.get(key, Asset.created_at)
        order = column.desc() if sort.startswith("-") or key not in SORTS else column.asc()
        stmt = stmt.order_by(order, Asset.id).limit(limit).offset(offset)
        return list(self.db.execute(stmt).scalars()), int(total)

    def all_for_content_item(self, workspace_id: str, content_item_id: str) -> list[Asset]:
        stmt = self._scoped(workspace_id).where(Asset.content_item_id == content_item_id)
        return list(self.db.execute(stmt).scalars())

    def latest_jobs(self, workspace_id: str, asset_ids: list[str]) -> dict[str, Job]:
        """Most recent ``asset.process`` job per asset id."""
        if not asset_ids:
            return {}
        stmt = (
            select(Job)
            .where(
                Job.workspace_id == workspace_id,
                Job.entity_type == "asset",
                Job.entity_id.in_(asset_ids),
            )
            .order_by(Job.created_at.asc(), text("jobs.rowid"))
        )
        latest: dict[str, Job] = {}
        for job in self.db.execute(stmt).scalars():
            if job.entity_id:
                latest[job.entity_id] = job
        return latest

    def active_jobs(self, workspace_id: str, asset_id: str) -> list[Job]:
        stmt = select(Job).where(
            Job.workspace_id == workspace_id,
            Job.entity_type == "asset",
            Job.entity_id == asset_id,
            Job.status.in_(("queued", "running")),
        )
        return list(self.db.execute(stmt).scalars())


class SegmentRepository(WorkspaceRepository[AssetSegment]):
    model = AssetSegment
    entity_name = "Segment"

    def for_asset(self, workspace_id: str, asset_id: str) -> list[AssetSegment]:
        stmt = self._scoped(workspace_id).where(AssetSegment.asset_id == asset_id)
        return list(self.db.execute(stmt.order_by(AssetSegment.idx)).scalars())

    def replace(self, workspace_id: str, asset_id: str, rows: list[dict[str, Any]]) -> None:
        """Delete the asset's segments and insert ``rows`` (FTS triggers keep the index in sync)."""
        self.db.execute(
            delete(AssetSegment).where(
                AssetSegment.workspace_id == workspace_id, AssetSegment.asset_id == asset_id
            )
        )
        for row in rows:
            self.db.add(AssetSegment(workspace_id=workspace_id, asset_id=asset_id, **row))
        self.db.flush()


class ShotRepository(WorkspaceRepository[AssetShot]):
    model = AssetShot
    entity_name = "Shot"

    def for_asset(self, workspace_id: str, asset_id: str) -> list[AssetShot]:
        stmt = self._scoped(workspace_id).where(AssetShot.asset_id == asset_id)
        return list(self.db.execute(stmt.order_by(AssetShot.idx)).scalars())

    def replace(self, workspace_id: str, asset_id: str, rows: list[dict[str, Any]]) -> None:
        self.db.execute(
            delete(AssetShot).where(
                AssetShot.workspace_id == workspace_id, AssetShot.asset_id == asset_id
            )
        )
        for row in rows:
            self.db.add(AssetShot(workspace_id=workspace_id, asset_id=asset_id, **row))
        self.db.flush()
