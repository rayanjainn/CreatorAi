"""Prompt template loading and ``{placeholder}`` rendering."""

from __future__ import annotations

import json
import re
from functools import cache
from pathlib import Path
from typing import Any

PROMPTS_DIR = Path(__file__).parent / "prompts"
_PLACEHOLDER = re.compile(r"\{([a-z_][a-z0-9_]*)\}")


@cache
def load_template(task: str) -> str:
    path = PROMPTS_DIR / f"{task}.md"
    if not path.exists():
        raise FileNotFoundError(f"no prompt template for task {task!r}: {path}")
    return path.read_text(encoding="utf-8")


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, default=str)


def template_placeholders(task: str) -> set[str]:
    return set(_PLACEHOLDER.findall(load_template(task)))


def render_prompt(task: str, values: dict[str, Any]) -> str:
    """Fill ``{name}`` placeholders (JSON braces in the template are left alone).

    A placeholder without a value raises ``ValueError`` so typos fail loudly in development.
    """
    template = load_template(task)
    missing = sorted(n for n in set(_PLACEHOLDER.findall(template)) if n not in values)
    if missing:
        raise ValueError(f"prompt {task!r} is missing variables: {', '.join(missing)}")
    return _PLACEHOLDER.sub(lambda m: _stringify(values[m.group(1)]), template)
