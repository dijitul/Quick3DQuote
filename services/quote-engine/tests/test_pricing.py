"""Pricing-formula coverage.

The formula (CLAUDE.md §5) must be re-expressible from the test vectors
alone — if someone changes `pricing.calculate_price` these tests are
the spec. We check:

1. Formula for a representative FDM and SLA part.
2. `min_order` clamp applied on the aggregate (total), not per-part.
3. Markup as a fraction.
4. Quantity scaling.
5. Decimal arithmetic: no float drift.
6. Breakdown is present and self-consistent.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.pricing import calculate_price
from app.schemas import MaterialRef, ProcessRef


# ─────────────────────────── builders ─────────────────────────────
def _pla() -> MaterialRef:
    return MaterialRef(price_per_cm3=Decimal("0.10"), density_g_per_cm3=Decimal("1.24"))


def _resin() -> MaterialRef:
    return MaterialRef(price_per_cm3=Decimal("0.25"), density_g_per_cm3=Decimal("1.15"))


def _fdm(**overrides: object) -> ProcessRef:
    base: dict[str, object] = {
        "hourly_rate": Decimal("4.50"),
        "setup_fee": Decimal("3.00"),
        "min_order": Decimal("8.00"),
        "markup_pct": Decimal("0.20"),
        "throughput_cm3_per_hour": Decimal("12.0"),
        "currency": "GBP",
    }
    base.update(overrides)
    return ProcessRef(**base)  # type: ignore[arg-type]


def _sla(**overrides: object) -> ProcessRef:
    base: dict[str, object] = {
        "hourly_rate": Decimal("9.00"),
        "setup_fee": Decimal("5.00"),
        "min_order": Decimal("12.00"),
        "markup_pct": Decimal("0.30"),
        "throughput_cm3_per_hour": Decimal("18.0"),
        "currency": "GBP",
    }
    base.update(overrides)
    return ProcessRef(**base)  # type: ignore[arg-type]


# ─────────────────────────── formula checks ────────────────────────
def test_small_fdm_part_qty_1() -> None:
    # 10 cm³ PLA on FDM:
    # material = 10 * 0.10 = 1.00
    # hours    = 10 / 12   = 0.8333
    # machine  = 0.8333 * 4.50 = 3.75
    # setup    = 3.00
    # subtotal = 1.00 + 3.75 + 3.00 = 7.75
    # markup   = 7.75 * 0.20 = 1.55
    # unit     = 9.30
    # total    = max(8.00, 9.30) = 9.30
    r = calculate_price(
        volume_cm3=Decimal("10"),
        material=_pla(),
        process=_fdm(),
        quantity=1,
    )
    assert r.material_cost == Decimal("1.00")
    assert r.machine_cost == Decimal("3.75")
    assert r.setup_cost == Decimal("3.00")
    assert r.subtotal == Decimal("7.75")
    assert r.markup_amount == Decimal("1.55")
    assert r.unit_price == Decimal("9.30")
    assert r.total == Decimal("9.30")
    assert r.currency == "GBP"
    assert r.print_hours == Decimal("0.8333")


def test_large_sla_part() -> None:
    # 100 cm³ resin on SLA:
    # material = 100 * 0.25 = 25.00
    # hours    = 100/18 = 5.5556
    # machine  = 5.5556 * 9.00 = 50.00
    # setup    = 5.00
    # subtotal = 80.00
    # markup   = 80.00 * 0.30 = 24.00
    # unit     = 104.00
    # total qty 1 = 104.00
    r = calculate_price(
        volume_cm3=Decimal("100"),
        material=_resin(),
        process=_sla(),
        quantity=1,
    )
    assert r.material_cost == Decimal("25.00")
    assert r.print_hours == Decimal("5.5556")
    assert r.machine_cost == Decimal("50.00")
    assert r.subtotal == Decimal("80.00")
    assert r.markup_amount == Decimal("24.00")
    assert r.unit_price == Decimal("104.00")
    assert r.total == Decimal("104.00")


def test_min_order_clamps_total_not_unit() -> None:
    # Tiny part, qty 1. Unit price is well below min_order.
    # volume 1 cm³:
    # material = 0.10
    # hours    = 1/12 = 0.0833
    # machine  = 0.0833 * 4.50 = 0.37
    # setup    = 3.00
    # subtotal = 3.47
    # markup   = 3.47 * 0.20 = 0.69
    # unit     = 4.16
    # total_raw qty1 = 4.16 → clamp to min_order 8.00
    r = calculate_price(
        volume_cm3=Decimal("1"),
        material=_pla(),
        process=_fdm(),
        quantity=1,
    )
    assert r.unit_price == Decimal("4.16")
    assert r.total == Decimal("8.00")
    # The extra breakdown line must show the clamp reason.
    labels = [b.label for b in r.breakdown_lines]
    assert "Minimum order applied" in labels


def test_min_order_not_triggered_when_qty_pushes_past() -> None:
    # Same part, qty 5 → 5 * 4.16 = 20.80 > 8.00 → no clamp.
    r = calculate_price(
        volume_cm3=Decimal("1"),
        material=_pla(),
        process=_fdm(),
        quantity=5,
    )
    assert r.total == Decimal("20.80")
    labels = [b.label for b in r.breakdown_lines]
    assert "Minimum order applied" not in labels


def test_quantity_50_scales_linearly_before_clamp() -> None:
    r = calculate_price(
        volume_cm3=Decimal("10"),
        material=_pla(),
        process=_fdm(),
        quantity=50,
    )
    # unit_price = 9.30, total = 465.00
    assert r.unit_price == Decimal("9.30")
    assert r.total == Decimal("465.00")


def test_markup_zero_means_no_markup() -> None:
    r = calculate_price(
        volume_cm3=Decimal("10"),
        material=_pla(),
        process=_fdm(markup_pct=Decimal("0")),
        quantity=1,
    )
    assert r.markup_amount == Decimal("0.00")
    assert r.unit_price == r.subtotal


def test_no_float_drift_regression() -> None:
    # 0.1 + 0.2 on floats is the canonical failure. Use similar pathological inputs.
    r = calculate_price(
        volume_cm3=Decimal("0.1"),
        material=MaterialRef(price_per_cm3=Decimal("0.2"), density_g_per_cm3=Decimal("1")),
        process=_fdm(
            hourly_rate=Decimal("0"),
            setup_fee=Decimal("0"),
            min_order=Decimal("0"),
            markup_pct=Decimal("0"),
        ),
        quantity=1,
    )
    # 0.1 × 0.2 = 0.02 exactly — would be 0.020000000000004 in float.
    assert r.material_cost == Decimal("0.02")


def test_decimal_serialises_as_string_in_json() -> None:
    r = calculate_price(
        volume_cm3=Decimal("10"),
        material=_pla(),
        process=_fdm(),
        quantity=1,
    )
    as_json = r.model_dump_json()
    # unit_price is a Decimal; must appear as a quoted string, not a bare number.
    assert '"unit_price":"9.30"' in as_json


def test_breakdown_lines_sum_to_subtotal_per_part() -> None:
    r = calculate_price(
        volume_cm3=Decimal("25"),
        material=_pla(),
        process=_fdm(),
        quantity=1,
    )
    by_label = {b.label: b.amount for b in r.breakdown_lines}
    assert by_label["Material"] + by_label["Machine time"] + by_label["Setup"] == r.subtotal


def test_quantity_1000_upper_bound_via_schema() -> None:
    # Quantity above 1000 is a schema error, but the pricing function itself
    # doesn't enforce — it trusts validated input. We test at the pure level.
    r = calculate_price(
        volume_cm3=Decimal("10"),
        material=_pla(),
        process=_fdm(),
        quantity=1000,
    )
    assert r.total == Decimal("9300.00")


def test_currency_passes_through() -> None:
    r = calculate_price(
        volume_cm3=Decimal("10"),
        material=_pla(),
        process=_fdm(),
        quantity=1,
    )
    assert r.currency == "GBP"


def test_invalid_schema_inputs_raise() -> None:
    with pytest.raises(Exception):
        ProcessRef(
            hourly_rate=Decimal("-1"),  # negative → validation error
            setup_fee=Decimal("0"),
            min_order=Decimal("0"),
            markup_pct=Decimal("0"),
            throughput_cm3_per_hour=Decimal("12"),
            currency="GBP",
        )
    with pytest.raises(Exception):
        ProcessRef(
            hourly_rate=Decimal("0"),
            setup_fee=Decimal("0"),
            min_order=Decimal("0"),
            markup_pct=Decimal("0"),
            throughput_cm3_per_hour=Decimal("0"),  # must be > 0
            currency="GBP",
        )
