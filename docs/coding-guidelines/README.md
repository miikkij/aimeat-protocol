# Coding Guidelines

Central reference for all development standards, conventions, and practices in the AIMEAT project.

## Mandatory Rules

These are enforced via CLAUDE.md and ESLint. See CLAUDE.md for the authoritative list.

1. **E2E tests must pass** after major changes (`pnpm test:e2e:postgres-kysely` + `pnpm test:e2e:sqlite`)
2. **Playwright tests must pass** after frontend changes (`npx playwright test`)
3. **Source file headers required** on all `.ts`, `.js`, `.css` files
4. **OpenAPI spec must stay in sync** with implementation
5. **i18n files must stay in sync** (`en.json` + `fi.json`)
6. **Dependency management rules** must be followed when adding packages
7. **ESLint must pass** (`pnpm lint`)

## Documents

| Guide | Purpose |
|-------|---------|
| [Testing Requirements](./testing-requirements.md) | **MANDATORY** — E2E + Playwright testing rules, multi-backend testing |
| [File Headers](./file-headers.md) | **MANDATORY** — Source file header format, version history tracking |
| [Code Style](./code-style.md) | TypeScript/JS conventions, response envelope, route patterns, i18n, logging |
| [Architecture](./architecture.md) | System design, core vs extended services, directory structure, storage layer |
| [Security](./security.md) | Auth patterns, input validation, XSS prevention, rate limiting, GDPR |
| [Getting Started](./getting-started.md) | Installation, setup, development workflow, common tasks, deployment |
| [Dependency Management](./dependency-management.md) | **MANDATORY** — Adding packages, license checks, security audits |
| [Environment Configs](./environment-configs.md) | Node type configurations (full, personal, relay, mirror) |
| [Storage Sync](./storage-sync.md) | Multi-backend synchronization process, adding fields/tables |

## Enforcement Tools

| Tool | What It Checks | Command |
|------|---------------|---------|
| ESLint + custom rules | File headers, file size, TS conventions | `pnpm lint` |
| TypeScript compiler | Type safety | `npx tsc --noEmit` |
| E2E test runner | API correctness on all backends | `pnpm test:e2e:postgres-kysely` |
| Playwright | Frontend rendering, navigation, CSP | `npx playwright test` |
| Pre-commit script | Headers, file size, i18n sync, lint, typecheck | `bash scripts/pre-commit-checks.sh` |

## Related Documentation

| Document | Location | Purpose |
|----------|----------|---------|
| CLAUDE.md | `/CLAUDE.md` | AI assistant instructions (mandatory rules) |
| Frontend Guide | `/docs/frontend-development-guide.md` | Preact + HTM SPA conventions, admin dashboard |
| API Specification | `/openapi.yaml` | Canonical API contract (must stay in sync) |
| OpenAPI Sync Plan | `/docs/plans/openapi-sync-plan.md` | Plan to sync 271 missing routes |
| RFC Specification | `/docs/01-core.md` through `/docs/09-community.md` | Protocol specification |
| Test Plans | `/docs/testing/` | Detailed test plans (T-1 through T-9) |
| Config Reference | `/docs/b-config.md` | Complete configuration schema |
