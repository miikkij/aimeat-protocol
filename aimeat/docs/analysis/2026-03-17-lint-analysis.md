# ESLint Analysis — 2026-03-17

## Summary

| Metric | Count |
|--------|-------|
| **Total problems** | 926 |
| **Errors** | 235 |
| **Warnings** | 691 |
| **Auto-fixable** | 10 errors + 6 warnings |
| **Files with errors** | 18 |
| **Files with warnings** | 228 |

**Result:** Build fails (exit code 1) due to 235 errors.

---

## Error Breakdown by Rule

| Rule | Count | Severity | Description |
|------|-------|----------|-------------|
| `@typescript-eslint/no-unused-expressions` | 109 | error | Expression statements with no side effect |
| `no-undef` | ~62 | error | Browser globals (`document`, `self`, `caches`, `fetch`, etc.) used in files linted as Node |
| `no-useless-assignment` | 6 | error | Assigned value never used in subsequent statements |
| `prefer-const` | 8 | error | `let` used where `const` would suffice |
| `no-useless-escape` | 3 | error | Unnecessary escape characters in regex/strings |
| `@typescript-eslint/no-this-alias` | 1 | error | Aliasing `this` to a local variable |
| `@typescript-eslint/no-namespace` | 1 | error | TypeScript namespace used instead of ES modules |
| `no-empty` | 8 | error | Empty block statements |

### Root Cause: 187 of 235 errors come from 2 vendored/static files

| File | Errors | Why |
|------|--------|-----|
| `src/static/cookieconsent.umd.js` | 151 | Third-party UMD bundle, minified — not our code |
| `src/static/sw.js` | 36 | Service worker — uses browser globals (`self`, `caches`, `fetch`, `Response`) |

**These 187 errors (80% of all errors) are false positives** — vendored/browser files being linted with Node.js rules.

### Remaining 48 real errors across 16 files

| File | Errors | Types |
|------|--------|-------|
| `src/storage/providers/sqlite/index.ts` | 13 | `prefer-const`, `no-useless-assignment` |
| `src/storage/providers/mongodb/index.ts` | 12 | `prefer-const`, `no-useless-assignment` |
| `src/routes/wallet.ts` | 3 | `no-useless-assignment` |
| `src/server-bootstrap/service-init.ts` | 3 | `no-useless-assignment` |
| `src/routes/federation-peer.ts` | 2 | `no-useless-assignment` |
| `src/routes/profile.ts` | 2 | `no-useless-assignment` |
| `src/services/consent.ts` | 2 | `no-useless-assignment` |
| Various sqlite repos (4 files) | 6 | `prefer-const`, `no-useless-assignment` |
| Other (4 files) | 5 | Mixed |

---

## Warning Breakdown by Rule

| Rule | Count | Description |
|------|-------|-------------|
| `@typescript-eslint/no-explicit-any` | 368 | Use of `any` type |
| `aimeat/file-header` | 223 | Missing `@file` / `@description` header comment |
| `aimeat/max-file-lines` | 36 | File exceeds 500-line limit |
| `@typescript-eslint/no-unused-vars` | ~40 | Unused variables, imports, or parameters |
| Unused `eslint-disable` directives | 6 | Stale disable comments |

### `no-explicit-any` — 368 warnings (53% of all warnings)

The biggest single category. Concentrated in storage providers:

| File | `any` warnings |
|------|----------------|
| `src/storage/providers/mongodb/index.ts` | ~308 |
| `src/routes/knowledge.ts` | 22 |
| `src/routes/packages.ts` | 13 |
| `src/routes/micro-memory.ts` | 5 |
| Other files | ~20 |

The MongoDB storage provider alone accounts for **84% of all `any` warnings**.

### `file-header` — 223 warnings

Nearly every source file is missing the required header comment. This is a project-wide compliance gap with Rule 2 (Source File Headers Required).

### `max-file-lines` — 36 files over 500 lines

Top offenders:

| File | Lines | Factor over limit |
|------|-------|-------------------|
| `src/generated/api-types.ts` | 12,051 | 24x (auto-generated, should be excluded) |
| `src/storage/providers/mongodb/index.ts` | 5,129 | 10x |
| `src/storage/providers/sqlite/index.ts` | 4,783 | 10x |
| `src/routes/knowledge.ts` | 2,679 | 5x |
| `src/routes/portal-human.ts` | 2,049 | 4x |
| `src/cli/init-wizard.ts` | 1,812 | 4x |
| `src/routes/federation-peer.ts` | 1,711 | 3x |
| `src/routes/mcp.ts` | 1,299 | 3x |
| `src/routes/packages.ts` | 1,286 | 3x |
| `src/routes/libs.ts` | 1,285 | 3x |
| Various other files (26) | 531–1,260 | 1–2.5x |

