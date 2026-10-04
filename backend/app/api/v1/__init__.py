"""Builds the ``/api/v1`` router.

To add an endpoint module: create ``app/api/v1/<name>.py`` exposing ``router = APIRouter(...)`` and
make sure ``<name>`` is in ``ROUTER_MODULES``. Listed modules that do not exist yet are skipped.
"""

from __future__ import annotations

import importlib
import logging

from fastapi import APIRouter

log = logging.getLogger(__name__)

ROUTER_MODULES: list[str] = [
    "health",
    "auth",
    "me",
    "team",
    "comments",
    "jobs",
    "llm",
    "content",
    "ideas",
    "activity",
    "insights",
    "twin",
    "director",
    "scripts",
    "uploads",
    "assets",
    "search",
    "matching",
    "clips",
    "edits",
    "renders",
    "lumiclip",
    "sponsors",
    "publish",
    "youtube",
    "insights",
    "twin",
    "twin",
]


def build_router() -> APIRouter:
    api = APIRouter()
    for name in ROUTER_MODULES:
        path = f"{__name__}.{name}"
        try:
            module = importlib.import_module(path)
        except ModuleNotFoundError as exc:
            if exc.name != path:
                raise
            log.debug("router module %s not present yet", path)
            continue
        api.include_router(module.router)
    return api
