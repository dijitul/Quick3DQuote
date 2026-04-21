"""Runtime settings, sourced from environment variables.

Loaded once at import time. Tests override via `Settings(...)` kwargs or
by monkeypatching the module-level `settings` instance (see conftest).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app import __version__


class Settings(BaseSettings):
    """Typed environment configuration.

    All fields here are read from process env. Never log the instance as-is;
    secrets must not appear in structured log output.
    """

    model_config = SettingsConfigDict(
        env_file=None,            # Fly/Vercel inject env directly; .env is dev-only
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # Service identity
    version: str = __version__
    environment: str = Field(default="development")

    # Internal auth
    INTERNAL_KEY: str = Field(
        default="",
        description="Shared secret required on X-Internal-Key header for all non-health routes.",
    )

    # Cloudflare R2 (S3-compatible)
    R2_ACCOUNT_ID: str = Field(default="")
    R2_ACCESS_KEY_ID: str = Field(default="")
    R2_SECRET_ACCESS_KEY: str = Field(default="")
    R2_BUCKET: str = Field(default="meshes-dev")
    R2_ENDPOINT_URL: str | None = Field(
        default=None,
        description="Override for R2 endpoint, e.g. https://<accountid>.r2.cloudflarestorage.com. "
        "If unset, derived from R2_ACCOUNT_ID.",
    )

    # Observability
    SENTRY_DSN: str = Field(default="")
    LOG_LEVEL: str = Field(default="info")

    # Safety rails
    MAX_MESH_SIZE_MB: int = Field(default=100, ge=1, le=1024)
    MAX_TRIANGLES: int = Field(default=10_000_000, ge=1_000)
    ANALYSIS_TIMEOUT_SECONDS: int = Field(default=15, ge=1, le=120)
    MAX_3MF_UNCOMPRESSED_MB: int = Field(default=500, ge=1, le=2048)
    MAX_3MF_RATIO: int = Field(
        default=100,
        description="Reject 3MF archives whose uncompressed/compressed ratio exceeds this.",
    )

    # CORS — Next.js origins allowed to talk to us. Service-to-service usually
    # means same-origin / private network, but we belt-and-brace.
    ALLOWED_ORIGINS: str = Field(
        default="https://quick3dquote.com,https://www.quick3dquote.com",
        description="Comma-separated list of allowed origins for CORS.",
    )

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def max_mesh_size_bytes(self) -> int:
        return self.MAX_MESH_SIZE_MB * 1024 * 1024

    @property
    def max_3mf_uncompressed_bytes(self) -> int:
        return self.MAX_3MF_UNCOMPRESSED_MB * 1024 * 1024

    @property
    def r2_endpoint(self) -> str:
        if self.R2_ENDPOINT_URL:
            return self.R2_ENDPOINT_URL
        if not self.R2_ACCOUNT_ID:
            return ""
        return f"https://{self.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor. Tests call `get_settings.cache_clear()` when mutating env."""
    return Settings()


settings = get_settings()
