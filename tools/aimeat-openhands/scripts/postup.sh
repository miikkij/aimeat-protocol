#!/usr/bin/env bash
# @file scripts/postup.sh
# @description Post-`docker compose up` steps that need the running UI:
#   1) Install the aimeat-app-builder skill into the user microagents dir so it appears in
#      the UI's Skills tab (Path.home() / .openhands / microagents inside the container →
#      $HOME/.openhands/microagents on the host, per docker-compose.yml).
#   2) POST the LLM settings (agent_settings_diff) and create+activate a named GUI profile
#      so the Settings > LLM > Profiles page is preconfigured on first open. Without this,
#      env vars only reach the CLI/core code path and the GUI comes up unconfigured.
#   3) POST the aimeat MCP-server config (uses the RemoteMCPServer `auth` field, which is
#      what OpenHands SDK expects for a raw Bearer token — NOT `headers.Authorization`).
#      Requires secrets/aimeat.env to exist (created by scripts/aimeat-connect.sh).
# Idempotent. Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BUNDLE_DIR"

[ -f .env ] && set -a && . ./.env && set +a || { echo "ERROR: .env missing" >&2; exit 1; }

: "${OPENROUTER_API_KEY:?set OPENROUTER_API_KEY in .env}"
LLM_MODEL="${LLM_MODEL:-openrouter/moonshotai/kimi-k2.7-code}"
LLM_BASE_URL="${LLM_BASE_URL:-https://openrouter.ai/api/v1}"
PROFILE_NAME="${OPENHANDS_LLM_PROFILE:-openrouter-kimi-k27}"

# Derive the UI base URL from OPENHANDS_PORT_BIND (defaults to 3000 on all interfaces).
PORT_BIND="${OPENHANDS_PORT_BIND:-3000}"
case "$PORT_BIND" in
    *:*) UI_BASE="http://${PORT_BIND}" ;;
    *)   UI_BASE="http://127.0.0.1:${PORT_BIND}" ;;
esac

# ── 1) Install user microagent (skill) so the GUI Skills tab lists it ─────
# Uses the container's own mkdir/rsync to sidestep the host-perm problem: the docker
# volume `${HOME}/.openhands:/root/.openhands` is created by dockerd as root, so the
# host-side dir is often un-writable by our user. The app container IS root and always
# can, so we do the install through it. Idempotent.
HOST_MICROAGENTS="${HOME}/.openhands/microagents"
SRC_SKILL="$BUNDLE_DIR/skills/aimeat-app-builder"

if [ -d "$SRC_SKILL" ]; then
    if docker ps --format '{{.Names}}' | grep -qx aimeat-openhands; then
        # tar-pipe is properly idempotent: it recreates the target dir and refreshes files
        # in place, unlike `docker cp` which fails ("file exists") if the target dir already
        # exists. The container is root so writes into /root/.openhands succeed.
        docker exec aimeat-openhands sh -c '
            mkdir -p /root/.openhands/microagents/aimeat-app-builder &&
            rm -rf /root/.openhands/microagents/aimeat-app-builder/*
        '
        tar -C "$SRC_SKILL" -cf - . \
            | docker exec -i aimeat-openhands tar -C /root/.openhands/microagents/aimeat-app-builder -xf -
        echo "Installed user microagent via container: $HOST_MICROAGENTS/aimeat-app-builder"
    else
        echo "WARNING: aimeat-openhands container not running — cannot install skill; run 'docker compose up -d' first" >&2
    fi
else
    echo "WARNING: skill source $SRC_SKILL missing — skipping user microagent install" >&2
fi

# ── 2) Preconfigure the GUI LLM (settings + named profile) ────────────────
# Wait for the UI to accept requests (fresh compose up needs a few seconds).
echo -n "Waiting for OpenHands UI at $UI_BASE "
for _ in $(seq 1 30); do
    if curl -sf -o /dev/null -m 2 "$UI_BASE/api/v1/settings"; then
        echo " ready"
        break
    fi
    echo -n "."
    sleep 2
done

# POST settings — deep-merged into agent_settings.llm (OpenHands 1.8 requires the *_diff key).
SETTINGS_BODY=$(
    LLM_MODEL="$LLM_MODEL" \
    OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
    LLM_BASE_URL="$LLM_BASE_URL" \
    python3 - <<'PY'
import json, os
print(json.dumps({
    "agent_settings_diff": {
        "llm": {
            "model": os.environ["LLM_MODEL"],
            "api_key": os.environ["OPENROUTER_API_KEY"],
            "base_url": os.environ["LLM_BASE_URL"],
            "temperature": 0.0,
        }
    }
}))
PY
)
curl -sf -X POST "$UI_BASE/api/v1/settings" \
    -H 'Content-Type: application/json' \
    -d "$SETTINGS_BODY" > /dev/null
echo "Saved settings (agent_settings.llm)."

# Save profile from current settings (include_secrets=true copies the api_key too).
curl -sf -X POST "$UI_BASE/api/v1/settings/profiles/$PROFILE_NAME" \
    -H 'Content-Type: application/json' \
    -d '{"include_secrets": true}' > /dev/null
echo "Saved profile '$PROFILE_NAME'."

# Activate it. The response body contains the active model — use that to verify.
ACTIVATE_RESP=$(curl -sf -X POST "$UI_BASE/api/v1/settings/profiles/$PROFILE_NAME/activate")
ACTIVE_MODEL=$(python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('model', ''))" <<< "$ACTIVATE_RESP")
if [ "$ACTIVE_MODEL" = "$LLM_MODEL" ]; then
    echo "Activated profile '$PROFILE_NAME' (model=$ACTIVE_MODEL)."
else
    echo "WARNING: profile activation returned model='$ACTIVE_MODEL' (expected '$LLM_MODEL')" >&2
fi

# ── 3) Preconfigure the aimeat MCP server ─────────────────────────────────
# Activating a profile REPLACES agent_settings with the profile's contents; profiles don't
# save mcp_config today, so we always POST the MCP config AFTER activation. The Bearer token
# goes in the `auth` field (RemoteMCPServer schema), not `headers.Authorization` — putting it
# in headers means the OpenHands SDK doesn't recognise it, tool-listing hangs 30s, and the UI's
# "API Key" field shows blank.
if [ -f secrets/aimeat.env ]; then
    # shellcheck disable=SC1091
    set -a && . ./secrets/aimeat.env && set +a
    if [ -n "${AIMEAT_AGENT_TOKEN:-}" ]; then
        MCP_URL="${AIMEAT_BASE_URL:-https://aimeat.io}/v2/mcp/appdev"
        MCP_BODY=$(
            AIMEAT_AGENT_TOKEN="$AIMEAT_AGENT_TOKEN" \
            MCP_URL="$MCP_URL" \
            python3 - <<'PY'
import json, os
print(json.dumps({
    "agent_settings_diff": {
        "mcp_config": {
            "mcpServers": {
                "aimeat": {
                    "url": os.environ["MCP_URL"],
                    "auth": os.environ["AIMEAT_AGENT_TOKEN"],
                }
            }
        }
    }
}))
PY
        )
        curl -sf -X POST "$UI_BASE/api/v1/settings" \
            -H 'Content-Type: application/json' \
            -d "$MCP_BODY" > /dev/null
        echo "Configured MCP server 'aimeat' (auth via RemoteMCPServer.auth)."
    else
        echo "WARNING: secrets/aimeat.env has no AIMEAT_AGENT_TOKEN — skipping MCP config" >&2
    fi
else
    echo "WARNING: secrets/aimeat.env missing — skipping MCP config (run scripts/aimeat-connect.sh first)" >&2
fi
