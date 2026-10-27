"""Fetching user-supplied URLs safely: public http(s) hosts only, on every redirect hop too."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from app.errors import AppError

USER_AGENT = "CreatorAi/1.0 (+local creator workspace)"


def check_public_url(url: str) -> None:
    """``VALIDATION_ERROR`` unless ``url`` is http(s) and resolves only to public addresses."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise AppError("VALIDATION_ERROR", "That is not a web address (http or https).")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or None)
    except OSError as exc:
        raise AppError(
            "VALIDATION_ERROR", f"{parsed.hostname} does not resolve.", status=422
        ) from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise AppError("VALIDATION_ERROR", "Refusing to fetch a private or local address.")


def public_client(
    timeout: float = 10.0, transport: httpx.BaseTransport | None = None
) -> httpx.Client:
    """An ``httpx.Client`` that re-checks the host before every request, redirects included.

    A test passes a ``transport`` (``httpx.MockTransport``); the host check is skipped then, because
    a mock transport never reaches the network.
    """
    hooks = {} if transport is not None else {"request": [lambda r: check_public_url(str(r.url))]}
    return httpx.Client(
        timeout=httpx.Timeout(timeout, connect=min(timeout, 8.0)),
        follow_redirects=True,
        max_redirects=5,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        event_hooks=hooks,
        transport=transport,
    )
