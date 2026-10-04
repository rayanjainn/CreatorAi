"""Styled text overlays: schema bounds and the card the renderer draws."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.media.cards import render_card
from app.media.fonts import stage_fonts
from app.schemas.timeline import OverlayItem, TextStyle


def test_style_defaults_and_bounds() -> None:
    assert TextStyle().font == "montserrat"
    for bad in ({"x": 1.5}, {"color": "red"}, {"size": 0.5}, {"font": "comic"}, {"extra": 1}):
        with pytest.raises(ValidationError):
            TextStyle(**bad)


def test_overlay_style_is_optional_and_round_trips() -> None:
    plain = OverlayItem(
        id="o_1", source="user", status="accepted", kind="text", tl_start=0, tl_end=2, text="Hi"
    )
    assert plain.style is None
    styled = OverlayItem(
        id="o_2",
        source="user",
        status="accepted",
        kind="text",
        tl_start=0,
        tl_end=2,
        text="Hi",
        style=TextStyle(x=0.2, color="#FFD60A"),
    )
    assert OverlayItem.model_validate(styled.model_dump()).style.x == 0.2  # type: ignore[union-attr]


def test_styled_card_is_drawn_where_asked(tmp_path: Path) -> None:
    from PIL import Image

    faces = stage_fonts(tmp_path / "fonts")
    style = TextStyle(x=0.5, y=0.8, size=0.05, color="#FF0000").model_dump()
    out = render_card("text", "Hello", 540, 960, tmp_path / "c.png", faces, style)
    box = Image.open(out).getbbox()
    assert box is not None
    assert box[1] > 960 * 0.7  # the text sits low, as placed (the legacy look sits near the top)
