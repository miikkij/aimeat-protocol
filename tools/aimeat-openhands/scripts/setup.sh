#!/usr/bin/env bash
# @file scripts/setup.sh
# @description One-shot bootstrap for the AIMEAT-boosted OpenHands. Idempotent — safe to re-run.
#   1) ensure .env exists  2) connect to AIMEAT (device auth)  3) render config + install skill
#   4) bring the stack up  5) post-up: install user microagent + preconfigure GUI LLM profile.
#   After this, OpenHands is permanently wired to AIMEAT.
# @version-history
#   2026-10-27 -- Warns when the UI is published on every network interface, and names the SSH
#     tunnel when it is not (secaudit2026oct26, ui-published-all-interfaces-default).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BUNDLE_DIR"

echo "== AIMEAT-boosted OpenHands setup =="

# 1) .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
  echo ">> Edit .env now: set OPENROUTER_API_KEY and AIMEAT_OWNER, then re-run setup.sh."
  exit 0
fi
set -a && . ./.env && set +a
: "${OPENROUTER_API_KEY:?set OPENROUTER_API_KEY in .env}"

# The UI has no login, can run code on this host and holds the agent token. Say so when it is
# published on every network interface (no OPENHANDS_PORT_BIND, or a bind that is not loopback).
case "${OPENHANDS_PORT_BIND:-}" in
  127.0.0.1:*|localhost:*|"[::1]:"*) UI_ON_NETWORK=0 ;;
  *) UI_ON_NETWORK=1 ;;
esac
if [ "$UI_ON_NETWORK" = 1 ]; then
  echo "WARNING: the OpenHands UI will listen on every network interface (OPENHANDS_PORT_BIND=${OPENHANDS_PORT_BIND:-3000})." >&2
  echo "         It has no login, it can run code on this host, and it holds your AIMEAT agent token." >&2
  echo "         Anyone who can reach this port can use it. To keep it on this computer only, add" >&2
  echo "         OPENHANDS_PORT_BIND=127.0.0.1:3000 to .env and re-run setup.sh." >&2
fi

# 2) connect (skip if a valid-looking token already present)
if [ ! -f secrets/aimeat.env ]; then
  echo "== Connecting to AIMEAT (device authorization) =="
  bash scripts/aimeat-connect.sh
else
  echo "Existing secrets/aimeat.env found — skipping connect (delete it to re-connect)."
fi

# 3) render config (MCP + LLM + pruning)
echo "== Rendering config =="
bash scripts/render-config.sh

# 3b) build the runtime image that bakes the skill into the spawned agent-server container.
# The app loads user skills from the RUNTIME's own ~/.openhands/skills (a separate container
# that does NOT see this host's ~/.openhands mount), so the skill must live in the runtime
# image. See runtime/Dockerfile.
echo "== Building AIMEAT agent-server runtime image (skill baked in) =="
bash scripts/build-runtime.sh

# 4) up
echo "== Starting OpenHands =="
docker compose up -d

# 5) post-up: install user microagent so the GUI Skills tab lists aimeat-app-builder, and
# preconfigure the LLM (settings + named profile) so Settings > LLM is not blank on first open.
echo "== Post-up configuration =="
bash scripts/postup.sh

echo
if [ "$UI_ON_NETWORK" = 1 ]; then
  echo "Open http://localhost:3000  (or http://<this-host-ip>:3000 from another machine; see the warning above)."
else
  echo "Open http://localhost:3000  (from another machine: ssh -L 3000:localhost:3000 <user>@<this-host>)."
fi
echo "Ask it: \"Build an AIMEAT app that ...\" and it will fetch the spec, build, and publish."
