#!/usr/bin/env bash
# @file scripts/build-runtime.sh
# @description Build the AIMEAT agent-server RUNTIME image (runtime/Dockerfile) that bakes the
#   aimeat-app-builder skill into the container the OpenHands app spawns. The app loads user
#   skills from the RUNTIME's own ~/.openhands/skills — a separate container that does NOT see
#   the app host's ~/.openhands — so the skill must live in the runtime image. Idempotent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BUNDLE_DIR"

# Optional overrides from .env (base image, target repo/tag).
[ -f .env ] && set -a && . ./.env && set +a || true

BASE="${AGENT_SERVER_BASE_IMAGE:-ghcr.io/openhands/agent-server:1.26.0-python}"
REPO="${AGENT_SERVER_IMAGE_REPOSITORY:-aimeat/agent-server}"
TAG="${AGENT_SERVER_IMAGE_TAG:-1.26.0-python}"

echo "==> Pulling base runtime image: $BASE"
docker pull "$BASE"

echo "==> Building $REPO:$TAG (aimeat-app-builder skill baked in)"
docker build --build-arg BASE="$BASE" -f runtime/Dockerfile -t "$REPO:$TAG" .

echo "==> Built $REPO:$TAG — the app will use this local image as-is (no push needed)."
