# Code Style Guide

## Language & Runtime

| Setting | Value |
|---------|-------|
| Language | TypeScript 5.9.3, strict mode |
| Target | ES2022 |
| Module | NodeNext resolution, ESM (`"type": "module"`) |
| Runtime | Node.js 24.x |
| Framework | Express 5.2.1 |
| Package manager | pnpm |
| Linting | ESLint (`pnpm lint`) |

---

## TypeScript Conventions

### Import Extensions

Always use `.js` extensions in imports (ESM requirement):
```typescript
import { foo } from '../services/foo.js';     // ✅
import { foo } from '../services/foo';        // ❌
```

### Express 5 Params

`req.params.foo` returns `string | string[]` in Express 5. Always cast:
```typescript
const id = req.params.id as string;           // ✅
const id = req.params.id;                     // ❌ type is string | string[]
```

### Naming Convention — AIMEAT Prefix

Never use `MEAT` as a standalone prefix. The project is fully renamed to `AIMEAT`:

| Context | Correct | Incorrect |
|---------|---------|-----------|
| Types | `AimeatConfig`, `AimeatResponse` | ~~MeatConfig~~, ~~MeatResponse~~ |
| Env vars | `AIMEAT_*` | ~~MEAT_*~~ |
| Default IDs | `aimeat-local-001-dev` | ~~meat-local-001-dev~~ |

### Type Exports

- Export interfaces and types from the file where they're defined.
- Use `type` imports when importing only types: `import type { AimeatConfig } from '../config.js';`
- Prefer interfaces over type aliases for object shapes.

### Error Handling

- Use typed error codes from the envelope system, not raw strings.
- Always return proper HTTP status codes with error responses.
- Don't catch errors silently — log with `logger.error()` or propagate.

---

## Response Envelope

Every API response uses the AIMEAT envelope via `success()` / `error()` from `src/middleware/envelope.ts`:

```typescript
import { success, error } from '../middleware/envelope.js';

// Success with hints
res.json(success(config.nodeId, { data: 'here' }, [
  { description: 'Next action', method: 'GET', url: '/v1/endpoint' },
]));

// Error
res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Resource not found'));
```

---

## Route Handler Pattern

### Router Factory

All routes export a factory function that receives config and storage:

```typescript
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function myRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/myendpoint', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    // ... handler logic
    res.json(success(config.nodeId, { result: 'data' }));
  });

  return router;
}
```

### Route Registration

Routes are mounted in `src/server.ts`:
```typescript
app.use(myRouter(config, storage));
```

### Route Ordering

Static routes must be registered before parameterized routes:
```typescript
router.get('/v1/memory/search', ...);  // ✅ First — static
router.get('/v1/memory/:key', ...);    // ✅ Second — parameterized
```

---

## Auth Middleware

```typescript
import { requireAuth, requireRole } from '../auth/middleware.js';

// Agent-only endpoint
router.post('/v1/endpoint', requireAuth(), requireRole('agent'), async (req, res) => {
  const gaii = req.auth!.sub;       // Agent GAII
  const owner = req.auth!.owner;    // Owner name
  const roles = req.auth!.roles;    // ['owner'] or ['agent'] or ['owner', 'operator']
});
```

---

## Storage Layer

All data access goes through the `Storage` interface (`src/storage/interface.ts`). Supported backends are **PostgreSQL + Kysely** (primary / production) and **SQLite (better-sqlite3)**; use SQLite with `AIMEAT_DB_PATH=:memory:` for ephemeral runs. (The old pure in-memory provider is deprecated; the Prisma-era MongoDB and legacy Prisma-PG backends were removed 2026-07-16.) A data-model change updates both backends in the same commit — see `storage-sync.md`.

### Adding New Data Types

1. Add the interface/record type to `src/storage/interface.ts`
2. Add CRUD methods to the `Storage` interface
3. Create a repository in `src/storage/repositories/`
4. Implement for each provider in `src/storage/providers/`

### Repository Pattern

```typescript
// src/storage/repositories/my-thing.repository.ts
export interface MyThingRepository {
  create(record: MyThingRecord): Promise<void>;
  getById(id: string): Promise<MyThingRecord | undefined>;
  update(id: string, updates: Partial<MyThingRecord>): Promise<void>;
  delete(id: string): Promise<boolean>;
}
```

---

## Frontend Code Style

See [Frontend Development Guide](../frontend-development-guide.md) for complete frontend conventions. Key rules:

- **Preact + HTM** with no build step, native ESM
- **CSS classes prefixed** per view (e.g., `adm-*` for admin, `gn-*` for portal)
- **No inline styles** for layout/colors — use CSS classes
- **`useViewCSS()`** hook for dynamic CSS loading
- **`t('key')` for i18n** — all user-visible text goes through translation
- **`escHtml()` only for user data** — never double-escape `t()` translations

---

## i18n

- Translation files: `locales/en.json`, `locales/fi.json`
- Both files must be kept in sync — add keys to both when adding new text.
- Key format: `{namespace}.{section}.{key}` (e.g., `dashboard.emailExplain`)
- Backend: translations accessible via `t()` helper
- Frontend: `import { t } from '/js/i18n.js';`

---

## Logging

Use the Winston logger from `src/utils/logger.ts`:

```typescript
import { logger } from '../utils/logger.js';

logger.info('Server started', { port: config.port });
logger.warn('Rate limit approaching', { owner, remaining: 5 });
logger.error('Database connection failed', { error: err.message });
```

---

## Code Quality Checklist

Before submitting changes:

- [ ] `npx tsc --noEmit` passes (type-check)
- [ ] `pnpm lint` passes (ESLint)
- [ ] File headers added/updated (see [file-headers.md](./file-headers.md))
- [ ] i18n keys added to both `en.json` and `fi.json`
- [ ] `.js` extensions used in all imports
- [ ] Express 5 params cast to `string`
- [ ] Response envelope used for all API responses
- [ ] Auth middleware applied to protected endpoints
