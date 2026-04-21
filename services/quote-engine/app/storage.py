"""Thin R2/S3 client.

We never stream a mesh we've already proven is over the budget, so we
always HEAD first and reject on `ContentLength > max_mesh_size_bytes`
*before* transferring bytes.

R2 is S3-compatible, sig v4. We use boto3 (brings its own signature
handling) rather than rolling our own.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from functools import lru_cache
from typing import TYPE_CHECKING

import boto3
from botocore.client import Config as BotoConfig

from app.config import settings
from app.errors import MeshTooLargeError, UpstreamFetchError
from app.logging_config import get_logger

if TYPE_CHECKING:
    from botocore.client import BaseClient


log = get_logger(__name__)


@dataclass(frozen=True)
class ObjectMeta:
    size: int
    content_type: str
    etag: str


@lru_cache(maxsize=1)
def _client() -> "BaseClient":
    """Build a boto3 S3 client configured for Cloudflare R2."""
    endpoint = settings.r2_endpoint
    if not endpoint:
        # Callers get a clear error instead of a mysterious SSL failure.
        raise UpstreamFetchError("R2 endpoint is not configured.")

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",  # R2 doesn't use AWS regions
        config=BotoConfig(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=5,
            read_timeout=30,
        ),
    )


def head_object(key: str) -> ObjectMeta:
    """Fetch size + content-type without downloading bytes.

    Raises `UpstreamFetchError` if R2 is down or the key doesn't exist.
    """
    client = _client()
    try:
        resp = client.head_object(Bucket=settings.R2_BUCKET, Key=key)
    except Exception as exc:  # noqa: BLE001 — boto raises many types
        log.warning("r2.head_failed", key=key, error=str(exc))
        raise UpstreamFetchError("Failed to HEAD mesh from R2.") from exc

    size = int(resp.get("ContentLength", 0))
    content_type = str(resp.get("ContentType", "application/octet-stream"))
    etag = str(resp.get("ETag", "")).strip('"')
    return ObjectMeta(size=size, content_type=content_type, etag=etag)


def get_object(key: str, *, max_bytes: int | None = None) -> bytes:
    """Download an object, enforcing `max_bytes`.

    We read from the stream into an in-memory buffer; we stop and raise
    as soon as we cross `max_bytes` so a hostile `ContentLength: 1` with
    a chunked 10GB body can't run us out of memory.
    """
    cap = max_bytes if max_bytes is not None else settings.max_mesh_size_bytes
    client = _client()

    # Defence in depth: HEAD first. If the server is honest, we reject without downloading.
    meta = head_object(key)
    if meta.size > cap:
        raise MeshTooLargeError(
            f"Mesh {meta.size} bytes exceeds cap {cap} bytes.",
        )

    try:
        resp = client.get_object(Bucket=settings.R2_BUCKET, Key=key)
    except Exception as exc:  # noqa: BLE001
        log.warning("r2.get_failed", key=key, error=str(exc))
        raise UpstreamFetchError("Failed to GET mesh from R2.") from exc

    buf = io.BytesIO()
    total = 0
    body = resp["Body"]
    try:
        # boto3 StreamingBody is iterable in chunks via `iter_chunks`.
        for chunk in body.iter_chunks(chunk_size=1024 * 1024):
            total += len(chunk)
            if total > cap:
                raise MeshTooLargeError(
                    f"Mesh stream exceeded cap {cap} bytes during download."
                )
            buf.write(chunk)
    finally:
        body.close()

    return buf.getvalue()
