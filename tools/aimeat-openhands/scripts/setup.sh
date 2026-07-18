#!/usr/bin/env bash
# @file scripts/setup.sh
# @description One-shot bootstrap for the AIMEAT-boosted OpenHands. Idempotent — safe to re-run.
#   1) ensure .env exists  2) connect to AIMEAT (device auth)  3) render config + install skill
#   4) bring the stack up. After this, OpenHands is permanently wired to AIMEAT.
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

# 2) connect (skip if a valid-looking token already present)
if [ ! -f secrets/aimeat.env ]; then
  echo "== Connecting to AIMEAT (device authorization) =="
  bash scripts/aimeat-connect.sh
else
  echo "Existing secrets/aimeat.env found — skipping connect (delete it to re-connect)."
fi

# 3) render config + install skill
echo "== Rendering config + installing skill =="
bash scripts/render-config.sh

# 4) up
echo "== Starting OpenHands =="
docker compose up -d
echo
echo "Open http://localhost:3000  (or http://<this-host-ip>:3000 from another machine)."
echo "Ask it: \"Build an AIMEAT app that ...\" and it will fetch the spec, build, and publish."
