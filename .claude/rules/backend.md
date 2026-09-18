---
paths:
  - "**/aimeat/src/**"
  - "**/openapi.yaml"
  - "**/aimeat/.dependency-cruiser.cjs"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Backend

**Protocol only, no server-side rendering.** Routes in `src/routes/` are generic reusable API endpoints. Never `res.send('<html>...')` or build HTML in a handler. The test for a new route is "would a second, different service use this?"; if not, it does not belong, and no per-service backend files. UIs are client-side SPAs or static files. The admin dashboard is the single legacy exception. If data is already available through an existing API, do not wrap it.

**One capability, one implementation, whatever the interface.** An MCP tool declares its own name, description and parameters, because the protocol requires that. It does not do the work itself: it calls the same route or the same service function REST calls, so the scope check, the validation and the provenance happen where they were written once. A tool that reaches `storage.*` directly is a second implementation, and needs a written reason. This rule exists because the same defect has already been fixed three separate times inside one MCP tool (`aimeat_memory_write`: schema locks, write target, provenance), each time in one place while the other surface kept the old behaviour, and the August 2026 audit then found two more of the same kind.

- **Response envelope:** `success()` / `error()` from `src/middleware/envelope.ts`.
  ```typescript
  res.json(success(config.nodeId, { data: 'here' }, [{ description: 'Next', method: 'GET', url: '/v1/endpoint' }]));
  res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Resource not found'));
  ```
- **Auth middleware:** `requireAuth()`, `requireRole('owner'|'agent')`, `requireScope('memory:write')` from `src/auth/middleware.js`. Owner endpoints bypass scopes.
- **Routers** follow `export function myRouter(config, storage): Router`, mounted in `mountRoutes()` (`src/server-bootstrap/routes-loader.ts`).
- **Storage** goes through the `Storage` interface (`src/storage/interface.ts`). Two providers: `postgres-kysely` (pg + Kysely, SQL migrations under `providers/postgres-kysely/migrations/*.sql` run on boot) and `sqlite` (better-sqlite3, also the in-memory default via `:memory:`). **New data types and fields go into both.** → `docs/coding-guidelines/storage-sync.md`
- **ESM imports keep the `.js` extension:** `import { foo } from '../services/foo.js'`.
- **Express 5:** `req.params` returns `string | string[]`, cast with `as string`.

## Gates for this area

- **`openapi.yaml` changes in the same commit as the route**, then `pnpm generate:types`. `pnpm check:openapi-routes` (in `check:fast`, so in `pnpm gate` and CI) holds it in both directions: a route declared in `src/` is in the contract or is answered in the script's `NOT_API` as a page, a redirect or a static file, and a contract entry no code declares fails. Until 2026-09-18 nothing checked it, and the contract was missing 45 API routes and described one that had been deleted four months earlier.
- **Import boundaries are dependency-cruiser's job, not a hand-written script's.** `pnpm check:deps` reads `aimeat/.dependency-cruiser.cjs`: layer direction (storage is the bottom, a service takes no Express request, a route does not reach into the CLI), import cycles and orphan modules — the last two of which nothing checked before 2026-09-04. `pnpm deps:report` shows the whole backlog, `pnpm deps:graph` writes it as mermaid and `pnpm deps:layers` as a collapsed per-directory graph. What it cannot see stays where it is: the extension, cortex and app namespaces are a RUNTIME boundary (`AIMEAT.data` is a global, not an import), and `public/` resolves its own paths through the importmap, which `check:importmap` reads. The three custom ESLint rules that overlap it stay too, because they carry exemption lists and report in the editor.
