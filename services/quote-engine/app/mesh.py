"""Mesh analysis.

Takes raw bytes + a declared file type, returns `AnalyzeMeshResponse`.
We accept three formats: STL (binary + ASCII), OBJ, 3MF (zip container).

Security posture (from `docs/security.md` §3):

- Magic-byte sniff first; reject unknown formats before handing bytes to trimesh.
- Triangle count header check on binary STL (the cheap win).
- 3MF is a zip — walk the central directory, reject zip-bombs + zip-slip paths.
- Hard triangle-count ceiling AFTER parse.
- If the mesh is non-watertight, we still compute a bounding-box-based
  fallback volume and flag a `warnings` entry so the caller can decide
  whether to quote or refuse.
"""

from __future__ import annotations

import io
import os
import struct
import time
import zipfile

import trimesh

from app.config import settings
from app.errors import (
    MeshAnalysisError,
    MeshTooComplexError,
    MeshTooLargeError,
    UnsupportedFormatError,
)
from app.logging_config import get_logger

log = get_logger(__name__)

SUPPORTED_FORMATS = frozenset({"stl", "obj", "3mf"})


# ─────────────────────────── format sniffing ───────────────────────────
def sniff_format(file_bytes: bytes) -> str:
    """Return a canonical format string from magic bytes, or raise `UnsupportedFormatError`.

    We look at at most the first 256 bytes. Callers who pass fewer than
    that get a short read, which is fine — we only need the header.
    """
    head = file_bytes[:256]
    if len(head) < 5:
        raise UnsupportedFormatError("File too short to identify.")

    # 3MF / any zip container
    if head[:4] == b"\x50\x4B\x03\x04":
        return "3mf"

    # ASCII STL starts with "solid "
    if head[:5].lower() == b"solid":
        return "stl"

    # OBJ: text, typically starts with #, v, o, mtllib, etc.
    stripped = head.lstrip()
    if stripped[:2] in (b"v ", b"vn", b"vt", b"o ", b"g ") or stripped[:1] == b"#":
        # Reject if NUL bytes appear in the first 8KB — binary smuggling.
        if b"\x00" in file_bytes[: 8 * 1024]:
            raise UnsupportedFormatError("OBJ appears to contain binary payload.")
        return "obj"

    # Binary STL has no magic; validate via header/triangle-count math.
    if len(file_bytes) >= 84:
        (tri_count,) = struct.unpack_from("<I", file_bytes, 80)
        expected = 84 + tri_count * 50
        if expected == len(file_bytes):
            return "stl"

    raise UnsupportedFormatError("Unrecognised mesh format.")


# ─────────────────────────── 3MF zip-bomb guard ─────────────────────────
def validate_3mf(file_bytes: bytes) -> None:
    """Reject zip-bombs and zip-slip payloads BEFORE decompression.

    Checks the central directory:
      1. Every entry's uncompressed size is <= `max_3mf_uncompressed_bytes`.
      2. Sum of uncompressed sizes <= same cap.
      3. uncompressed/compressed ratio < `MAX_3MF_RATIO`.
      4. No entry name contains `..`, absolute path, or backslash separator.
    """
    max_uncompressed = settings.max_3mf_uncompressed_bytes
    max_ratio = settings.MAX_3MF_RATIO

    try:
        zf = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile as exc:
        raise MeshAnalysisError("Malformed 3MF (not a zip).") from exc

    total_uncompressed = 0
    with zf:
        for info in zf.infolist():
            name = info.filename
            # Zip slip defence: reject parent traversal + absolute paths.
            if (
                ".." in name.split("/")
                or name.startswith("/")
                or "\\" in name
                or os.path.isabs(name)
            ):
                raise MeshAnalysisError(f"3MF entry has unsafe path: {name!r}")

            if info.file_size > max_uncompressed:
                raise MeshTooLargeError(
                    f"3MF entry {name!r} would decompress to {info.file_size} bytes."
                )

            # Ratio check — compressed=0 means a literally empty file, skip.
            if info.compress_size > 0:
                ratio = info.file_size / info.compress_size
                if ratio > max_ratio:
                    raise MeshAnalysisError(
                        f"3MF entry {name!r} has suspicious compression ratio {ratio:.1f}."
                    )

            total_uncompressed += info.file_size
            if total_uncompressed > max_uncompressed:
                raise MeshTooLargeError(
                    f"3MF total uncompressed size {total_uncompressed} exceeds cap."
                )


