#!/usr/bin/env bash
# E2E test runner — builds Docker container, runs tests, tears everything down.
# Usage:
#   bash test/docker/e2e-runner.sh [test-file]       # Run one test file
#   bash test/docker/e2e-runner.sh --all              # Run all E2E tests
#
# Run from the aimeat/ directory:
#   cd aimeat && bash test/docker/e2e-runner.sh test/e2e-mcp.ts
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.e2e.yml"
PROJECT="aimeat-e2e"
E2E_PORT="${E2E_PORT:-3200}"
E2E_NODE_ID="meat-e2e-001-test"
E2E_BASE="http://localhost:${E2E_PORT}"

cleanup() {
    echo ""
    echo "🧹 Tearing down containers..."
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT" down -v --remove-orphans 2>/dev/null || true
    # Prune dangling images from this build (conservative: only dangling)
    docker image prune -f 2>/dev/null || true
    echo "✅ Cleanup complete"
}
trap cleanup EXIT

echo "=== AIMEAT Docker E2E Test Runner ==="
echo "Port:    $E2E_PORT"
echo "Node ID: $E2E_NODE_ID"
echo ""

echo "🔨 Building and starting container..."
E2E_PORT="$E2E_PORT" docker compose -f "$COMPOSE_FILE" -p "$PROJECT" up -d --build --wait

echo "🏥 Container healthy — server ready at $E2E_BASE"
echo ""

OVERALL_EXIT=0

run_test() {
    local test_file="$1"
    echo "🧪 Running: $test_file"
    if E2E_BASE="$E2E_BASE" E2E_NODE_ID="$E2E_NODE_ID" npx tsx "$test_file"; then
        echo "   ✅ $test_file passed"
    else
        echo "   ❌ $test_file failed"
        OVERALL_EXIT=1
    fi
    echo ""
}

if [ "${1:-}" = "--all" ]; then
    for f in test/e2e-*.ts; do
        [ -f "$f" ] && run_test "$f"
    done
elif [ -n "${1:-}" ]; then
    run_test "$1"
else
    echo "Usage: $0 [test-file | --all]"
    exit 1
fi

exit "$OVERALL_EXIT"
