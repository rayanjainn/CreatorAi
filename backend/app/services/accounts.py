"""Account use-cases: signup, login and profile/onboarding updates (no FastAPI imports)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import AppError
from app.ml.embedder import embed_texts
from app.ml.vectors import pack_vector
from app.models import CreatorProfile, User, Workspace, WorkspaceMember
from app.repositories.profiles import ProfileRepository, TwinMemoryRepository
from app.schemas.auth import MeOut, OnboardingRequest, ProfileOut, ProfileUpdate, UserOut
from app.security import hash_password, verify_password


def signup(
    db: Session,
    email: str,
    password: str,
    display_name: str | None,
    invite_token: str | None = None,
) -> tuple[User, Workspace]:
    """Create user + home workspace + empty profile.

    Only the first user may sign up on a machine, unless AUTH_ALLOW_MULTI or the person holds an
    invite link for this email (which also adds them to the inviting workspace).
    """
    from app.services import team  # local: team imports models that import this module's users

    invite = team.find_invite(db, invite_token) if invite_token else None
    if invite is not None and invite.email.lower() != email.lower():
        raise AppError(
            "INVITE_EMAIL_MISMATCH",
            f"This invite was sent to {invite.email}. Sign up with that address.",
            status=403,
        )
    existing = db.scalar(select(func.count()).select_from(User)) or 0
    if existing and not get_settings().auth_allow_multi and invite is None:
        raise AppError(
            "SIGNUP_CLOSED", "An account already exists on this machine; sign in instead"
        )
    if db.scalar(select(User.id).where(User.email == email)):
        raise AppError("EMAIL_TAKEN", "That email is already registered")
    name = display_name or email.split("@")[0]
    user = User(email=email, password_hash=hash_password(password), display_name=name)
    db.add(user)
    db.flush()
    workspace = Workspace(owner_id=user.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))
    db.add(CreatorProfile(workspace_id=workspace.id, display_name=name, domain="technology"))
    db.flush()
    if invite is not None:
        team.accept_invite(db, invite.token, user)
    return user, workspace


def login(db: Session, email: str, password: str) -> tuple[User, Workspace]:
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(password, user.password_hash):
        raise AppError("INVALID_CREDENTIALS", "Incorrect email or password")
    workspace = db.scalar(select(Workspace).where(Workspace.owner_id == user.id))
    if workspace is None:
        raise AppError("INTERNAL_ERROR", "Account has no workspace")
    return user, workspace


def profile_out(profile: CreatorProfile) -> ProfileOut:
    return ProfileOut(
        display_name=profile.display_name,
        domain=profile.domain,  # type: ignore[arg-type]
        audience=profile.audience,
        tone=profile.tone,
        language=profile.language,
        platforms=list(profile.platforms or []),
        style_profile=dict(profile.style_profile or {}),
        style_profile_rev=profile.style_profile_rev,
        onboarding_done=bool(profile.onboarding_done),
    )


def me(db: Session, user_id: str, workspace_id: str) -> MeOut:
    from app.services import access, team

    repo = ProfileRepository(db)
    user = db.get(User, user_id)
    if user is None:
        raise AppError("UNAUTHORIZED", "Account no longer exists")
    workspace = repo.workspace(workspace_id)
    return MeOut(
        user=UserOut(id=user.id, email=user.email, display_name=team.display_name(user)),
        workspace_id=workspace.id,
        workspace_name=workspace.name,
        role=access.workspace_role(db, user_id, workspace_id) or "viewer",  # type: ignore[arg-type]
        workspaces=team.my_workspaces(db, user_id),  # type: ignore[arg-type]
        profile=profile_out(repo.get(workspace_id)),
    )


def update_profile(db: Session, workspace_id: str, patch: ProfileUpdate) -> CreatorProfile:
    profile = ProfileRepository(db).get(workspace_id)
    for field in patch.model_fields_set:
        value = getattr(patch, field)
        if value is not None:
            setattr(profile, field, value)
    db.flush()
    return profile


def complete_onboarding(
    db: Session, workspace_id: str, body: OnboardingRequest
) -> tuple[CreatorProfile, int]:
    """Save the profile, seed the style profile and store sample scripts as Twin memories."""
    repo = ProfileRepository(db)
    profile = repo.get(workspace_id)
    profile.display_name = body.display_name
    profile.domain = body.domain
    profile.audience = body.audience
    profile.tone = body.tone
    profile.language = body.language
    profile.platforms = body.platforms
    style = dict(profile.style_profile or {})
    style.setdefault("tone_descriptors", [t.strip() for t in body.tone.split(",") if t.strip()])
    if body.caption_style:
        style["captions"] = {**style.get("captions", {}), "style": body.caption_style}
    if body.preferred_aspect:
        style["visual"] = {**style.get("visual", {}), "preferred_aspect": body.preferred_aspect}
    profile.style_profile = style
    profile.onboarding_done = True
    if body.channel_name:
        repo.workspace(workspace_id).name = body.channel_name

    scripts = [s.strip() for s in body.sample_scripts if s.strip()]
    if scripts:
        vectors = embed_texts(scripts)
        memories = TwinMemoryRepository(db)
        for text, vector in zip(scripts, vectors, strict=True):
            memories.add(workspace_id, "approved_script", text, pack_vector(vector))
    db.flush()
    return profile, len(scripts)