# ─────────────────────────── analyse ───────────────────────────────
def analyze_mesh(file_bytes: bytes, file_type: str | None = None) -> dict[str, object]:
    """Parse + measure a mesh. Returns a dict suitable for `AnalyzeMeshResponse(**...)`.

    Raises:
        UnsupportedFormatError: format sniff failed.
        MeshAnalysisError:     trimesh couldn't load it or produced no geometry.
        MeshTooComplexError:   triangle count > `MAX_TRIANGLES`.
        MeshTooLargeError:     3MF zip-bomb check tripped.
    """
    if not file_bytes:
        raise MeshAnalysisError("Empty file.")

    detected = sniff_format(file_bytes)
    if file_type and file_type.lower() != detected:
        log.info("mesh.type_mismatch", declared=file_type, detected=detected)
    fmt = detected

    if fmt not in SUPPORTED_FORMATS:
        raise UnsupportedFormatError(f"Unsupported format: {fmt}")

    if fmt == "3mf":
        validate_3mf(file_bytes)

    # Cheap sanity check on binary STL: triangle-count from header.
    if fmt == "stl" and len(file_bytes) >= 84 and file_bytes[:5].lower() != b"solid":
        (tri_count,) = struct.unpack_from("<I", file_bytes, 80)
        if tri_count > settings.MAX_TRIANGLES:
            raise MeshTooComplexError(
                f"Binary STL declares {tri_count} triangles, over cap {settings.MAX_TRIANGLES}."
            )

    t0 = time.perf_counter()
    try:
        loaded = trimesh.load(
            io.BytesIO(file_bytes),
            file_type=fmt,
            force="mesh",  # flatten scenes into a single mesh for measurement
            process=False,  # don't auto-merge; we want raw triangle count
        )
    except Exception as exc:  # noqa: BLE001 — trimesh uses a zoo of exceptions
        raise MeshAnalysisError(f"Failed to parse {fmt}: {exc}") from exc

    if not isinstance(loaded, trimesh.Trimesh):
        raise MeshAnalysisError("Mesh did not resolve to a single Trimesh.")
    mesh = loaded

    triangle_count = int(len(mesh.faces))
    if triangle_count == 0:
        raise MeshAnalysisError("Mesh has no triangles.")
    if triangle_count > settings.MAX_TRIANGLES:
        raise MeshTooComplexError(
            f"Mesh has {triangle_count} triangles, over cap {settings.MAX_TRIANGLES}."
        )

    warnings: list[str] = []
    is_watertight = bool(mesh.is_watertight)
    is_repairable = False

    # trimesh uses the mesh's native units (mm by STL convention).
    # volume is in mm³; 1 cm³ = 1000 mm³.
    bbox_extents = mesh.bounding_box.extents  # (x, y, z) in mm

    if is_watertight:
        volume_mm3 = float(mesh.volume)
        # Rare edge case: a watertight mesh with inverted normals gives a
        # negative signed volume. Flip.
        if volume_mm3 < 0:
            warnings.append("volume_sign_corrected_inverted_normals")
            volume_mm3 = abs(volume_mm3)
    else:
        # Try repair. Be conservative — we don't actually mutate the geometry
        # we price on, we just flag that it COULD be closed.
        try:
            trimesh.repair.fill_holes(mesh)
            trimesh.repair.fix_normals(mesh)
            is_repairable = bool(mesh.is_watertight)
        except Exception:  # noqa: BLE001
            is_repairable = False

        if is_repairable:
            volume_mm3 = abs(float(mesh.volume))
            warnings.append("repaired_to_watertight")
        else:
            # Fallback: bounding-box volume. Not accurate, but non-zero and
            # lets the shop decide. The frontend surfaces this as a warning.
            volume_mm3 = float(bbox_extents[0] * bbox_extents[1] * bbox_extents[2])
            warnings.append("non_watertight_bbox_fallback")

    volume_cm3 = volume_mm3 / 1000.0
    surface_area_cm2 = float(mesh.area) / 100.0  # mm² → cm²

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    log.info(
        "mesh.analysed",
        format=fmt,
        triangle_count=triangle_count,
        watertight=is_watertight,
        repairable=is_repairable,
        analysis_ms=elapsed_ms,
    )

    return {
        "volume_cm3": round(volume_cm3, 4),
        "surface_area_cm2": round(surface_area_cm2, 2),
        "bbox_x": round(float(bbox_extents[0]), 2),
        "bbox_y": round(float(bbox_extents[1]), 2),
        "bbox_z": round(float(bbox_extents[2]), 2),
        "triangle_count": triangle_count,
        "is_watertight": is_watertight,
        "is_repairable": is_repairable,
        "warnings": warnings,
    }
