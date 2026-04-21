"""Mesh analysis tests — STL, OBJ, oversized rejection, zip-bomb defence."""

from __future__ import annotations

import io
import struct
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.errors import MeshTooLargeError, UnsupportedFormatError
from app.mesh import analyze_mesh, sniff_format


# ─────────────────────────── format sniff ─────────────────────────
def test_sniff_binary_stl(cube_10mm_bytes: bytes) -> None:
    assert sniff_format(cube_10mm_bytes) == "stl"


def test_sniff_ascii_stl() -> None:
    data = b"solid test\n endsolid test\n"
    assert sniff_format(data) == "stl"


def test_sniff_obj(simple_cube_obj_bytes: bytes) -> None:
    assert sniff_format(simple_cube_obj_bytes) == "obj"


def test_sniff_3mf_magic() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("x", "y")
    assert sniff_format(buf.getvalue()) == "3mf"


def test_sniff_rejects_garbage() -> None:
    with pytest.raises(UnsupportedFormatError):
        sniff_format(b"\x7fELF" + b"\x00" * 100)


def test_sniff_rejects_too_short() -> None:
    with pytest.raises(UnsupportedFormatError):
        sniff_format(b"ab")


# ─────────────────────────── STL volume ────────────────────────────
def test_analyze_10mm_cube_stl_yields_1cm3(cube_10mm_bytes: bytes) -> None:
    result = analyze_mesh(cube_10mm_bytes, "stl")
    # 10mm × 10mm × 10mm = 1000mm³ = 1.0 cm³
    assert result["volume_cm3"] == pytest.approx(1.0, abs=1e-3)
    assert result["bbox_x"] == pytest.approx(10.0, abs=1e-3)
    assert result["bbox_y"] == pytest.approx(10.0, abs=1e-3)
    assert result["bbox_z"] == pytest.approx(10.0, abs=1e-3)
    assert result["triangle_count"] == 12  # standard cube
    assert result["is_watertight"] is True


def test_analyze_obj_cube(simple_cube_obj_bytes: bytes) -> None:
    result = analyze_mesh(simple_cube_obj_bytes, "obj")
    assert result["volume_cm3"] == pytest.approx(1.0, abs=0.01)
    assert result["triangle_count"] == 12


# ─────────────────────────── oversized rejection ────────────────────
def test_analyze_endpoint_rejects_oversized(
    client: TestClient,
    fake_r2: object,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 'huge' mesh is rejected on the HEAD cap before any download.

    We shrink the cap to 1MB so the test can use a 2MB payload and
    stay fast; the logic under test is the HEAD-check, not the byte
    count per se.
    """
    from app import config

    monkeypatch.setattr(config.settings, "MAX_MESH_SIZE_MB", 1)

    # 2MB of plausible-looking binary STL header + zero body.
    size = 2 * 1024 * 1024
    payload = b"\x00" * 80 + struct.pack("<I", 0) + b"\x00" * (size - 84)
    fake_r2.put("meshes/big.stl", payload)  # type: ignore[attr-defined]

    resp = client.post(
        "/analyze-mesh",
        json={"r2_key": "meshes/big.stl"},
        headers=auth_headers,
    )
    assert resp.status_code == 413
    body = resp.json()
    assert body["title"] == "file_too_large"


# ─────────────────────────── empty + malformed ──────────────────────
def test_analyze_empty_file_raises() -> None:
    with pytest.raises(Exception):
        analyze_mesh(b"", "stl")


def test_analyze_endpoint_happy_path(
    client: TestClient,
    fake_r2: object,
    auth_headers: dict[str, str],
    cube_10mm_bytes: bytes,
) -> None:
    fake_r2.put("meshes/shop-1/quote-1/cube.stl", cube_10mm_bytes)  # type: ignore[attr-defined]
    resp = client.post(
        "/analyze-mesh",
        json={"r2_key": "meshes/shop-1/quote-1/cube.stl"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["volume_cm3"] == pytest.approx(1.0, abs=1e-3)
    assert body["triangle_count"] == 12
    assert body["is_watertight"] is True


# ─────────────────────────── 3MF zip-bomb ───────────────────────────
def test_3mf_zip_bomb_rejected(zip_bomb_3mf_bytes: bytes) -> None:
    # Either the ratio check or the uncompressed-size check should fire.
    with pytest.raises(Exception) as exc_info:
        analyze_mesh(zip_bomb_3mf_bytes, "3mf")
    # Accept either the analysis-failed mapping or the too-large mapping.
    from app.errors import MeshAnalysisError

    assert isinstance(exc_info.value, (MeshAnalysisError, MeshTooLargeError))


def test_3mf_zip_slip_path_rejected() -> None:
    # Build a malformed 3MF containing a parent-traversal path.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../../evil.txt", "bad")
        zf.writestr("3D/3dmodel.model", "x")
    with pytest.raises(Exception):
        analyze_mesh(buf.getvalue(), "3mf")


# ─────────────────────────── triangle count cap ─────────────────────
def test_binary_stl_with_declared_triangle_count_over_cap_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import config

    monkeypatch.setattr(config.settings, "MAX_TRIANGLES", 100)

    # Build a binary STL header that *claims* 1_000 triangles (cheap to allocate).
    # We check the declared-count guard *before* trimesh load; payload size is
    # consistent so sniff_format accepts it as STL.
    tri_count = 1_000
    payload = b"\x00" * 80 + struct.pack("<I", tri_count) + b"\x00" * (tri_count * 50)
    from app.errors import MeshTooComplexError

    with pytest.raises(MeshTooComplexError):
        analyze_mesh(payload, "stl")
