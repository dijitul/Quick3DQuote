#!/usr/bin/env bash
#
# Smoke test — hit /health and /price against a running engine.
# Usage:
#   PORT=8080 INTERNAL_KEY=dev-... bash scripts/smoke.sh
#   bash scripts/smoke.sh http://engine.quick3dquote.internal
#
# Exits non-zero on any HTTP error.

set -euo pipefail

HOST="${1:-http://localhost:${PORT:-8080}}"
INTERNAL_KEY="${INTERNAL_KEY:-dev-shared-secret-change-me}"

echo "==> target: ${HOST}"
echo

echo "==> GET /health"
curl --fail --show-error --silent \
  -H "X-Request-Id: smoke-$(date +%s)" \
  "${HOST}/health" \
  | python -m json.tool
echo

echo "==> POST /price (10cm³ PLA on FDM, qty 3)"
read -r -d '' PRICE_BODY <<'JSON' || true
{
  "volume_cm3": "10.0",
  "quantity": 3,
  "material": {
    "price_per_cm3": "0.10",
    "density_g_per_cm3": "1.24"
  },
  "process": {
    "hourly_rate": "4.50",
    "setup_fee": "3.00",
    "min_order": "8.00",
    "markup_pct": "0.20",
    "throughput_cm3_per_hour": "12.0",
    "currency": "GBP"
  }
}
JSON

curl --fail --show-error --silent \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: ${INTERNAL_KEY}" \
  -H "X-Request-Id: smoke-$(date +%s)" \
  -d "${PRICE_BODY}" \
  "${HOST}/price" \
  | python -m json.tool

echo
echo "==> smoke OK"
