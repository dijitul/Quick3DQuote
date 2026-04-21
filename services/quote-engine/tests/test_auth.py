from __future__ import annotations

from fastapi.testclient import TestClient


def _price_body() -> dict[str, object]:
    return {
        "volume_cm3": "10.0",
        "quantity": 1,
        "material": {"price_per_cm3": "0.10", "density_g_per_cm3": "1.24"},
        "process": {
            "hourly_rate": "4.50",
            "setup_fee": "3.00",
            "min_order": "8.00",
            "markup_pct": "0.20",
            "throughput_cm3_per_hour": "12.0",
            "currency": "GBP",
        },
    }


def test_price_rejects_missing_key(client: TestClient) -> None:
    resp = client.post("/price", json=_price_body())
    assert resp.status_code == 401


def test_price_rejects_wrong_key(client: TestClient) -> None:
    resp = client.post("/price", json=_price_body(), headers={"X-Internal-Key": "nope"})
    assert resp.status_code == 401


def test_price_accepts_correct_key(client: TestClient, auth_headers: dict[str, str]) -> None:
    resp = client.post("/price", json=_price_body(), headers=auth_headers)
    assert resp.status_code == 200, resp.text


def test_analyze_rejects_missing_key(client: TestClient) -> None:
    resp = client.post("/analyze-mesh", json={"r2_key": "a/b/c"})
    assert resp.status_code == 401


def test_auth_timing_safe_compare_does_not_raise_on_short_key(
    client: TestClient,
) -> None:
    # A single char header should still fail cleanly (no traceback) and return 401.
    resp = client.post(
        "/price",
        json=_price_body(),
        headers={"X-Internal-Key": "a"},
    )
    assert resp.status_code == 401
