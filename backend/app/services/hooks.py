"""Decoupled hooks fired by the ingest pipeline.

Other features subscribe with ``register_after_asset_ready``; ingest never imports them. The default
hook chains ``project.match`` (Plan.md section 3.3) but only when that job type is registered, so
it is a no-op while that handler is not registered.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from app.db import session_scope
from app.models import Asset, ContentItem, Job, Script
from app.workers.runner import JOB_HANDLERS, enqueue

log = logging.getLogger(__name__)

AfterAssetReady = Callable[[str, str], None]  # (workspace_id, asset_id)
_AFTER_READY: list[AfterAssetReady] = []


def register_after_asset_ready(hook: AfterAssetReady) -> None:
    """Call ``hook(workspace_id, asset_id)`` every time an asset becomes ``ready``."""
    if hook not in _AFTER_READY:
        _AFTER_READY.append(hook)


def run_after_asset_ready(workspace_id: str, asset_id: str) -> None:
    """Run every hook; a failing hook is logged and never fails the asset."""
    for hook in list(_AFTER_READY):
        try:
            hook(workspace_id, asset_id)
        except Exception:
            log.exception("after_asset_ready hook %s failed", getattr(hook, "__name__", hook))


def chain_project_match(workspace_id: str, asset_id: str) -> None:
    """Enqueue ``project.match`` when the asset's content item has a current script and all of
    its assets are ready. Does nothing if ``project.match`` has no registered handler."""
    if "project.match" not in JOB_HANDLERS:
        return
    with session_scope() as db:
        asset = db.get(Asset, asset_id)
        if asset is None or asset.workspace_id != workspace_id or not asset.content_item_id:
            return
        item_id = asset.content_item_id
        item = db.get(ContentItem, item_id)
        script = (
            db.query(Script.id)
            .filter(Script.content_item_id == item_id, Script.is_current.is_(True))
            .first()
        )
        pending = (
            db.query(Asset.id)
            .filter(Asset.content_item_id == item_id, Asset.status != "ready")
            .first()
        )
        running = (
            db.query(Job.id)
            .filter(
                Job.type == "project.match",
                Job.entity_id == item_id,
                Job.status.in_(("queued", "running")),
            )
            .first()
        )
        if item is None or script is None or pending is not None or running is not None:
            return
    enqueue("project.match", "content_item", item_id, {"trigger": "asset_ready"},
            workspace_id=workspace_id)  # fmt: skip


register_after_asset_ready(chain_project_match)
