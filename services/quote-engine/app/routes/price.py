"""POST /price — pure pricing, no I/O.

Schema validation already covers quantity 1..1000 and volume > 0; we do
not redundantly validate here.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import verify_internal_key
from app.pricing import calculate_price
from app.schemas import PriceRequest, PriceResponse

router = APIRouter(dependencies=[Depends(verify_internal_key)])


@router.post("/price", response_model=PriceResponse)
async def price_endpoint(body: PriceRequest) -> PriceResponse:
    return calculate_price(
        volume_cm3=body.volume_cm3,
        material=body.material,
        process=body.process,
        quantity=body.quantity,
    )
