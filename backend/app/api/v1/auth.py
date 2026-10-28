"""Local authentication: signup (first user), login and current-user."""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.deps import CtxDep, DbDep
from app.errors import AppError
from app.schemas.auth import LoginRequest, MeOut, SignupRequest, TokenOut
from app.security import issue_token
from app.services import account_admin, accounts

router = APIRouter(prefix="/auth", tags=["auth"])


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


class NewToken(BaseModel):
    access_token: str


def _token_response(db: DbDep, user_id: str, workspace_id: str) -> TokenOut:
    version = accounts.token_version(db, user_id)
    return TokenOut(
        **accounts.me(db, user_id, workspace_id).model_dump(),
        access_token=issue_token(user_id, workspace_id, version),
    )


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupRequest, db: DbDep) -> TokenOut:
    user, workspace = accounts.signup(
        db, body.email, body.password, body.display_name, body.invite_token
    )
    return _token_response(db, user.id, workspace.id)


@router.post("/login", response_model=TokenOut)
def login(body: LoginRequest, request: Request, db: DbDep) -> TokenOut:
    ip = request.client.host if request.client else None
    account_admin.check_login_allowed(body.email, ip)
    try:
        user, workspace = accounts.login(db, body.email, body.password)
    except AppError as exc:
        if exc.code == "INVALID_CREDENTIALS":
            account_admin.record_login(body.email, ip, ok=False)
        raise
    account_admin.record_login(body.email, ip, ok=True)
    return _token_response(db, user.id, workspace.id)


@router.post("/password", response_model=NewToken)
def change_password(body: PasswordChange, ctx: CtxDep, db: DbDep) -> dict[str, str]:
    """Change the password; every other session is signed out, this one gets a fresh token."""
    return account_admin.change_password(
        db, ctx.user_id, ctx.workspace_id, body.current_password, body.new_password
    )


@router.post("/sign-out-everywhere", response_model=NewToken)
def sign_out_everywhere(ctx: CtxDep, db: DbDep) -> dict[str, str]:
    """Invalidate every token of this account except the one returned."""
    return account_admin.sign_out_everywhere(db, ctx.user_id, ctx.workspace_id)


@router.get("/me", response_model=MeOut)
def auth_me(ctx: CtxDep, db: DbDep) -> MeOut:
    return accounts.me(db, ctx.user_id, ctx.workspace_id)
