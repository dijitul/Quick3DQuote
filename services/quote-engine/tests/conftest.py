"""Test fixtures.

We stub R2 via a tiny in-process fake instead of pulling in moto for the
most common cases — it's faster to start, has no network dependency, and
covers the two methods we actually use (HEAD / GET). For tests that want
the real S3 protocol path, use the `moto_r2` fixture.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient

# ─────────────────── Environment for the whole test session ──────────────────
INTERNAL_KEY = "test-secret-key-abc123"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_KEY", INTERNAL_KEY)
    monkeypatch.setenv("R2_ACCOUNT_ID", "test-account")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_BUCKET", "meshes-test")
    monkeypatch.setenv("SENTRY_DSN", "")
    monkeypatch.setenv("LOG_LEVEL", "warning")

    # Settings + the storage client are cached at module load; bust both
    # so each test reads the freshly-monkeypatched env.
    from app import config, storage

    config.get_settings.cache_clear()
    config.settings = config.get_settings()
    storage._client.cache_clear()


# ─────────────────────────── Fake R2 stub ─────────────────────────────
class FakeR2:
    """Minimal in-memory stand-in for boto3 s3 HEAD/GET."""

    def __init__(self) -> None:
        self._objects: dict[str, bytes] = {}

    def put(self, key: str, data: bytes) -> None:
        self._objects[key] = data

    def head(self, key: str) -> dict[str, Any]:
        if key not in self._objects:
            raise KeyError(key)
        data = self._objects[key]
        return {"ContentLength": len(data), "ContentType": "application/octet-stream", "ETag": '"x"'}

    def get(self, key: str) -> dict[str, Any]:
        if key not in self._objects:
            raise KeyError(key)
        data = self._objects[key]

        class _Body:
            def __init__(self, payload: bytes) -> None:
                self._payload = payload
                self._closed = False

            def iter_chunks(self, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
                for i in range(0, len(self._payload), chunk_size):
                    yield self._payload[i : i + chunk_size]

            def close(self) -> None:
                self._closed = True

        return {"Body": _Body(data), "ContentLength": len(data)}


@pytest.fixture
def fake_r2(monkeypatch: pytest.MonkeyPatch) -> FakeR2:
    """Install a fake R2 in place of the boto3 client."""
    r2 = FakeR2()

    from app import storage

    class _FakeClient:
        def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return r2.head(Key)

        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return r2.get(Key)

    monkeypatch.setattr(storage, "_client", lambda: _FakeClient())  # type: ignore[assignment]
    return r2


# ─────────────────────────── FastAPI client ────────────────────────────
@pytest.fixture
def client() -> Iterator[TestClient]:
    from app.main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"X-Internal-Key": INTERNAL_KEY, "X-Request-Id": "test-req-1"}


# ─────────────────────────── Fixture cube ─────────────────────────────
FIXTURES_DIR = Path(__file__).parent / "fixtures"
CUBE_10MM_PATH = FIXTURES_DIR / "cube_10mm.stl"


def _make_cube_stl(side_mm: float) -> bytes:
    """Build a binary STL of an axis-aligned cube with side length in mm."""
    mesh = trimesh.creation.box(extents=[side_mm, side_mm, side_mm])
    buf = io.BytesIO()
    mesh.export(buf, file_type="stl")
    return buf.getvalue()


@pytest.fixture(scope="session", autouse=True)
def _ensure_cube_fixture() -> None:
    """Generate `cube_10mm.stl` on first run if it's not already checked in.

    STL is deterministic for trimesh-created boxes, so every dev/CI gets
    the same bytes. Size is ~700 bytes.
    """
    FIXTURES_DIR.mkdir(exist_ok=True)
    if not CUBE_10MM_PATH.exists():
        CUBE_10MM_PATH.write_bytes(_make_cube_stl(10.0))


@pytest.fixture
def cube_10mm_bytes() -> bytes:
    return CUBE_10MM_PATH.read_bytes()


# ─────────────────────────── OBJ fixture ──────────────────────────────
@pytest.fixture
def simple_cube_obj_bytes() -> bytes:
    """Hand-rolled 10mm cube OBJ — tiny + deterministic."""
    lines = [
        "v 0 0 0",
        "v 10 0 0",
        "v 10 10 0",
        "v 0 10 0",
        "v 0 0 10",
        "v 10 0 10",
        "v 10 10 10",
        "v 0 10 10",
        "f 1 2 3",
        "f 1 3 4",
        "f 5 7 6",
        "f 5 8 7",
        "f 1 5 6",
        "f 1 6 2",
        "f 2 6 7",
        "f 2 7 3",
        "f 3 7 8",
        "f 3 8 4",
        "f 4 8 5",
        "f 4 5 1",
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


# ─────────────────────────── zip-bomb helper ──────────────────────────
@pytest.fixture
def zip_bomb_3mf_bytes() -> bytes:
    """A 3MF-shaped zip whose uncompressed content would dwarf its compressed size.

    We don't actually need 10GB — we just need the central directory to
    declare a ratio above `MAX_3MF_RATIO`. zipfile writes real headers,
    so we craft one by hand for the cheap version: a very compressible
    all-zero payload in a single entry.
    """
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        # 50MB of zeros compresses to ~50KB → ratio ~1000, well over cap 100.
        payload = np.zeros(50 * 1024 * 1024, dtype=np.uint8).tobytes()
        zf.writestr("3D/3dmodel.model", payload)
        zf.writestr("[Content_Types].xml", "<xml/>")
    return buf.getvalue()