---

## Recommendations and Action Plan

### Phase 0: Quick Wins (< 1 hour, eliminates ~85% of errors)

**Priority: HIGH — Makes `pnpm lint` pass**

1. **Exclude vendored/static files from ESLint** — Add to `.eslintignore` or ESLint config:
   - `src/static/cookieconsent.umd.js` (151 errors — third-party code)
   - `src/static/sw.js` (36 errors — needs browser env config, not Node rules)
   - `src/generated/api-types.ts` (auto-generated, also 12k lines warning)

   Alternatively, configure `sw.js` with `/* eslint-env browser, serviceworker */` header or a per-file ESLint config override for browser globals.

2. **Run `pnpm lint --fix`** — Auto-fixes 10 errors (`prefer-const`) and 6 warnings. Zero risk.

3. **Fix remaining ~10 `no-useless-assignment` errors** manually — These are dead assignments in storage providers and routes. Quick to fix: either remove the assignment or use the value.

**Expected result:** 0 errors, ~680 warnings → build passes.

### Phase 1: Reduce `any` Pollution (2–4 hours)

**Priority: MEDIUM — Improves type safety**

4. **Type the MongoDB storage provider** (`src/storage/providers/mongodb/index.ts`) — This single file has 308 `any` warnings. Focus on:
   - Prisma return types (replace `any` with generated Prisma types)
   - Function parameter types
   - Consider splitting the 5,129-line file while typing it

5. **Type route handlers** — `knowledge.ts` (22), `packages.ts` (13), `micro-memory.ts` (5) account for 40 more. Use `Request<Params, ResBody, ReqBody>` generics.

### Phase 2: File Headers (Batch Automation, 1–2 hours)

**Priority: MEDIUM — Compliance with Rule 2**

6. **Write a script to auto-generate stub headers** for all 223 files missing them. Each header needs:
   - `@file` — filename (trivial to auto-generate)
   - `@description` — can be inferred from directory + filename pattern
   - `@version-history` — initial entry with today's date

   Then refine descriptions manually for key files. The campsite rule will catch the rest over time.

### Phase 3: File Size Reduction (Ongoing, multi-session)

**Priority: LOW — Architectural improvement**

7. **Split large storage providers** — Both `mongodb/index.ts` (5,129 lines) and `sqlite/index.ts` (4,783 lines) should be split by domain (agents, owners, memory, wallet, etc.) into separate repo files, similar to the existing `sqlite/repos/` pattern.

8. **Split large route files** — `knowledge.ts` (2,679), `portal-human.ts` (2,049), `federation-peer.ts` (1,711), `mcp.ts` (1,299), `packages.ts` (1,286), `libs.ts` (1,285) could each be split into sub-routers or helper modules.

9. **Split `init-wizard.ts`** (1,812 lines) — Extract wizard steps into separate modules per section (core settings, economy settings, advanced settings).

### Phase 4: Ongoing Hygiene

10. **Clean up unused imports/variables** (~40 warnings) — Remove dead code flagged by `no-unused-vars`.

11. **Remove stale `eslint-disable` directives** (6 warnings) — The problems they suppressed no longer exist.

12. **Enforce lint in CI** — Once errors are at 0, add `pnpm lint` to the CI pipeline to prevent regressions.

---

## Priority Summary

| Phase | Effort | Impact | Errors Fixed | Warnings Fixed |
|-------|--------|--------|--------------|----------------|
| **Phase 0** | < 1 hour | Lint passes, CI-ready | 235 → 0 | ~10 |
| **Phase 1** | 2–4 hours | Type safety for core files | 0 | ~350 |
| **Phase 2** | 1–2 hours | Rule 2 compliance | 0 | ~223 |
| **Phase 3** | Multi-session | Maintainability, readability | 0 | ~36 |
| **Phase 4** | Ongoing | Code hygiene | 0 | ~50 |

**Recommended starting point:** Phase 0. It's the only phase that blocks the build, and it's almost entirely config changes + one `--fix` run.
