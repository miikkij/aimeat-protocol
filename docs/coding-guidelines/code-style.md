# Code Style Guide

## Language & Runtime

| Setting | Value |
|---------|-------|
| Language | TypeScript (version in `aimeat/package.json`), strict mode |
| Target | ES2022 |
| Module | NodeNext resolution, ESM (`"type": "module"`) |
| Runtime | Node.js 24 or later (`engines` in `aimeat/package.json`) |
| Framework | Express 5 (version in `aimeat/package.json`) |
| Package manager | pnpm |
| Linting | ESLint (`pnpm lint`) |

---

## TypeScript Conventions

### Import Extensions

Always use `.js` extensions in imports (ESM requirement):
```typescript
import { foo } from '../services/foo.js';     // ✓
import { foo } from '../services/foo';        // ✗
```

### Express 5 Params

`req.params.foo` returns `string | string[]` in Express 5. Always cast:
```typescript
const id = req.params.id as string;           // ✓
const id = req.params.id;                     // ✗ type is string | string[]
```

### Naming Convention: AIMEAT Prefix

Never use `MEAT` as a standalone prefix. The project is fully renamed to `AIMEAT`:

| Context | Correct | Incorrect |
|---------|---------|-----------|
| Types | `AimeatConfig`, `AimeatResponse` | ~~MeatConfig~~, ~~MeatResponse~~ |
| Env vars | `AIMEAT_*` | ~~MEAT_*~~ |
| Default IDs | `aimeat-local-001-dev` | ~~meat-local-001-dev~~ |

### Naming Convention: Casing, and Where It Changes

This describes what the codebase already does. It is written down here because it was consistent and
undocumented, which is how a reviewer ends up arguing about a casing choice that was never in doubt.

There are **two kinds of thing**, and they follow different rules:

| Kind | Casing | Example |
|---|---|---|
| Internal TS types, Zod models, variables | `camelCase` | `createdAt`, `blockSize`, `periodSeconds` |
| **Route DTOs on the wire** | `snake_case`, **mapped at the route boundary** | `created_at: p.createdAt` (`access-tokens.ts`), `usage.prompt_tokens` (`ai.ts`) |
| **Self-describing documents that carry their own `spec`** | **ONE spelling, `camelCase`, on every carrier** | ODPS `provenance` (`legalBasis`, `odpsVersion`), AI provenance (`humanInvolvement`, `generatedAt`) |

**Route DTOs** are snake_case on the wire and camelCase inside, and the mapping happens once, in the
route handler. Do not let snake_case leak inward and do not let camelCase leak outward.

**Self-describing documents are different, and the difference is deliberate.** A document that
carries its own `spec` identifier (`"spec": "aimeat.provenance/v1"`, an ODPS descriptor) is not a
DTO of one endpoint. It travels through many carriers: a memory record, YAML frontmatter, a C2PA
assertion, an MCP tool result, a WebMCP listing, `/v1/provenance/:id`, and a published JSON Schema
external validators read. Mapping it at each boundary would mean one mapping site per carrier, and
one of them would drift. So it keeps **one spelling everywhere**, and the spelling is camelCase.

Which means `meta.provenance.humanInvolvement` sitting next to `usage.prompt_tokens` in the same
response is **not** an inconsistency: one is a document riding in an envelope, the other is a field
of that endpoint's DTO.

The one place the two meet: an **MCP parameter name** is snake_case like every sibling parameter
(`organism_id`, `include_archived`, `ai_provenance`) while its **value** is the document, camelCase.

### Type Exports

- Export interfaces and types from the file where they're defined.
- Use `type` imports when importing only types: `import type { AimeatConfig } from '../config.js';`
- Prefer interfaces over type aliases for object shapes.

### Error Handling

- Use typed error codes from the envelope system, not raw strings.
- Always return proper HTTP status codes with error responses.
- Don't catch errors silently: log with `logger.error()` or propagate. `pnpm check:silent-catch` and the `aimeat/no-silent-catch` lint rule refuse a silent handler.

