"""Font resolution for captions and cards.

Montserrat Bold and Inter Regular (SIL OFL, see ``backend/assets/fonts``) are vendored. If a file
is missing (e.g. a trimmed checkout) the resolver falls back to a font found on the system
(fontconfig, then common DejaVu/Liberation paths) and logs ONE clear warning, so renders still
work but look different. To restore the intended look drop the real files in:

    backend/assets/fonts/Montserrat-Bold.ttf
    backend/assets/fonts/Inter-Regular.otf   (or .ttf)
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.config import BACKEND_ROOT

log = logging.getLogger(__name__)

FONTS_DIR = BACKEND_ROOT / "assets" / "fonts"
_SYSTEM_FALLBACKS = {
    "bold": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ],
    "regular": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/Library/Fonts/Arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ],
}
_warned: set[str] = set()


@dataclass(frozen=True)
class FontFace:
    role: str  # "bold" (Montserrat Bold) | "regular" (Inter Regular)
    family: str  # name libass/ASS matches
    path: Path
    fallback: bool  # True when a system font stands in for the vendored one


_WANTED = {
    "bold": ("Montserrat", ["Montserrat-Bold.ttf", "Montserrat-Bold.otf"]),
    "regular": ("Inter", ["Inter-Regular.otf", "Inter-Regular.ttf"]),
}


def _fc_match(style: str) -> Path | None:
    try:
        out = subprocess.run(
            ["fc-match", "-f", "%{file}", f"sans-serif:{style}"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    path = Path(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else None
    return path if path and path.is_file() else None


def _family_of(path: Path) -> str:
    try:
        out = subprocess.run(
            ["fc-scan", "-f", "%{family[0]}", str(path)],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return path.stem.split("-")[0] or "sans-serif"


def resolve_font(role: str, fonts_dir: Path = FONTS_DIR) -> FontFace:
    """The vendored face for ``role`` or a system fallback (raises only if nothing exists)."""
    family, names = _WANTED[role]
    for name in names:
        if (fonts_dir / name).is_file():
            return FontFace(role, family, fonts_dir / name, False)
    candidates = [_fc_match("bold" if role == "bold" else "regular")]
    candidates += [Path(p) for p in _SYSTEM_FALLBACKS[role]]
    for path in candidates:
        if path and path.is_file():
            if role not in _warned:
                _warned.add(role)
                log.warning(
                    "%s font not found in %s; falling back to %s. Drop %s there to restore the "
                    "intended caption look (see docs/ARCHITECTURE.md, Render).",
                    family,
                    fonts_dir,
                    path,
                    names[0],
                )
            return FontFace(role, _family_of(path), path, True)
    raise FileNotFoundError(
        f"No usable {role} font: add {names[0]} to {fonts_dir} or install a system font"
    )


def stage_fonts(dest: Path) -> dict[str, FontFace]:
    """Copy the resolved faces into ``dest`` (a ``fontsdir`` for libass) and return them by role."""
    dest.mkdir(parents=True, exist_ok=True)
    faces: dict[str, FontFace] = {}
    for role in _WANTED:
        face = resolve_font(role)
        target = dest / face.path.name
        if not target.exists():
            shutil.copyfile(face.path, target)
        faces[role] = FontFace(role, face.family, target, face.fallback)
    return faces
