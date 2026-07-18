#!/usr/bin/env bash
# @file scripts/render-config.sh
# @description Render config.toml from config.toml.template, substituting secrets from
#   .env + secrets/aimeat.env. Also copies the aimeat-app-builder skill into the OpenHands
#   global skills dir (~/.openhands/skills). Run after aimeat-connect.sh, before docker up.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BUNDLE_DIR"

[ -f .env ] && set -a && . ./.env && set +a || { echo "ERROR: .env missing — copy .env.example to .env" >&2; exit 1; }
[ -f secrets/aimeat.env ] && set -a && . ./secrets/aimeat.env && set +a || \
  { echo "ERROR: secrets/aimeat.env missing — run scripts/aimeat-connect.sh first" >&2; exit 1; }

NODE_BASE_URL="${AIMEAT_BASE_URL:-https://aimeat.io}"; NODE_BASE_URL="${NODE_BASE_URL%/}"
AGENT_TOKEN="${AIMEAT_AGENT_TOKEN:?AIMEAT_AGENT_TOKEN not set (run aimeat-connect.sh)}"
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:?OPENROUTER_API_KEY not set in .env}"
LLM_MODEL="${LLM_MODEL:-openrouter/moonshotai/kimi-k2.7-code}"

# Substitute with a Python one-liner (safe with special chars in tokens/keys).
NODE_BASE_URL="$NODE_BASE_URL" AGENT_TOKEN="$AGENT_TOKEN" \
OPENROUTER_API_KEY="$OPENROUTER_API_KEY" LLM_MODEL="$LLM_MODEL" \
python3 - <<'PY'
import os
tpl = open("config.toml.template", encoding="utf-8").read()
for k in ("NODE_BASE_URL", "AGENT_TOKEN", "OPENROUTER_API_KEY", "LLM_MODEL"):
    tpl = tpl.replace("__%s__" % k, os.environ[k])
open("config.toml", "w", encoding="utf-8").write(tpl)
print("Wrote config.toml")
PY
chmod 600 config.toml

# Install the global always-available skill into the OpenHands home skills dir.
SKILLS_DIR="${HOME}/.openhands/skills"
mkdir -p "$SKILLS_DIR"
cp -r skills/aimeat-app-builder "$SKILLS_DIR/"
echo "Installed skill -> $SKILLS_DIR/aimeat-app-builder"
echo "Done. Next: docker compose up -d"
