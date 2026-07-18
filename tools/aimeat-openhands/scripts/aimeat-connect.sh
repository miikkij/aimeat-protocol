#!/usr/bin/env bash
# @file scripts/aimeat-connect.sh
# @description One-shot AIMEAT connect for the AIMEAT-boosted OpenHands. Runs the RFC 8628
#   device-authorization flow against an AIMEAT node, waits for the owner to approve the agent
#   in their profile, captures the long-lived agent bearer token, and writes it where the
#   preconfigured MCP server expects it (secrets env file). No manual token fiddling.
# @usage  ./aimeat-connect.sh            # interactive; uses .env / prompts for owner
#         AIMEAT_OWNER=alice ./aimeat-connect.sh
# @env    AIMEAT_BASE_URL (default https://aimeat.io), AIMEAT_OWNER (required),
#         AIMEAT_AGENT_NAME (default openhands), AIMEAT_SCOPES (default "*"),
#         AIMEAT_SECRETS_FILE (default ./secrets/aimeat.env)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load bundle .env if present (non-fatal).
[ -f "$BUNDLE_DIR/.env" ] && set -a && . "$BUNDLE_DIR/.env" && set +a || true

BASE_URL="${AIMEAT_BASE_URL:-https://aimeat.io}"
BASE_URL="${BASE_URL%/}"
AGENT_NAME="${AIMEAT_AGENT_NAME:-openhands}"
SCOPES="${AIMEAT_SCOPES:-*}"
SECRETS_FILE="${AIMEAT_SECRETS_FILE:-$BUNDLE_DIR/secrets/aimeat.env}"

# Owner is required — prompt if not provided.
OWNER="${AIMEAT_OWNER:-}"
if [ -z "$OWNER" ]; then
  read -r -p "AIMEAT owner name (your username on $BASE_URL): " OWNER
fi
[ -n "$OWNER" ] || { echo "ERROR: owner is required." >&2; exit 1; }

# JSON helper — prefer python3 (ubiquitous in the OpenHands image), fall back to jq.
json() { # json <field>  (reads JSON on stdin, prints .field, empty if absent)
  local field="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(0)
# unwrap AIMEAT success envelope { "data": {...} } if present
d=d.get("data",d) if isinstance(d,dict) else d
v=d.get(sys.argv[1]) if isinstance(d,dict) else None
print(v if v is not None else "")' "$field"
  elif command -v jq >/dev/null 2>&1; then
    jq -r --arg f "$field" '(.data // .) | .[$f] // empty'
  else
    echo "ERROR: need python3 or jq to parse JSON." >&2; exit 1
  fi
}

# Convert space-separated scopes to a JSON array.
scopes_json() {
  local out="" s
  for s in $SCOPES; do out="$out\"$s\","; done
  echo "[${out%,}]"
}

echo "==> Requesting device authorization for ${AGENT_NAME}#${OWNER} @ ${BASE_URL}"
AUTHZ="$(curl -s -X POST "$BASE_URL/v1/agents/device-authorize" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"agent_name\":\"$AGENT_NAME\",\"display_name\":\"OpenHands\",\"description\":\"AIMEAT-boosted OpenHands app builder\",\"scopes\":$(scopes_json)}")"

DEVICE_CODE="$(printf '%s' "$AUTHZ" | json device_code)"
USER_CODE="$(printf '%s' "$AUTHZ" | json user_code)"
VERIFY_URL="$(printf '%s' "$AUTHZ" | json verification_uri_complete)"
STATUS="$(printf '%s' "$AUTHZ" | json status)"

if [ -z "$DEVICE_CODE" ]; then
  echo "ERROR: device-authorize failed. Node said:" >&2
  printf '%s\n' "$AUTHZ" >&2
  exit 1
fi

if [ "$STATUS" != "approved" ]; then
  echo
  echo "  ┌────────────────────────────────────────────────────────────┐"
  echo "  │  APPROVE THIS AGENT IN YOUR BROWSER                         │"
  echo "  ├────────────────────────────────────────────────────────────┤"
  echo "  │  1. Open:   $VERIFY_URL"
  echo "  │     (or go to $BASE_URL/v1/profile → Agents tab)"
  echo "  │  2. Verification code:  $USER_CODE"
  echo "  │  3. Approve — grant the scopes you want the builder to have."
  echo "  └────────────────────────────────────────────────────────────┘"
  echo
  echo "==> Waiting for approval (polling every 5s, Ctrl-C to abort)…"
fi

TOKEN=""
for _ in $(seq 1 360); do   # up to ~30 min (device auth TTL)
  RESP="$(curl -s -X POST "$BASE_URL/v1/agents/device-token" \
    -H "Content-Type: application/json" \
    -d "{\"device_code\":\"$DEVICE_CODE\",\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\"}")"
  TOKEN="$(printf '%s' "$RESP" | json access_token)"
  if [ -n "$TOKEN" ]; then break; fi
  ERR="$(printf '%s' "$RESP" | json error)"
  case "$ERR" in
    authorization_pending|slow_down|"") sleep 5 ;;
    access_denied) echo "ERROR: the owner denied this request." >&2; exit 1 ;;
    expired_token) echo "ERROR: the request expired before approval." >&2; exit 1 ;;
    *) echo "ERROR: $ERR" >&2; printf '%s\n' "$RESP" >&2; exit 1 ;;
  esac
done

[ -n "$TOKEN" ] || { echo "ERROR: timed out waiting for approval." >&2; exit 1; }

GAII="$(printf '%s' "$RESP" | json gaii)"
EXPIRES="$(printf '%s' "$RESP" | json expires_at)"

mkdir -p "$(dirname "$SECRETS_FILE")"
umask 077
cat > "$SECRETS_FILE" <<EOF
# AIMEAT agent credentials for the boosted OpenHands MCP server.
# Written by aimeat-connect.sh — do not commit. Re-run the script to refresh.
AIMEAT_BASE_URL=$BASE_URL
AIMEAT_GAII=$GAII
AIMEAT_AGENT_TOKEN=$TOKEN
AIMEAT_TOKEN_EXPIRES_AT=$EXPIRES
EOF
chmod 600 "$SECRETS_FILE"

echo
echo "==> Connected as: $GAII"
echo "==> Token expires: ${EXPIRES:-(see node)}"
echo "==> Wrote credentials to: $SECRETS_FILE"
echo "==> Restart OpenHands (docker compose up -d) so the MCP server picks up the token."
