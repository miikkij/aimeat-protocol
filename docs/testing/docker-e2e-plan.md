# Docker-Based E2E Testing Infrastructure

## Motivation

Current E2E tests run against a manually started `pnpm dev` server with in-memory storage. This has several limitations:

- Tests cannot run in CI without manual server startup
- In-memory storage doesn't test the real MongoDB path
- Rate limits / stale state from previous runs cause flaky tests
- No isolation between test suites
- Single-node only — no multi-node federation testing

## Architecture

```
test/
  docker/
    docker-compose.e2e.yml    # Compose file for E2E test environment
    e2e-runner.sh             # Orchestrator: build → up → test → down
  e2e-full.ts                 # Existing tests (updated to use E2E_BASE)
  e2e-federation.ts           # T-1 tests (updated to use E2E_BASE)
  e2e-mcp.ts                  # T-2 tests
  ...
```

### Container Setup

```yaml
# docker-compose.e2e.yml
services:
  aimeat-e2e:
    build:
      context: ../..         # aimeat/ root
      dockerfile: Dockerfile
    ports:
      - "${E2E_PORT:-3200}:3200"
    environment:
      AIMEAT_PORT: 3200
      AIMEAT_NODE_ID: aimeat-e2e-001-test
      AIMEAT_ADMIN_PASSWORD: e2e-test-password
      AIMEAT_WELCOME_BONUS: 100
      AIMEAT_DAILY_ALLOWANCE: 50
      AIMEAT_BURN_RATE: "0.10"
      AIMEAT_RATE_LIMIT_MAX: 1000        # High limit for testing
      AIMEAT_RATE_LIMIT_WINDOW_MS: 60000
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3200/.well-known/aimeat"]
      interval: 2s
      timeout: 5s
      retries: 15
    tmpfs:
      - /tmp
```

- **Port 3200** — avoids collision with dev (:40151) and production
- **In-memory storage** — no MongoDB needed for initial tests; DATABASE_URL omitted
- **High rate limit** — 1000 req/60s to prevent rate-limit flakiness
- **tmpfs** — nothing persisted to disk

### Runner Script

`test/docker/e2e-runner.sh` orchestrates the lifecycle:

```bash
#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="test/docker/docker-compose.e2e.yml"
PROJECT="aimeat-e2e"
TEST_FILE="${1:-test/e2e-full.ts}"

cleanup() {
  echo "🧹 Tearing down..."
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT" down -v --remove-orphans 2>/dev/null || true
  docker image prune -f --filter "label=project=$PROJECT" 2>/dev/null || true
}
trap cleanup EXIT

echo "🔨 Building and starting containers..."
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" up -d --build --wait

echo "🧪 Running tests: $TEST_FILE"
E2E_BASE="http://localhost:3200" \
E2E_NODE_ID="aimeat-e2e-001-test" \
npx tsx "$TEST_FILE"

echo "✅ Tests complete"
```

### Test File Changes

All E2E test files read the base URL and node ID from environment variables:

```typescript
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
```

This allows the same test files to run against:
- A Docker E2E container (`E2E_BASE=http://localhost:3200`)
- A local dev server (`pnpm dev` on :40151, no env vars needed)

### package.json Scripts

```json
{
  "test:e2e": "tsx test/e2e-full.ts",
  "test:e2e:docker": "bash -c 'cd aimeat && bash test/docker/e2e-runner.sh test/e2e-full.ts'",
  "test:e2e:federation": "tsx test/e2e-federation.ts",
  "test:e2e:federation:docker": "bash -c 'cd aimeat && bash test/docker/e2e-runner.sh test/e2e-federation.ts'",
  "test:e2e:mcp": "tsx test/e2e-mcp.ts",
  "test:e2e:mcp:docker": "bash -c 'cd aimeat && bash test/docker/e2e-runner.sh test/e2e-mcp.ts'",
  "test:e2e:all:docker": "bash -c 'cd aimeat && bash test/docker/e2e-runner.sh --all'"
}
```

## Multi-Node Federation Testing (Future)

For T-1 multi-node tests, extend the compose file:

```yaml
services:
  node-a:
    build: ../..
    ports: ["3200:3200"]
    environment:
      AIMEAT_PORT: 3200
      AIMEAT_NODE_ID: aimeat-e2e-node-a
  node-b:
    build: ../..
    ports: ["3201:3201"]
    environment:
      AIMEAT_PORT: 3201
      AIMEAT_NODE_ID: aimeat-e2e-node-b
```

## Migration Plan

1. Create `test/docker/` directory with compose file and runner script
2. Update existing test files to read `E2E_BASE` / `E2E_NODE_ID` from env
3. Add `:docker` npm scripts to package.json
4. New test files (T-2 onwards) use Docker from the start
5. CI pipeline calls `test:e2e:all:docker`

## Cleanup Guarantees

- `trap cleanup EXIT` ensures containers are removed even on test failure
- `docker compose down -v --remove-orphans` removes volumes and orphans
- `docker image prune` removes dangling build layers
- No named volumes are used — everything is ephemeral
- Tests cascade-delete their own owners as a final step
