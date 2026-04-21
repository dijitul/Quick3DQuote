"""Pydantic request/response models.

Money is `Decimal` everywhere. We serialise `Decimal` to JSON strings so
the JS side receives a lossless representation (the Next.js client then
converts to pence-as-int for Stripe — the engine does not know about
pence, only the native shop currency).

Mesh geometry is `float` — these are physical measurements, not money.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

# Every Decimal field uses this alias so JSON output is `"9.30"`, not `9.3`.
# PlainSerializer applies only to `.model_dump(mode="json")` / `.model_dump_json()`;
# Python-side access still returns the raw Decimal.
Money = Annotated[
    Decimal,
    PlainSerializer(lambda v: str(v), return_type=str, when_used="json"),
]


class _Base(BaseModel):
    """Shared model config."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        frozen=False,
    )


# ─────────────────────────── Analyze ───────────────────────────────
class AnalyzeMeshRequest(_Base):
    r2_key: str = Field(..., min_length=1, max_length=1024)


class AnalyzeMeshResponse(_Base):
    volume_cm3: float = Field(..., ge=0)
    surface_area_cm2: float = Field(..., ge=0)
    bbox_x: float = Field(..., ge=0)
    bbox_y: float = Field(..., ge=0)
    bbox_z: float = Field(..., ge=0)
    triangle_count: int = Field(..., ge=0)
    is_watertight: bool
    is_repairable: bool
    warnings: list[str] = Field(default_factory=list)


# ─────────────────────────── Price ─────────────────────────────────
class MaterialRef(_Base):
    price_per_cm3: Money = Field(..., ge=Decimal("0"))
    density_g_per_cm3: Money = Field(..., gt=Decimal("0"))


class ProcessRef(_Base):
    hourly_rate: Money = Field(..., ge=Decimal("0"))
    setup_fee: Money = Field(..., ge=Decimal("0"))
    min_order: Money = Field(..., ge=Decimal("0"))
    markup_pct: Money = Field(
        ...,
        ge=Decimal("0"),
        le=Decimal("5"),
        description="Fractional markup applied to subtotal. 0.20 = +20%.",
    )
    throughput_cm3_per_hour: Money = Field(..., gt=Decimal("0"))
    currency: str = Field(default="GBP", min_length=3, max_length=3)


class PriceRequest(_Base):
    volume_cm3: Money = Field(..., gt=Decimal("0"))
    material: MaterialRef
    process: ProcessRef
    quantity: int = Field(..., ge=1, le=1000)


class BreakdownLine(_Base):
    label: str = Field(..., min_length=1, max_length=80)
    amount: Money
    note: str | None = Field(default=None, max_length=200)


class PriceResponse(_Base):
    unit_price: Money
    material_cost: Money
    machine_cost: Money
    setup_cost: Money
    markup_amount: Money
    subtotal: Money
    total: Money
    currency: str
    print_hours: Money
    breakdown_lines: list[BreakdownLine]
