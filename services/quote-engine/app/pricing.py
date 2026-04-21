"""Pricing function — the heart of the product.

Implements the formula in `CLAUDE.md` §5 with `Decimal` arithmetic so
two calls with the same inputs always return the same bytes, and we
never drift because a browser rounded `0.1 + 0.2` to `0.30000000000004`.

The function is pure: no I/O, no DB, no global state. `PriceRequest`
enforces bounds (quantity 1..1000, positive volume/throughput, etc.)
so by the time we're in here, inputs are valid.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from app.schemas import (
    BreakdownLine,
    MaterialRef,
    PriceResponse,
    ProcessRef,
)

# Internal working precision. Money is quantised to 2dp at the edges.
_MONEY_Q = Decimal("0.01")
_HOURS_Q = Decimal("0.0001")


def _money(x: Decimal) -> Decimal:
    """Round to pennies, half-up. Banker's rounding would under-charge in aggregate."""
    return x.quantize(_MONEY_Q, rounding=ROUND_HALF_UP)


def _hours(x: Decimal) -> Decimal:
    return x.quantize(_HOURS_Q, rounding=ROUND_HALF_UP)


def calculate_price(
    *,
    volume_cm3: Decimal,
    material: MaterialRef,
    process: ProcessRef,
    quantity: int,
) -> PriceResponse:
    """Apply the pricing formula and return a structured breakdown.

    Formula (per `CLAUDE.md` §5):

        material_cost     = volume × material.price_per_cm3
        print_hours       = volume / process.throughput_cm3_per_hour
        machine_cost      = print_hours × process.hourly_rate
        setup_cost        = process.setup_fee
        subtotal_per_part = material_cost + machine_cost + setup_cost
        markup_amount     = subtotal_per_part × process.markup_pct
        unit_price        = subtotal_per_part + markup_amount
        total_raw         = unit_price × quantity
        total             = max(min_order, total_raw)
    """
    # Per-part costs ─────────────────────────────────────────────
    material_cost = _money(volume_cm3 * material.price_per_cm3)
    print_hours = _hours(volume_cm3 / process.throughput_cm3_per_hour)
    machine_cost = _money(print_hours * process.hourly_rate)
    setup_cost = _money(process.setup_fee)

    subtotal_per_part = _money(material_cost + machine_cost + setup_cost)
    markup_amount = _money(subtotal_per_part * process.markup_pct)
    unit_price = _money(subtotal_per_part + markup_amount)

    # Aggregate ─────────────────────────────────────────────────
    qty = Decimal(quantity)
    total_raw = _money(unit_price * qty)
    min_order_applied = total_raw < process.min_order
    total = _money(process.min_order) if min_order_applied else total_raw

    # Breakdown lines are rendered verbatim by the frontend.
    breakdown_lines: list[BreakdownLine] = [
        BreakdownLine(
            label="Material",
            amount=material_cost,
            note=f"{volume_cm3} cm³ @ {material.price_per_cm3}/cm³",
        ),
        BreakdownLine(
            label="Machine time",
            amount=machine_cost,
            note=f"{print_hours} h @ {process.hourly_rate}/h",
        ),
        BreakdownLine(
            label="Setup",
            amount=setup_cost,
            note=None,
        ),
        BreakdownLine(
            label="Subtotal per part",
            amount=subtotal_per_part,
            note=None,
        ),
        BreakdownLine(
            label="Markup",
            amount=markup_amount,
            note=f"{(process.markup_pct * Decimal(100)).normalize()}%",
        ),
        BreakdownLine(
            label="Unit price",
            amount=unit_price,
            note=None,
        ),
        BreakdownLine(
            label=f"Quantity × {quantity}",
            amount=total_raw,
            note=None,
        ),
    ]
    if min_order_applied:
        breakdown_lines.append(
            BreakdownLine(
                label="Minimum order applied",
                amount=_money(process.min_order),
                note=f"Raised from {total_raw} to shop minimum.",
            )
        )

    return PriceResponse(
        unit_price=unit_price,
        material_cost=material_cost,
        machine_cost=machine_cost,
        setup_cost=setup_cost,
        markup_amount=markup_amount,
        subtotal=subtotal_per_part,
        total=total,
        currency=process.currency,
        print_hours=print_hours,
        breakdown_lines=breakdown_lines,
    )
