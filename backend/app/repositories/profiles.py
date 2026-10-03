"""Creator profile and Twin memory repositories."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models import CreatorProfile, TwinMemory, Workspace


class ProfileRepository:
    """The profile's primary key *is* the workspace id, so scoping is the lookup itself."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, workspace_id: str) -> CreatorProfile:
        profile = self.db.get(CreatorProfile, workspace_id)
        if profile is None:
            raise not_found("Profile")
        return profile

    def workspace(self, workspace_id: str) -> Workspace:
        workspace = self.db.get(Workspace, workspace_id)
        if workspace is None:
            raise not_found("Workspace")
        return workspace


class TwinMemoryRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(
        self,
        workspace_id: str,
        kind: str,
        text: str,
        embedding: bytes | None,
        source_id: str | None = None,
    ) -> TwinMemory:
        memory = TwinMemory(
            workspace_id=workspace_id,
            kind=kind,
            text=text,
            embedding=embedding,
            source_id=source_id,
        )
        self.db.add(memory)
        self.db.flush()
        return memory

    def list_all(self, workspace_id: str) -> list[TwinMemory]:
        stmt = select(TwinMemory).where(TwinMemory.workspace_id == workspace_id)
        return list(self.db.execute(stmt).scalars())
