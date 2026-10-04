"""Background work: job runner, pub/sub, scheduler and job handler modules."""

from __future__ import annotations

import importlib
import logging

log = logging.getLogger(__name__)

# Modules that call ``register_job(...)`` at import time. Add one line per new job handler module.
HANDLER_MODULES: list[str] = [
    "app.workers.tasks.asset_process",
    "app.workers.tasks.project_match",
    "app.workers.tasks.clips_generate",
    "app.workers.tasks.render_run",
    "app.workers.tasks.publish_upload",
    "app.workers.tasks.analytics_sync",
    "app.workers.tasks.twin_update",
    "app.workers.tasks.youtube_import",
]


def load_handlers() -> list[str]:
    """Import every handler module that exists; return the ones loaded."""
    loaded: list[str] = []
    for name in HANDLER_MODULES:
        try:
            module = importlib.import_module(name)
        except ModuleNotFoundError as exc:
            if exc.name not in (name, name.rpartition(".")[0]):
                raise
            continue
        # Import registers once; ``register()`` makes loading repeatable (tests clear the registry).
        register = getattr(module, "register", None)
        if callable(register):
            register()
        loaded.append(name)
    log.debug("job handler modules loaded: %s", loaded)
    return loaded
