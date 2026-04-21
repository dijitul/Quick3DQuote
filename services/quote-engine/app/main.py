"""FastAPI app factory.

Wires middleware, routes, exception handlers, and optional Sentry. The
factory pattern means tests can build a fresh app per fixture without
relying on import-time side effects.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import settings
from app.errors import (
    QuoteEngineError,
    quote_engine_error_handler,
    unhandled_exception_handler,
)
from app.logging_config import RequestContextMiddleware, configure_logging, get_logger
from app.routes.analyze import router as analyze_router
from app.routes.health import router as health_router
from app.routes.price import router as price_router


def _init_sentry() -> None:
    """Initialise Sentry only if a DSN is configured."""
    if not settings.SENTRY_DSN:
        return
    # Local import to avoid SDK import cost when DSN is unset (dev / tests).
    import sentry_sdk
    from sentry_sdk.integrations.asyncio import AsyncioIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.environment,
        release=f"quote-engine@{__version__}",
        traces_sample_rate=0.05,
        send_default_pii=False,
        integrations=[FastApiIntegration(), AsyncioIntegration()],
    )


def create_app() -> FastAPI:
    configure_logging()
    _init_sentry()

    app = FastAPI(
        title="Quick3DQuote Quote Engine",
        version=__version__,
        docs_url=None,          # internal service; no public docs
        redoc_url=None,
        openapi_url=None,
    )

    # CORS — service-to-service only, but we still allow our own origins
    # for local curl/dev tooling. Never wildcard.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Internal-Key", "X-Request-Id", "traceparent"],
        max_age=3600,
    )

    app.add_middleware(RequestContextMiddleware)

    # Exception handlers — order matters: specific first.
    app.add_exception_handler(QuoteEngineError, quote_engine_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_exception_handler)

    # Routes
    app.include_router(health_router)     # no auth
    app.include_router(analyze_router)    # auth via router dependency
    app.include_router(price_router)      # auth via router dependency

    log = get_logger(__name__)
    log.info(
        "app.started",
        version=__version__,
        environment=settings.environment,
        r2_bucket=settings.R2_BUCKET,
        max_mesh_size_mb=settings.MAX_MESH_SIZE_MB,
    )
    return app


app = create_app()
