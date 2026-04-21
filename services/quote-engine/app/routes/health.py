"""Health check. No auth — Fly's HTTP checks must be able to hit it."""

from __future__ import annotations

from fastapi import APIRouter

from app.config import settings

router = APIRouter()


@router.get("/health", include_in_schema=False)
async def health() -> dict[str, object]:
    return {"ok": True, "version": settings.version}
