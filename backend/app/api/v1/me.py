"""Current user, creator profile and onboarding."""

from __future__ import annotations

from fastapi import APIRouter

from app.deps import CtxDep, DbDep
from app.schemas.auth import MeOut, OnboardingOut, OnboardingRequest, ProfileOut, ProfileUpdate
from app.services import accounts

router = APIRouter(tags=["me"])


@router.get("/me", response_model=MeOut)
def get_me(ctx: CtxDep, db: DbDep) -> MeOut:
    return accounts.me(db, ctx.user_id, ctx.workspace_id)


@router.get("/profile", response_model=ProfileOut)
def get_profile(ctx: CtxDep, db: DbDep) -> ProfileOut:
    return accounts.me(db, ctx.user_id, ctx.workspace_id).profile


@router.put("/profile", response_model=ProfileOut)
def put_profile(body: ProfileUpdate, ctx: CtxDep, db: DbDep) -> ProfileOut:
    return accounts.profile_out(accounts.update_profile(db, ctx.workspace_id, body))


@router.post("/onboarding", response_model=OnboardingOut)
def onboarding(body: OnboardingRequest, ctx: CtxDep, db: DbDep) -> OnboardingOut:
    profile, created = accounts.complete_onboarding(db, ctx.workspace_id, body)
    return OnboardingOut(profile=accounts.profile_out(profile), memories_created=created)
