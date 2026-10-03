"""FastAPI application factory and lifespan."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.v1 import build_router
from app.api.v1.media import router as media_router
from app.config import get_settings
from app.db import dispose_engine, migrate
from app.errors import install_error_handlers
from app.logging import configure_logging
from app.workers import load_handlers
from app.workers.runner import get_runner, mark_interrupted_jobs, shutdown_runner
from app.workers.scheduler import scheduler

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    settings.ensure_dirs()
    applied = migrate()
    if applied:
        log.info("applied migrations: %s", ", ".join(applied))
    interrupted = mark_interrupted_jobs()
    if interrupted:
        log.warning("marked %s interrupted job(s) as failed (retryable)", interrupted)
    load_handlers()
    get_runner()
    scheduler.start()
    log.info("CreatorAi API ready (data dir: %s)", settings.data_dir)
    try:
        yield
    finally:
        scheduler.stop()
        shutdown_runner()
        dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="CreatorAi API", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "Retry-After"],
    )
    install_error_handlers(app)
    app.include_router(build_router(), prefix="/api/v1")
    app.include_router(media_router)
    return app


app = create_app()
