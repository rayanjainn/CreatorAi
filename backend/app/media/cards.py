"""Pillow cards for overlays and sponsor placeholders (full-frame transparent PNGs).

Every card is exactly the output size so the render graph can ``overlay=0:0`` it. Sizes follow the
same scale rule as captions (1920 px tall base, x0.6 for 16:9).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.media.captions_ass import scale_for
from app.media.fonts import FontFace

ACCENT = (255, 214, 10, 255)
INK = (255, 255, 255, 255)
SHADE = (0, 0, 0, 170)


def _font(face: FontFace, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(face.path), max(8, size))


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: int) -> str:
    lines: list[str] = []
    for paragraph in (text.strip() or " ").splitlines():
        line = ""
        for word in paragraph.split():
            trial = f"{line} {word}".strip()
            if line and draw.textlength(trial, font=font) > max_w:
                lines.append(line)
                line = word
            else:
                line = trial
        lines.append(line)
    return "\n".join(lines)


def render_card(
    kind: str,
    text: str,
    width: int,
    height: int,
    dest: Path,
    faces: dict[str, FontFace],
) -> Path:
    """Write the PNG for ``kind`` (``sponsor_card`` | ``lower_third`` | ``text``) to ``dest``."""
    k = scale_for(width, height)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    bold, regular = faces["bold"], faces["regular"]

    def px(value: float) -> int:
        return round(value * k)

    margin = px(80)
    if kind == "sponsor_card":
        label, body, small = _font(bold, px(46)), _font(bold, px(92)), _font(regular, px(44))
        top = height // 2
        draw.rectangle([margin, top - px(330), margin + px(150), top - px(322)], fill=ACCENT)
        draw.text((margin, top - px(300)), "SPONSOR SEGMENT", font=label, fill=ACCENT)
        wrapped = _wrap(draw, text or "Your sponsor message", body, width - 2 * margin)
        draw.multiline_text((margin, top - px(210)), wrapped, font=body, fill=INK, spacing=px(14))
        note = "Placeholder: record the real segment and link it in the editor."
        note = _wrap(draw, note, small, width - 2 * margin)
        draw.text((margin, height - margin - px(60)), note, font=small, fill=(200, 200, 200, 255))
    elif kind == "lower_third":
        font = _font(bold, px(56))
        wrapped = _wrap(draw, text, font, int(width * 0.7))
        box = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=px(8))
        w, h, pad, bar = box[2] - box[0], box[3] - box[1], px(26), px(14)
        y1 = height - px(600 if height > width else 260)  # above the caption zone
        draw.rectangle([margin, y1 - h - 2 * pad, margin + w + 2 * pad + bar, y1], fill=SHADE)
        draw.rectangle([margin, y1 - h - 2 * pad, margin + bar, y1], fill=ACCENT)
        draw.multiline_text(
            (margin + pad + bar, y1 - h - pad - box[1]), wrapped, font=font, fill=INK, spacing=px(8)
        )
    else:  # "text": centred title with a translucent plate
        font = _font(bold, px(76))
        wrapped = _wrap(draw, text, font, int(width * 0.8))
        box = draw.multiline_textbbox((0, 0), wrapped, font=font, align="center", spacing=px(10))
        w, h, pad = box[2] - box[0], box[3] - box[1], px(32)
        x0, y0 = (width - w) // 2, int(height * 0.22)
        plate = [x0 - pad, y0 - pad, x0 + w + pad, y0 + h + pad]
        draw.rounded_rectangle(plate, radius=px(24), fill=SHADE)
        draw.multiline_text(
            (x0 - box[0], y0 - box[1]), wrapped, font=font, fill=INK, align="center", spacing=px(10)
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "PNG")
    return dest
