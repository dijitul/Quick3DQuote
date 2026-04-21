"""POST /analyze-mesh — download from R2 and measure.

Contract per `docs/api-design.md` §4.1: caller passes an R2 key (not a
URL); the engine owns the R2 credentials.

This route is CPU-bound. We push trimesh work into the default executor
pool so the event loop keeps serving /health and other concurrent
requests. The whole operation is wrapped in `asyncio.wait_for` so a
pathological mesh can't pin a machine forever.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from app.auth import verify_internal_key
from app.config import settings
from app.errors import AnalysisTimeoutError
from app.logging_config import get_logger
from app.mesh import analyze_mesh, sniff_format
from app.schemas import AnalyzeMeshRequest, AnalyzeMeshResponse
from app.storage import get_object, head_object

router = APIRouter(dependencies=[Depends(verify_internal_key)])
log = get_logger(__name__)


def _run_analysis(file_bytes: bytes) -> dict[str, object]:
    """CPU-bound wrapper called inside the executor."""
    fmt = sniff_format(file_bytes)
    return analyze_mesh(file_bytes, fmt)


@router.post("/analyze-mesh", response_model=AnalyzeMeshResponse)
async def analyze_mesh_endpoint(body: AnalyzeMeshRequest) -> AnalyzeMeshResponse:
    # Step 1: HEAD to reject oversized files before we spend bandwidth.
    meta = head_object(body.r2_key)
    log.info(
        "analyze.head",
        r2_key=body.r2_key,
        size=meta.size,
        content_type=meta.content_type,
    )

    # Step 2: fetch. `get_object` also enforces the cap streaming.
    file_bytes = get_object(body.r2_key, max_bytes=settings.max_mesh_size_bytes)

    # Step 3: parse + measure, off the event loop, under a hard timeout.
    loop = asyncio.get_running_loop()
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(None, _run_analysis, file_bytes),
            timeout=settings.ANALYSIS_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        log.warning("analyze.timeout", r2_key=body.r2_key)
        raise AnalysisTimeoutError(
            f"Mesh analysis exceeded {settings.ANALYSIS_TIMEOUT_SECONDS}s.",
        ) from exc

    return AnalyzeMeshResponse(**result)