### File Size

No file over 800 lines (`aimeat/max-file-lines`, a lint error). Split a file that grows past it by pure extraction, and never shave comments or version history to fit. See `.claude/rules/code-files.md` and [file-headers.md](./file-headers.md).

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
import { requireAuth, requireScope } from '../auth/middleware.js';
import { callerOf } from '../middleware/caller.js';

export function myRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/my-things/:id', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    const id = req.params.id as string;
    const record = await storage.getMemory(caller.principal, `my-things.${id}`);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such thing'));
      return;
    }
    res.json(success(config.nodeId, { id, value: record.value }));
  });

  return router;
}
```

The record is read under `caller.principal`, the resolved GHII, GAII or GEAI, never under the raw token subject. See [Auth Middleware and the Caller](#auth-middleware-and-the-caller) below.

### Route Registration

Routes are mounted in `mountRoutes()` in `src/server-bootstrap/routes-loader.ts`. Two siblings hold groups moved out of it for length: `routes-loader-ai.ts` (`mountAiRouters`) and `routes-loader-outbound.ts` (`mountOutboundRouters`). Add the new router where its group is mounted:
```typescript
app.use(myRouter(config, storage));
```

### Route Ordering

Static routes must be registered before parameterized routes:
```typescript
router.get('/v1/memory/search', ...);  // ✓ First: static
router.get('/v1/memory/:key', ...);    // ✓ Second: parameterized
```

### The Contract and the Other Surfaces

- **`openapi.yaml` changes in the same commit as the route**, then run `pnpm generate:types`. `pnpm check:openapi-routes` (in `pnpm gate`) fails on a route the contract does not list and on a contract entry no code declares.
- **One capability, one implementation, whatever the interface.** An MCP tool or CLI command calls the same route or service function REST calls, so the scope check, the validation and the provenance happen in one place. A tool that reaches `storage.*` directly is a second implementation.

Both rules and their gates are in `.claude/rules/backend.md`.

---

## Auth Middleware and the Caller

Mount the middleware from `src/auth/middleware.ts`, then ask the caller object for who is calling. `callerOf(req, config.nodeId, storage)` (`src/middleware/caller.ts`) builds one `CallerContext` (`src/services/caller-context.ts`) per request:

```typescript
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { callerOf } from '../middleware/caller.js';

router.post('/v1/endpoint', requireAuth(), requireScope('memory:write'), async (req, res) => {
  const caller = callerOf(req, config.nodeId, storage);
  caller.principal;              // GHII, GAII or GEAI: the identity records are stored and read under
  caller.owner;                  // the account name the caller acts in; not a principal
  caller.kind;                   // 'owner' | 'agent' | 'app' | 'ecosystem' | 'visitor' | 'anonymous'
  caller.has('memory:write');    // requireScope's answer for one scope word
  await caller.operator();       // is this an operator account in person, or its agent holding the word
});

