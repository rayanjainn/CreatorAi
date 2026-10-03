"""Auth and profile request/response models."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Domain = Literal["education", "technology", "entertainment", "lifestyle", "business"]
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_RE.match(value):
            raise ValueError("must be a valid email address")
        return value


class SignupRequest(Credentials):
    display_name: str | None = Field(default=None, max_length=80)


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return value.strip().lower()


class UserOut(BaseModel):
    id: str
    email: str


class ProfileOut(BaseModel):
    display_name: str
    domain: Domain
    audience: str
    tone: str
    language: str
    platforms: list[str]
    style_profile: dict[str, Any]
    style_profile_rev: int
    onboarding_done: bool


class MeOut(BaseModel):
    user: UserOut
    workspace_id: str
    workspace_name: str
    profile: ProfileOut


class TokenOut(MeOut):
    access_token: str
    token_type: str = "bearer"


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    domain: Domain | None = None
    audience: str | None = Field(default=None, max_length=500)
    tone: str | None = Field(default=None, max_length=200)
    language: str | None = Field(default=None, max_length=16)
    platforms: list[str] | None = None
    style_profile: dict[str, Any] | None = None


class OnboardingRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    domain: Domain
    audience: str = Field(default="", max_length=500)
    tone: str = Field(default="conversational", max_length=200)
    language: str = Field(default="en", max_length=16)
    platforms: list[str] = Field(default_factory=lambda: ["youtube_shorts"])
    channel_name: str | None = Field(default=None, max_length=80)
    caption_style: Literal["bold_center", "minimal_bottom", "karaoke"] | None = None
    preferred_aspect: Literal["9:16", "16:9"] | None = None
    sample_scripts: list[str] = Field(default_factory=list, max_length=10)


class OnboardingOut(BaseModel):
    profile: ProfileOut
    memories_created: int
