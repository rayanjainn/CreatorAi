"""Workspace-scoped queries for clips, edits and edit revisions."""

from __future__ import annotations

from sqlalchemy import func, select

from app.models import Clip, Edit, EditRevision
from app.repositories.base import WorkspaceRepository


class ClipRepository(WorkspaceRepository[Clip]):
    model = Clip
    entity_name = "Clip"

    def for_item(
        self,
        workspace_id: str,
        item_id: str,
        *,
        status: str | None = None,
        kind: str | None = None,
    ) -> list[Clip]:
        stmt = self._scoped(workspace_id).where(Clip.content_item_id == item_id)
        if status:
            stmt = stmt.where(Clip.status == status)
        if kind:
            stmt = stmt.where(Clip.kind == kind)
        return list(self.db.execute(stmt.order_by(Clip.created_at, Clip.id)).scalars())


class EditRepository(WorkspaceRepository[Edit]):
    model = Edit
    entity_name = "Edit"

    def for_clip(self, workspace_id: str, clip_id: str) -> Edit | None:
        stmt = self._scoped(workspace_id).where(Edit.clip_id == clip_id)
        return self.db.execute(stmt).scalar_one_or_none()

    def by_clips(self, workspace_id: str, clip_ids: list[str]) -> dict[str, Edit]:
        if not clip_ids:
            return {}
        stmt = self._scoped(workspace_id).where(Edit.clip_id.in_(clip_ids))
        return {e.clip_id: e for e in self.db.execute(stmt).scalars()}

    # ``edit_revisions`` has no workspace_id: reach it through its (scoped) edit.
    def revisions(self, edit: Edit) -> list[EditRevision]:
        stmt = (
            select(EditRevision)
            .where(EditRevision.edit_id == edit.id)
            .order_by(EditRevision.revision.desc())
        )
        return list(self.db.execute(stmt).scalars())

    def revision(self, edit: Edit, revision: int) -> EditRevision | None:
        stmt = select(EditRevision).where(
            EditRevision.edit_id == edit.id, EditRevision.revision == revision
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def revision_count(self, edit: Edit) -> int:
        stmt = select(func.count()).select_from(EditRevision).where(EditRevision.edit_id == edit.id)
        return int(self.db.execute(stmt).scalar_one())
