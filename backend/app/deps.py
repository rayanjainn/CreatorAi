"""FastAPI dependencies: DB session, authenticated context and pagination."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query, Request
from sqlalchemy.orm import Session

from app.db import get_session_factory
from app.errors import AppError
from app.models import User
from app.security import verify_token
from app.services import access


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
    """Who is calling, which workspace every query is scoped to, and their role in it."""

    user_id: str
    workspace_id: str
    role: str = "owner"

    def can(self, need: str) -> bool:
        return access.at_least(self.role, need)


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


def get_user_id(request: Request, db: Annotated[Session, Depends(get_db, scope="function")]) -> str:
    """The signed-in user, without choosing a workspace (invite acceptance, the account page)."""
    claims = verify_token(_extract_token(request))
    user_id = str(claims["sub"])
    _check_user(db, user_id, claims)
    db.info["user_id"] = user_id
    return user_id


def _check_user(db: Session, user_id: str, claims: dict[str, object]) -> None:
    user = db.get(User, user_id)
    if user is None:
        raise AppError("UNAUTHORIZED", "Account no longer exists")
    if int(claims.get("tv", 0) or 0) != (user.token_version or 0):  # type: ignore[call-overload]
        raise AppError("UNAUTHORIZED", "You were signed out. Sign in again.")


def get_ctx(request: Request, db: Annotated[Session, Depends(get_db, scope="function")]) -> Ctx:
    """Validate the token, pick the workspace, and enforce the role policy for this request.

    The workspace is the ``X-Workspace-Id`` header (or ``?workspace=`` on GET, for EventSource),
    defaulting to the user's own. The caller must be a member of it.
    """
    claims = verify_token(_extract_token(request))
    user_id, home = str(claims["sub"]), str(claims["ws"])
    _check_user(db, user_id, claims)
    requested = request.headers.get("x-workspace-id") or (
        request.query_params.get("workspace") if request.method == "GET" else None
    )
    workspace_id = requested or home
    role = access.workspace_role(db, user_id, workspace_id)
    if role is None:
        if requested and requested != home:
            raise AppError("FORBIDDEN", "You are not a member of that workspace", status=403)
        raise AppError("UNAUTHORIZED", "Account no longer exists")
    route = request.scope.get("route")
    template = getattr(route, "path", None) or request.url.path
    access.authorize(
        db,
        user_id=user_id,
        workspace_id=workspace_id,
        role=role,
        method=request.method,
        template=template,
        params={k: str(v) for k, v in request.path_params.items()},
    )
    db.info["user_id"] = user_id  # lets log_activity record who did it
    return Ctx(user_id=user_id, workspace_id=workspace_id, role=role)


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
UserDep = Annotated[str, Depends(get_user_id)]
# scope="function" commits before the response is sent, so a client that reads its own write
# immediately after a 2xx never races the transaction.
DbDep = Annotated[Session, Depends(get_db, scope="function")]
PageDep = Annotated[Pagination, Depends(pagination_params)]
