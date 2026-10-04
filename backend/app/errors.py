"""``AppError`` and the exception handlers that render ``{"error": {code, message, details}}``."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)

# Default HTTP status per error code (Plan.md section 6.10 plus codes used by the foundation).
ERROR_CODES: dict[str, int] = {
    "UNAUTHORIZED": 401,
    "INVALID_CREDENTIALS": 401,
    "FORBIDDEN": 403,
    "SIGNUP_CLOSED": 403,
    "NOT_FOUND": 404,
    "METHOD_NOT_ALLOWED": 405,
    "CONFLICT": 409,
    "EMAIL_TAKEN": 409,
    "REVISION_CONFLICT": 409,
    "ASSET_NOT_READY": 409,
    "NO_SCRIPT": 409,
    "NO_PLAN": 409,
    "NO_CLIP_CANDIDATES": 409,
    "CONFIRMATION_REQUIRED": 409,
    "NO_YOUTUBE_CONNECTION": 409,
    "JOB_NOT_CANCELABLE": 409,
    "JOB_NOT_RETRYABLE": 409,
    "VALIDATION_ERROR": 422,
    "DURATION_EXCEEDS_PRESET": 422,
    "SLOT_OUTSIDE_CLIP": 422,
    "RANGE_NOT_SATISFIABLE": 416,
    "QUOTA_EXCEEDED": 429,
    "LLM_INVALID_OUTPUT": 502,
    "INTERNAL_ERROR": 500,
    "LLM_BUSY": 503,
    "LLM_NOT_CONFIGURED": 503,
    "ASR_UNAVAILABLE": 503,
    "MEDIA_FAILED": 500,
    "UPLOAD_TOO_LARGE": 413,
    "INSUFFICIENT_STORAGE": 507,
    "UPLOAD_INCOMPLETE": 409,
    "UPLOAD_CLOSED": 409,
    "SEARCH_NOT_CONFIGURED": 503,
    "SEARCH_FAILED": 502,
    "YT_IMPORT_UNAVAILABLE": 503,
    "YT_UNAVAILABLE": 422,
    "YT_LOGIN_REQUIRED": 422,
    "YT_TOO_LONG": 422,
    "YT_DOWNLOAD_FAILED": 502,
}


class AppError(Exception):
    """A domain error with a stable machine code. Raise it anywhere; handlers shape the response."""

    def __init__(
        self,
        code: str,
        message: str = "",
        *,
        status: int | None = None,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        retryable: bool = True,
    ) -> None:
        self.code = code
        self.retryable = retryable  # False: the job runner will not retry a job that raised this
        self.status = status if status is not None else ERROR_CODES.get(code, 400)
        self.message = message or code.replace("_", " ").capitalize()
        self.details = details or {}
        self.headers = headers or {}
        super().__init__(f"{code}: {self.message}")

    def body(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


def not_found(entity: str = "Resource", **details: Any) -> AppError:
    """``NOT_FOUND`` (404) for a missing or foreign-workspace entity."""
    return AppError("NOT_FOUND", f"{entity} not found", details=details)


def llm_busy(
    retry_after: float, message: str = "The AI service is busy, try again shortly"
) -> AppError:
    """``LLM_BUSY`` (503) carrying ``retry_after`` seconds."""
    seconds = max(1, round(retry_after))
    return AppError(
        "LLM_BUSY",
        message,
        details={"retry_after": seconds},
        headers={"Retry-After": str(seconds)},
    )


def _response(err: AppError) -> JSONResponse:
    return JSONResponse(err.body(), status_code=err.status, headers=err.headers)


async def _app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return _response(exc)


async def _validation_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = [
        {
            "loc": [str(p) for p in e.get("loc", ())],
            "msg": e.get("msg", ""),
            "type": e.get("type", ""),
        }
        for e in exc.errors()
    ]
    return _response(
        AppError("VALIDATION_ERROR", "Request validation failed", details={"errors": errors})
    )


_HTTP_CODES = {
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    416: "RANGE_NOT_SATISFIABLE",
    422: "VALIDATION_ERROR",
    429: "QUOTA_EXCEEDED",
}


async def _http_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = _HTTP_CODES.get(
        exc.status_code, "INTERNAL_ERROR" if exc.status_code >= 500 else "BAD_REQUEST"
    )
    err = AppError(code, str(exc.detail), status=exc.status_code, headers=dict(exc.headers or {}))
    return _response(err)


async def _unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error", exc_info=exc)
    return _response(AppError("INTERNAL_ERROR", "Something went wrong on our side"))


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(StarletteHTTPException, _http_handler)
    app.add_exception_handler(Exception, _unhandled_handler)
