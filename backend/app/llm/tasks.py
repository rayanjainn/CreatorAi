"""Task routing (Plan.md section 7.1). Add a task: one ``TaskSpec`` here, a prompt and a schema.

Chains are built from ``LLM_PROVIDER_ORDER`` (default ``gemini,groq,ollama``): every provider in the
order contributes one link, so the env var alone decides who is tried first. A spec only says which
Gemini tier (``lite`` for cheap/short tasks, ``main`` otherwise) to use, which extra Gemini tiers
may be tried last, and whether the task needs vision (Groq is then left out; Ollama uses its vision
model). The mock provider is appended only when ``LLM_ALLOW_MOCK=true``.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings


@dataclass(frozen=True)
class Target:
    """One link of a provider chain: provider name and model tier."""

    provider: str
    tier: str = "main"  # gemini: main|lite, groq: chat, ollama: main|vision


@dataclass(frozen=True)
class TaskSpec:
    max_tokens: int
    gemini_tier: str = "main"
    gemini_extra: tuple[str, ...] = ()  # more Gemini tiers tried after every provider failed
    vision: bool = False


@dataclass(frozen=True)
class TaskRoute:
    chain: tuple[Target, ...]
    max_tokens: int
    vision: bool = False


DEFAULT_ORDER = ("gemini", "groq", "ollama")

TASK_SPECS: dict[str, TaskSpec] = {
    "director.plan": TaskSpec(1500),
    "director.review": TaskSpec(1200),
    "script.hooks": TaskSpec(600, "lite", ("main",)),
    "script.generate": TaskSpec(2500),
    "script.meta": TaskSpec(900, "lite"),
    "assets.caption_keyframes": TaskSpec(1200, "main", ("lite",), vision=True),
    "match.disambiguate": TaskSpec(300, "lite"),
    "clips.rerank_copy": TaskSpec(1500),
    "sponsors.integration": TaskSpec(600),
    "twin.chat": TaskSpec(700),
    "twin.style_extract": TaskSpec(600, "lite"),
    "insights.narrate_ideas": TaskSpec(1000),
}

MOCK = Target("mock", "mock")


def build_route(spec: TaskSpec, order: tuple[str, ...] = DEFAULT_ORDER) -> TaskRoute:
    """Expand a spec into the provider chain for ``order`` (no mock)."""
    chain: list[Target] = []
    for name in order:
        if name == "gemini":
            chain.append(Target("gemini", spec.gemini_tier))
        elif name == "groq" and not spec.vision:
            chain.append(Target("groq", "chat"))
        elif name == "ollama":
            chain.append(Target("ollama", "vision" if spec.vision else "main"))
    if "gemini" in order:
        chain += [Target("gemini", tier) for tier in spec.gemini_extra]
    return TaskRoute(tuple(chain), spec.max_tokens, spec.vision)


# Default-order view of the table (the live order comes from settings, see ``chain_for``).
TASK_ROUTES: dict[str, TaskRoute] = {t: build_route(s) for t, s in TASK_SPECS.items()}


def route_for(task: str, settings: Settings) -> TaskRoute:
    return build_route(TASK_SPECS[task], settings.provider_order)


def chain_for(task: str, settings: Settings) -> tuple[Target, ...]:
    """The task's chain for the configured order, ending in ``mock`` only if explicitly allowed."""
    chain = route_for(task, settings).chain
    return (*chain, MOCK) if settings.llm_allow_mock else chain
