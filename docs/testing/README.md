# AIMEAT Test Plans

Test plans for gaps T-1 through T-9 identified in the gap analysis. Each plan describes **what** to test, **how** to structure the tests, and **key scenarios** to cover.

## Test Infrastructure

| Runner | Location | Pattern |
|--------|----------|---------|
| E2E (standalone TSX) | `test/e2e-*.ts` | Custom `test()`/`assert()`, runs against live server on `:3117` |
| Unit (vitest) | `test/unit/*.test.ts` | `describe`/`it`/`expect`, pure functions + mocked `Storage` |
| Integration (vitest) | `test/integration/*.test.ts` | vitest with programmatic server startup (proposed) |

## Plans

| ID | Plan | Priority | File |
|----|------|----------|------|
| T-1 | [Federation E2E](./T-1-federation-e2e.md) | Medium |
| T-2 | [MCP + OAuth E2E](./T-2-mcp-oauth-e2e.md) | Medium |
| T-3 | [Dispute Escalation E2E](./T-3-dispute-escalation-e2e.md) | Low |
| T-4 | [Micro-Memory E2E](./T-4-micro-memory-e2e.md) | Low |
| T-5 | [Storage Visibility E2E](./T-5-storage-visibility-e2e.md) | Low |
| T-6 | [Board Post TTL E2E](./T-6-board-ttl-e2e.md) | Low |
| T-7 | [Hook Execution E2E](./T-7-hook-execution-e2e.md) | Low |
| T-8 | [MongoDB Adapter Integration](./T-8-mongodb-adapter.md) | Low |
| T-9 | [Concurrent Access / Stress](./T-9-concurrent-access.md) | Low |

## Conventions

- E2E tests follow the existing `test/e2e-full.ts` pattern: fetch-based, sequential, same `json()` helper.
- Each E2E file is self-contained: registers its own owner/agents, cleans up via cascade delete.
- Timing-dependent tests use short TTLs (milliseconds/seconds) to avoid slow test suites.
- MongoDB integration tests require `DATABASE_URL` env var; skip gracefully if unavailable.
