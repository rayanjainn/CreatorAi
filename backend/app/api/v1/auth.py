"""Local authentication: signup (first user), login and current-user."""

from __future__ import annotations

from fastapi import APIRouter

from app.deps import CtxDep, DbDep
from app.schemas.auth import LoginRequest, MeOut, SignupRequest, TokenOut
from app.security import issue_token
from app.services import accounts

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_response(db: DbDep, user_id: str, workspace_id: str) -> TokenOut:
    return TokenOut(
        **accounts.me(db, user_id, workspace_id).model_dump(),
        access_token=issue_token(user_id, workspace_id),
    )


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupRequest, db: DbDep) -> TokenOut:
    user, workspace = accounts.signup(db, body.email, body.password, body.display_name)
    return _token_response(db, user.id, workspace.id)


@router.post("/login", response_model=TokenOut)
def login(body: LoginRequest, db: DbDep) -> TokenOut:
    user, workspace = accounts.login(db, body.email, body.password)
    return _token_response(db, user.id, workspace.id)


@router.get("/me", response_model=MeOut)
def auth_me(ctx: CtxDep, db: DbDep) -> MeOut:
    return accounts.me(db, ctx.user_id, ctx.workspace_id)
