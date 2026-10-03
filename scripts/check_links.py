#!/usr/bin/env python3
"""Check relative links and #anchors in the repository's Markdown files: ``make docs-check``.

Standard library only. Skips http(s)/mailto links, code blocks and vendored directories.
Exit code 1 lists every broken link.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"node_modules", ".venv", ".git", ".next", "__pycache__", "test-results"}
LINK = re.compile(r"(?<!\!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")


def slug(text: str) -> str:
    """GitHub-style heading anchor."""
    text = re.sub(r"[`*_~]", "", text.strip().lower())
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[^\w\- ]", "", text, flags=re.UNICODE)
    return text.replace(" ", "-")


def strip_code(lines: list[str]) -> list[tuple[int, str]]:
    out, fenced = [], False
    for number, line in enumerate(lines, 1):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if not fenced:
            out.append((number, line))
    return out


def anchors(path: Path) -> set[str]:
    seen: dict[str, int] = {}
    found: set[str] = set()
    for _, line in strip_code(path.read_text(encoding="utf-8").splitlines()):
        match = HEADING.match(line)
        if match:
            base = slug(match.group(2))
            count = seen.get(base, 0)
            seen[base] = count + 1
            found.add(base if count == 0 else f"{base}-{count}")
    return found


def main() -> int:
    files = [p for p in ROOT.rglob("*.md") if not SKIP_DIRS & set(p.relative_to(ROOT).parts)]
    cache: dict[Path, set[str]] = {}
    broken: list[str] = []
    for md in sorted(files):
        for number, line in strip_code(md.read_text(encoding="utf-8").splitlines()):
            for target in LINK.findall(re.sub(r"`[^`]*`", "", line)):
                if re.match(r"^(https?:|mailto:|tel:)", target):
                    continue
                raw, _, fragment = target.partition("#")
                dest = md if not raw else (md.parent / unquote(raw)).resolve()
                where = f"{md.relative_to(ROOT)}:{number}"
                if not dest.exists():
                    broken.append(f"{where}: missing file {target}")
                    continue
                if fragment and dest.suffix == ".md":
                    if dest not in cache:
                        cache[dest] = anchors(dest)
                    if unquote(fragment).lower() not in cache[dest]:
                        broken.append(f"{where}: missing anchor {target}")
    for item in broken:
        print(item)
    print(f"checked {len(files)} markdown files: {len(broken)} broken link(s)")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
