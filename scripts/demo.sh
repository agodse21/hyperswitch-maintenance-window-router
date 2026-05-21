#!/usr/bin/env bash
# demo.sh — End-to-end demo for the maintenance-window routing sidecar.
#
# Architecture
# ────────────
#   curl → routing-service :3000 → hyperswitch-server :8080
#
# What this does
# ──────────────
# 1. Computes a 10-minute UTC window covering "now" and writes it to
#    routing-service/config/windows.json as stripe's maintenance window.
#    This guarantees the filter fires during the demo run.
# 2. Starts the routing-service locally (Node.js / tsx).
# 3. Sends a test payment and shows the routing_decision log lines.
# 4. Fetches the trace from GET /routing-trace/:payment_id (bonus API).
#
# Prerequisites: node, curl, jq

set -euo pipefail

ROUTING_SVC="http://localhost:3000"

# ── 1. Patch maintenance window to cover NOW ──────────────────────────────────
NOW_UTC_MINS=$(( $(date -u +%s) / 60 % 1440 ))
WIN_START=$(( (NOW_UTC_MINS - 1 + 1440) % 1440 ))
WIN_END=$(( (NOW_UTC_MINS + 11) % 1440 ))
printf -v WIN_START_S "%02d:%02d" $(( WIN_START / 60 )) $(( WIN_START % 60 ))
printf -v WIN_END_S   "%02d:%02d" $(( WIN_END / 60 ))   $(( WIN_END % 60 ))

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

cat > "$REPO_ROOT/routing-service/config/windows.json" << JSON
{
  "routingOrder": ["stripe", "adyen"],
  "maintenanceWindows": {
    "stripe": [{ "start": "${WIN_START_S}", "end": "${WIN_END_S}" }],
    "adyen":  []
  }
}
JSON

echo ""
echo "═══════════════════════════════════════════════════"
echo " Maintenance-Window Routing Demo (TypeScript)"
echo "═══════════════════════════════════════════════════"
echo " Stripe window (UTC): ${WIN_START_S} – ${WIN_END_S}"
echo " Current UTC time:    $(date -u +%H:%M) (${NOW_UTC_MINS} mins)"
echo ""

# ── 2. Start routing-service ──────────────────────────────────────────────────
echo "▶ Starting routing-service..."
cd "$REPO_ROOT/routing-service"
npm install --silent
NODE_ENV='' npm run dev > /tmp/routing-svc-demo.log 2>&1 &
ROUTING_PID=$!
cd "$REPO_ROOT"

# ── 3. Wait for health ────────────────────────────────────────────────────────
echo "⏳ Waiting for routing-service to be ready..."
for i in $(seq 1 15); do
  if curl -sf "${ROUTING_SVC}/health" > /dev/null 2>&1; then
    echo "✓ routing-service healthy"
    break
  fi
  [[ $i -eq 15 ]] && { echo "✗ routing-service not ready."; kill "$ROUTING_PID" 2>/dev/null; exit 1; }
  sleep 1
done

# ── 4. Send payment via routing-service ──────────────────────────────────────
echo ""
echo "▶ Sending payment via routing-service (port 3000)..."
PAYMENT=$(curl -s -X POST "${ROUTING_SVC}/payments" \
  -H "api-key: test_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "currency": "USD",
    "confirm": true,
    "capture_method": "automatic",
    "payment_id": "demo_pay_001",
    "payment_method": "card",
    "payment_method_data": {
      "card": {
        "card_number": "4242424242424242",
        "card_exp_month": "12",
        "card_exp_year": "2030",
        "card_holder_name": "John Demo",
        "card_cvc": "123"
      }
    }
  }')

PAYMENT_ID=$(echo "$PAYMENT" | jq -r '.payment_id // "demo_pay_001"' 2>/dev/null || echo "demo_pay_001")
CHOSEN=$(echo "$PAYMENT"     | jq -r '.routing_decision.chosen // "unknown"' 2>/dev/null || echo "unknown")
SKIPPED=$(echo "$PAYMENT"    | jq -r '[.routing_decision.skipped[]?.connector] | join(", ")' 2>/dev/null || echo "")
echo "  chosen connector : ${CHOSEN}"
echo "  skipped          : ${SKIPPED:-none}"

# ── 5. Show routing_decision log lines ───────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo " routing_decision log lines (from routing-service):"
echo "═══════════════════════════════════════════════════"
grep "routing_decision" /tmp/routing-svc-demo.log 2>/dev/null | tail -10 || echo "  (none yet)"

# ── 6. Routing trace API (bonus) ──────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo " GET /routing-trace/${PAYMENT_ID}:"
echo "═══════════════════════════════════════════════════"
curl -sf "${ROUTING_SVC}/routing-trace/${PAYMENT_ID}" 2>/dev/null | jq . \
  || echo "(trace not found — see log lines above)"

# ── Cleanup ───────────────────────────────────────────────────────────────────
kill "$ROUTING_PID" 2>/dev/null || true

# Restore windows.json to empty so dev startup is a clean slate
cat > "$REPO_ROOT/routing-service/config/windows.json" << 'JSON'
{"routingOrder":["stripe","adyen"],"maintenanceWindows":{"stripe":[],"adyen":[]}}
JSON

echo ""
echo "═══════════════════════════════════════════════════"
echo " Demo complete."
echo " Expected: stripe SKIPPED (in maintenance), adyen CHOSEN."
echo " To run the service interactively: make dev"
echo " To run tests:                     make test-routing"
echo "═══════════════════════════════════════════════════"
