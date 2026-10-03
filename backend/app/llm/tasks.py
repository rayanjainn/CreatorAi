"""Task routing table (Plan.md section 7.1). Add a task: one entry here, a prompt and a schema."""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings


@dataclass(frozen=True)
class Target:
    """One link of a provider chain: provider name and model tier (``main``/``lite``/``chat``)."""

    provider: str
    tier: str = "main"


@dataclass(frozen=True)
class TaskRoute:
    chain: tuple[Target, ...]
    max_tokens: int
    vision: bool = False


GEMINI_MAIN = Target("gemini", "main")
GEMINI_LITE = Target("gemini", "lite")
GROQ = Target("groq", "chat")

TASK_ROUTES: dict[str, TaskRoute] = {
    "director.plan": TaskRoute((GEMINI_MAIN, GROQ), 1500),
    "director.review": TaskRoute((GEMINI_MAIN, GROQ), 1200),
    "script.hooks": TaskRoute((GEMINI_LITE, GROQ, GEMINI_MAIN), 600),
    "script.generate": TaskRoute((GEMINI_MAIN, GROQ), 2500),
    "script.meta": TaskRoute((GEMINI_LITE, GROQ), 900),
    "assets.caption_keyframes": TaskRoute((GEMINI_MAIN, GEMINI_LITE), 1200, vision=True),
    "match.disambiguate": TaskRoute((GROQ, GEMINI_LITE), 300),
    "clips.rerank_copy": TaskRoute((GEMINI_MAIN, GROQ), 1500),
    "sponsors.integration": TaskRoute((GEMINI_MAIN, GROQ), 600),
    "twin.chat": TaskRoute((GEMINI_MAIN, GROQ), 700),
    "twin.style_extract": TaskRoute((GEMINI_LITE, GROQ), 600),
    "insights.narrate_ideas": TaskRoute((GEMINI_MAIN, GROQ), 1000),
}

MOCK = Target("mock", "mock")


def chain_for(task: str, settings: Settings) -> tuple[Target, ...]:
    """The route's chain, ending in ``mock`` when ``LLM_ALLOW_MOCK`` is on."""
    route = TASK_ROUTES[task]
    return (*route.chain, MOCK) if settings.llm_allow_mock else route.chain
