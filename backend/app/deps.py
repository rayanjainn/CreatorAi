"""FastAPI dependencies: DB session, authenticated context and pagination."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query, Request
from sqlalchemy.orm import Session

from app.db import get_session_factory
from app.errors import AppError
from app.models import User, Workspace
from app.security import verify_token


def get_db() -> Iterator[Session]:
    """Request-scoped session: commits when the handler returns, rolls back on error."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@dataclass(frozen=True)
class Ctx:
    """Who is calling and which workspace every query must be scoped to."""

    user_id: str
    workspace_id: str


def _extract_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() == "bearer" and value:
        return value.strip()
    # EventSource cannot set headers, so GET requests may pass the token as a query parameter.
    query_token = request.query_params.get("access_token")
    if request.method == "GET" and query_token:
        return query_token
    raise AppError("UNAUTHORIZED", "Authentication required")


def get_ctx(request: Request, db: Annotated[Session, Depends(get_db)]) -> Ctx:
    """Validate the bearer token and confirm the user and workspace still exist."""
    claims = verify_token(_extract_token(request))
    user_id, workspace_id = str(claims["sub"]), str(claims["ws"])
    owned = (
        db.query(Workspace.id)
        .join(User, User.id == Workspace.owner_id)
        .filter(User.id == user_id, Workspace.id == workspace_id)
        .first()
    )
    if owned is None:
        raise AppError("UNAUTHORIZED", "Account no longer exists")
    return Ctx(user_id=user_id, workspace_id=workspace_id)


@dataclass(frozen=True)
class Pagination:
    limit: int
    offset: int


def pagination_params(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Pagination:
    return Pagination(limit=limit, offset=offset)


CtxDep = Annotated[Ctx, Depends(get_ctx)]
DbDep = Annotated[Session, Depends(get_db)]
PageDep = Annotated[Pagination, Depends(pagination_params)]
