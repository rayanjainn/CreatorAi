"""Example repository: jobs, always scoped by workspace."""

from __future__ import annotations

from sqlalchemy import desc

from app.models import Job
from app.repositories.base import WorkspaceRepository


class JobRepository(WorkspaceRepository[Job]):
    model = Job
    entity_name = "Job"

    def list_filtered(
        self,
        workspace_id: str,
        *,
        status: str | None = None,
        entity_type: str | None = None,
        entity_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Job]:
        return self.list(
            workspace_id,
            limit=limit,
            offset=offset,
            order_by=desc(Job.created_at),
            status=status,
            entity_type=entity_type,
            entity_id=entity_id,
        )
