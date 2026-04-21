"""Domain errors and their HTTP translation.

All errors raised under `app/` should be one of these types so the
global exception handler can map to a stable, machine-readable body.
"""

from __future__ import annotations

from fastapi import Request, status
from fastapi.responses import JSONResponse


class QuoteEngineError(Exception):
    """Base class. Subclasses set `status_code` and `code`."""

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: str = "internal_error"

    def __init__(self, message: str, *, detail: object | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail


class InternalAuthError(QuoteEngineError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


class MeshAnalysisError(QuoteEngineError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "mesh_analysis_failed"


class UnsupportedFormatError(QuoteEngineError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "unsupported_format"


class MeshTooLargeError(QuoteEngineError):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    code = "file_too_large"


class MeshTooComplexError(QuoteEngineError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "mesh_too_complex"


class UpstreamFetchError(QuoteEngineError):
    status_code = status.HTTP_502_BAD_GATEWAY
    code = "upstream_fetch_failed"


class AnalysisTimeoutError(QuoteEngineError):
    status_code = status.HTTP_504_GATEWAY_TIMEOUT
    code = "analysis_timeout"


# ─────────────────────────── handlers ─────────────────────────────
async def quote_engine_error_handler(request: Request, exc: QuoteEngineError) -> JSONResponse:
    """Map our exceptions to RFC-7807-lite Problem+JSON.

    Keep the body minimal — no stack traces, no internal paths. The
    `request_id` comes from the structlog-populated header so clients
    can correlate in our logs.
    """
    request_id = request.headers.get("X-Request-Id", "")
    body = {
        "type": f"about:blank#{exc.code}",
        "title": exc.code,
        "status": exc.status_code,
        "detail": exc.message,
        "request_id": request_id,
    }
    if exc.detail is not None:
        body["extensions"] = {"detail": exc.detail}  # type: ignore[assignment]
    return JSONResponse(
        status_code=exc.status_code,
        content=body,
        media_type="application/problem+json",
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Fallback: never leak. Log will be emitted by structlog middleware."""
    request_id = request.headers.get("X-Request-Id", "")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "type": "about:blank#internal_error",
            "title": "internal_error",
            "status": 500,
            "detail": "An internal error occurred.",
            "request_id": request_id,
        },
        media_type="application/problem+json",
    )
