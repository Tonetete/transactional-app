#!/usr/bin/env bash
# Sends a deposit to the local API.
# Usage: scripts/deposit.sh [idempotency_key] [amount_cents] [tenant] [user]
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${1:-idk_$(date +%s)}"
AMOUNT="${2:-5000000}"
TENANT="${3:-tnt_abc}"
USER_ID="${4:-usr_123}"
API="${API_URL:-http://localhost:3000}"

TOKEN="$(pnpm -s --filter @acex/api dev:token "$TENANT" "$USER_ID" | tail -n 1)"
BODY=$(printf '{"amount_cents":%s,"currency":"USD","source_account":{"holder_name":"Jane Doe","iban":"GB82WEST12345698765432"}}' "$AMOUNT")

echo ">> key=$KEY amount_cents=$AMOUNT tenant=$TENANT user=$USER_ID"
curl -sS -i -X POST "$API/v1/deposits" \
  -H "authorization: Bearer $TOKEN" \
  -H "idempotency-key: $KEY" \
  -H "x-correlation-id: corr-$KEY" \
  -H "content-type: application/json" \
  --data "$BODY"
echo
