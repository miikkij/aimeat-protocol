# CLAUDE.md — AI Assistant Instructions for JM001 / AIMEAT

## Project Overview

This is the **AIMEAT Protocol** (AI Memory Exchange and Action Transfer) — an open protocol for AI agent infrastructure. The repo contains:

1. **Protocol specification** (RFC v1.2) in `docs/` and `openapi.yaml`
2. **Reference implementation** in `aimeat/` — a Node.js/TypeScript server

## Architecture

- **Runtime:** Node.js 24.x, ESM (`"type": "module"`)
- **Framework:** Express 5.2.1 — note: `req.params` returns `string | string[]`, cast with `as string`
- **Language:** TypeScript 5.9.3, strict mode, ES2022 target, NodeNext module resolution
- **Crypto:** @noble/ed25519 3.0 for key generation/signing, jose 6.1 for EdDSA JWTs
- **Package manager:** pnpm
- **Port:** 3117

## Key Commands

```bash
# All commands from aimeat/ directory
cd aimeat

# Dev server (auto-reload)
pnpm dev

# Type-check (no emit)
npx tsc --noEmit

# Run E2E tests (server must be running on :3117)
npx tsx test/e2e-full.ts

# Build for production
pnpm build

# Start production
pnpm start
```

## Code Conventions

### Response Envelope

Every response uses the MEAT envelope via `success()` / `error()` from `src/middleware/envelope.ts`:

```typescript
import { success, error } from '../middleware/envelope.js';

// Success with hints
res.json(success(config.nodeId, { data: 'here' }, [
  { description: 'Next action', method: 'GET', url: '/v1/endpoint' },
]));

// Error
res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Resource not found'));
```

### Auth Middleware

```typescript
import { requireAuth, requireRole } from '../auth/middleware.js';

// Agent-only endpoint
router.post('/v1/endpoint', requireAuth(), requireRole('agent'), async (req, res) => {
  const gaii = req.auth!.sub;       // Agent GAII
  const owner = req.auth!.owner;    // Owner name
  const roles = req.auth!.roles;    // ['owner'] or ['agent'] or ['owner', 'operator']
});
```

### Route Registration

All routes are mounted in `src/server.ts`. New routers follow the pattern:

```typescript
export function myRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();
  router.get('/v1/myendpoint', ...);
  return router;
}
```

Then in server.ts: `app.use(myRouter(config, storage));`

### Storage Layer

All data access goes through the `Storage` interface (`src/storage/interface.ts`). Current implementation is in-memory (`src/storage/memory.ts`). When adding new data types:

1. Add the interface/record type to `interface.ts`
2. Add CRUD methods to the `Storage` interface
3. Implement in `memory.ts` with a new `Map`

### Import Extensions

Always use `.js` extensions in imports (ESM requirement):
```typescript
import { foo } from '../services/foo.js';  // ✅
import { foo } from '../services/foo';     // ❌
```

## File Organization

| Directory | Purpose |
|-----------|---------|
| `src/auth/` | JWT, keypair generation, auth middleware |
| `src/middleware/` | Response envelope, rate limiting |
| `src/routes/` | Express route handlers (one file per domain) |
| `src/services/` | Business logic (morsel economy, trust scoring) |
| `src/storage/` | Data layer abstraction + implementations |
| `src/utils/` | GAII utilities, logger |
| `test/` | E2E test suite |

## Testing

The E2E test file (`test/e2e-full.ts`) runs 35 tests across 6 phases + GDPR. Tests run against a live server on port 3117. The test creates its own owner/agents and cleans up via cascade delete at the end.

**Always run `npx tsc --noEmit` after changes** to verify the build compiles cleanly.

## Spec Documents

- `openapi.yaml` — The canonical API contract (75 paths, 88 operations)
- `docs/aimeat-implementation-prompt.md` — Detailed implementation guidance
- `docs/01-core.md` through `docs/09-community.md` — RFC sections
- `docs/a-endpoints.md` — Quick endpoint reference
- `docs/b-config.md` — Node configuration schema
- `docs/c-platform-notes.md` — AI platform compatibility

## Common Pitfalls

- **Express 5 params:** `req.params.foo` is `string | string[]`. Always cast: `req.params.foo as string`
- **Route ordering:** Static routes (e.g., `/v1/memory/search`) must be registered before parameterized routes (e.g., `/v1/memory/:key`)
- **Ed25519 sha512Sync:** Must set `ed.etc.sha512Sync` using `node:crypto` for synchronous operations
- **MultiDiGraph:** If two nodes can have multiple edges (e.g., goal_reached + goal_not_reached), use `MultiDiGraph`, not `DiGraph`
- **First owner is operator:** The first registered owner automatically gets the `operator` role
