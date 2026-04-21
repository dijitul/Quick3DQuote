"""Structured JSON logging with structlog.

We log every request with a bound `request_id` (generated at the edge by
Vercel and forwarded via `X-Request-Id`) plus the optional W3C `traceparent`
id. Mesh content is NEVER logged — callers only log metadata.
"""

from __future__ import annotations

import logging
import sys
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings

_LEVEL_BY_NAME = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}


def configure_logging() -> None:
    """Wire stdlib logging + structlog together. Idempotent."""
    level = _LEVEL_BY_NAME.get(settings.LOG_LEVEL.lower(), logging.INFO)

    # Standard library: route to stderr as plain text, structlog will
    # produce JSON for its own logger.
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stderr,
        level=level,
        force=True,
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(sys.stderr),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)  # type: ignore[no-any-return]


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Bind request_id + traceparent into the structlog context for the life of the request."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        incoming_request_id = request.headers.get("X-Request-Id")
        request_id = incoming_request_id or str(uuid.uuid4())
        traceparent = request.headers.get("traceparent", "")

        structlog.contextvars.clear_contextvars()
        bound: dict[str, Any] = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
        }
        if traceparent:
            bound["traceparent"] = traceparent
        structlog.contextvars.bind_contextvars(**bound)

        log = get_logger("request")
        log.info("request.start")

        try:
            response = await call_next(request)
        except Exception:
            log.exception("request.error")
            raise

        response.headers["X-Request-Id"] = request_id
        log.info("request.end", status_code=response.status_code)
        return response
