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
#         AIMEAT_SECRETS_FILE (default ./secrets/aimeat.env),
#         AIMEAT_KEY_FILE (default <secrets dir>/<agent>@<owner>.key)
# @version-history
#   2026-10-27 -- The device-authorize and device-token bodies (the return proof, the device_code) go
#     to curl on stdin, not as arguments (secaudit2026oct26, secrets-on-curl-argv).
#   2026-10-26 — Keeps the agent's private key of each approval beside the token (0600) and signs a
#     reconnect's device request with it (`proof`), so the owner sees the agent coming back and not a
#     takeover (secaudit2026oct22, unbound-reapproval-of-existing-agent). The default scope "*" is no
#     longer glob-expanded into file names, and a python3 that does not run (the Windows Store alias)
#     falls through to jq or node.
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

# JSON helper — prefer python3 (ubiquitous in the OpenHands image), fall back to jq, then node.
# python3 is run once rather than only looked up: on Windows the Store alias answers
# `command -v python3` and then exits 49 without running anything.
json() { # json <field>  (reads JSON on stdin, prints .field, empty if absent)
  local field="$1"
  if python3 -c '' >/dev/null 2>&1; then
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
  elif command -v node >/dev/null 2>&1; then
    node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{let d;try{d=JSON.parse(s)}catch{return}
if(d&&typeof d==="object"&&d.data&&typeof d.data==="object")d=d.data;
const v=d&&typeof d==="object"?d[process.argv[1]]:undefined;process.stdout.write(v==null?"":String(v)+"\n")})' "$field"
  else
    echo "ERROR: need python3, jq or node to parse JSON." >&2; exit 1
  fi
}

# Convert space-separated scopes to a JSON array. `read -a` splits without glob expansion: an
# unquoted `for s in $SCOPES` turned the default "*" into the names of the files in the directory.
scopes_json() {
  local out="" s list
  read -r -a list <<< "$SCOPES"
  for s in "${list[@]}"; do out="$out\"$s\","; done
  echo "[${out%,}]"
}

# The agent's private key from its last approval, kept beside the token at 0600. A reconnect signs
# its device request with it, so the owner sees this agent coming back rather than a new device
# taking it over (aimeat/src/services/device-return-proof.ts). Signing needs openssl 3 with Ed25519;
# without it, or without a key, the request goes without proof and the owner sees the takeover
# screen, as before. No stored token is ever sent with the device request: the node refuses a dead one.
KEY_FILE="${AIMEAT_KEY_FILE:-$(dirname "$SECRETS_FILE")/${AGENT_NAME}@${OWNER}.key}"

return_proof_json() { # prints ,"proof":{...} or nothing
  [ -s "$KEY_FILE" ] || return 0
  command -v openssl >/dev/null 2>&1 || return 0
  local dir signed_at sig
  dir="$(mktemp -d)" || return 0
  ( umask 077
    # PKCS#8 DER prefix for a raw 32-byte Ed25519 seed, then the seed itself.
    { printf '\x30\x2e\x02\x01\x00\x30\x05\x06\x03\x2b\x65\x70\x04\x22\x04\x20'; base64 -d < "$KEY_FILE"; } > "$dir/key.der" ) 2>/dev/null
  signed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'aimeat-device-return:v1\n%s\n%s\n%s' "$OWNER" "$AGENT_NAME" "$signed_at" > "$dir/msg"
  if openssl pkeyutl -sign -rawin -keyform DER -inkey "$dir/key.der" -in "$dir/msg" -out "$dir/sig" >/dev/null 2>&1; then
    sig="$(base64 < "$dir/sig" | tr -d '\r\n')"
    printf ',"proof":{"signed_at":"%s","signature":"%s"}' "$signed_at" "$sig"
  else
    echo "WARNING: could not sign with $KEY_FILE; connecting without proof that this is the same agent." >&2
  fi
  rm -rf "$dir"
}

# Request bodies that carry a secret (the return proof, the device_code) go to curl on stdin:
# printf is a bash builtin, so the body never appears in a process's arguments, which every local
# account can read.
echo "==> Requesting device authorization for ${AGENT_NAME}#${OWNER} @ ${BASE_URL}"
AUTHZ="$(printf '%s' "{\"owner\":\"$OWNER\",\"agent_name\":\"$AGENT_NAME\",\"display_name\":\"OpenHands\",\"description\":\"AIMEAT-boosted OpenHands app builder\",\"scopes\":$(scopes_json)$(return_proof_json)}" \
  | curl -s -X POST "$BASE_URL/v1/agents/device-authorize" \
  -H "Content-Type: application/json" \
  --data-binary @-)"

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
  RESP="$(printf '%s' "{\"device_code\":\"$DEVICE_CODE\",\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\"}" \
    | curl -s -X POST "$BASE_URL/v1/agents/device-token" \
    -H "Content-Type: application/json" \
    --data-binary @-)"
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
PRIVATE_KEY="$(printf '%s' "$RESP" | json privateKey)"

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
# The key of this approval, in its own file so the env file sourced by render-config.sh and
# postup.sh never carries it.
if [ -n "$PRIVATE_KEY" ]; then
  mkdir -p "$(dirname "$KEY_FILE")"
  printf '%s\n' "$PRIVATE_KEY" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi

echo
echo "==> Connected as: $GAII"
echo "==> Token expires: ${EXPIRES:-(see node)}"
echo "==> Wrote credentials to: $SECRETS_FILE"
echo "==> Restart OpenHands (docker compose up -d) so the MCP server picks up the token."
