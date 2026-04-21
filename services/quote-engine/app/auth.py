"""Internal auth dependency.

The engine trusts the Next.js web app and no one else. A single shared
secret (`INTERNAL_KEY`) is compared against the `X-Internal-Key` header
with a constant-time compare to defeat timing oracles.

Health checks bypass this dependency — they are mounted without it.
"""

from __future__ import annotations

import hmac

from fastapi import Header

from app.config import settings
from app.errors import InternalAuthError


async def verify_internal_key(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> None:
    """FastAPI dependency. Raises `InternalAuthError` on any mismatch.

    We deliberately return the same opaque 401 for every failure mode so
    the route surface gives up no information about the header name,
    key length, or validity. The logs still record the reason.
    """
    expected = settings.INTERNAL_KEY
    if not expected:
        # Misconfiguration: the service must not run without a secret.
        # Raise 401 not 500 so we don't leak config state to the public internet.
        raise InternalAuthError("Missing internal key configuration.")

    if x_internal_key is None or not hmac.compare_digest(x_internal_key, expected):
        raise InternalAuthError("Unauthorized.")