// Agent-only endpoint
router.post('/v1/agent-only', requireAuth(), requireRole('agent'), async (req, res) => { /* … */ });
```

- Store, read and compare ownership against `caller.principal`. Never use raw `req.auth!.sub`: an owner session's `sub` is the bare account name, and data stored under it is invisible to list, search and update. Code that has only the token uses `resolveIdentity(req.auth!, config.nodeId)` from `src/utils/gaii.ts`, which is what `caller.principal` holds.
- `caller.owner` names the human on owner sessions, agent tokens, app grants, ecosystem apps and PATs alike, so comparing it refuses a different person and admits everything acting in this person's name. A change to the account itself goes behind `requireOwnerPrincipal()` (`src/auth/account-security.ts`); `requireRole('owner')` is not that test.
- A session from another node is a visitor (`caller.visitor`). Shorten an identity with `localAccountName()` or `localAccountOf()`, never `split('@')[0]`.

The full rules are in `.claude/rules/security.md`, [identity-model.md](./identity-model.md) and [security-development-dna.md](./security-development-dna.md).

---

## Storage Layer

All data access goes through the `Storage` interface (`src/storage/interface.ts`). Supported backends are **PostgreSQL + Kysely** (production) and **SQLite (better-sqlite3)**; use SQLite with `AIMEAT_SQLITE_PATH=:memory:` for ephemeral runs. (The Prisma-era MongoDB and legacy Prisma-PG backends were removed on 2026-07-16.) A data-model change updates both backends in the same commit.

### Adding New Data Types

1. Add the record type to a file in `src/storage/types/` and re-export it from `src/storage/interface.ts`.
2. Add a repository interface in `src/storage/repositories/<name>.repository.ts`, with method names that carry the record name (`createMyThing`, `getMyThing`), because every repository is merged into the one `Storage` interface.
3. Add that interface to the list `Storage` extends in `src/storage/interface.ts`.
4. Implement it in both providers under `src/storage/providers/`, with a migration for PostgreSQL.

The full procedure, with the migration, the deletion cascade and the tests, is [storage-sync.md](./storage-sync.md).

---

## Frontend Code Style

See [Frontend Development Guide](../frontend-development-guide.md) for complete frontend conventions. Key rules:

- **Preact + HTM** with no build step, native ESM
- **CSS classes prefixed** per view (e.g., `adm-*` for admin, `agd-*` for agent detail)
- **No inline styles** for layout/colors: use CSS classes
- **View CSS is linked from `spa.html`.** `useViewCSS()` is a no-op kept so old call sites still work; do not rely on it to load a stylesheet.
- **`t('key')` for i18n**: all user-visible text goes through translation
- **`escHtml()` only for user data**: never double-escape `t()` translations

---

## i18n

- Translation files are in `aimeat/locales/`: `en.json`, `fi.json`, `es.json`. The language list is `LOCALES` in `src/i18n.ts`.
- `en.json` is the source of truth for which keys exist. Add new text there. Finnish and Spanish follow through `pnpm locale:extract <lang> --prefix <screen>.` and `pnpm locale:merge <lang> <file>`, in the same change when the text is ready or in a later pass.
- A key missing from `fi` or `es` falls back to English. A `[TODO:xx]` placeholder fails the gate (`pnpm check:locales`); leave the key out instead.
- Key format: `{namespace}.{section}.{key}` (e.g., `dashboard.emailExplain`)
- Backend: `createT(locale)` from `src/i18n.ts` returns a `t()` for one locale
- Frontend: `import { t } from '/js/i18n.js';`

The rule is `.claude/rules/locales.md`; how to compose Finnish and Spanish is the `aimeat-writing` skill (`.claude/skills/aimeat-writing/SKILL.md`).

---

## Comments

A comment names software parts with the terms the industry uses: endpoint, route, handler, MCP
tool, CLI command, function, module, memory key, request. It does not use metaphors for them:
not "door" for an endpoint or a tool, not "road" for a code path, not "hand" for the author or
caller, not "floor" for the shared environment. The full table is in
[shell-and-git.md](./shell-and-git.md#the-words-in-a-commit-message), which applies the same rule
to commit messages. Ruled by the developer on 2026-09-27.

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

- [ ] `pnpm typecheck`, `pnpm typecheck:frontend` and `pnpm typecheck:sdk` pass (the pre-commit hook runs all three)
- [ ] `pnpm lint` passes (ESLint)
- [ ] `pnpm gate` is green on the finished work
- [ ] File headers added/updated (see [file-headers.md](./file-headers.md)), and no file over 800 lines
- [ ] New UI text is in `locales/en.json`; no `[TODO:xx]` placeholder in another language
- [ ] `openapi.yaml` updated in the same commit as a new or changed route
- [ ] Identity read through `callerOf(...)` or `resolveIdentity(...)`, never raw `req.auth!.sub`
- [ ] `.js` extensions used in all imports
- [ ] Express 5 params cast to `string`
- [ ] Response envelope used for all API responses
- [ ] Auth middleware applied to protected endpoints
- [ ] Comments use technical terms, no metaphors (see Comments above)
