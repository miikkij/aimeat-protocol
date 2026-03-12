# 02 — Code Quality Analysis

## 1. TypeScript Usage

### 1.1 Configuration

- **Strict mode:** Enabled (`strict: true`)
- **Target:** ES2022
- **Module:** NodeNext (ESM required)
- **Declarations + source maps:** Enabled

### 1.2 Type Safety Assessment: 95% Excellent

**Strengths:**
- `req.params.foo as string` consistently applied across all route files
- `req.auth!.sub` non-null assertion safe after `requireAuth()` middleware
- Zod schemas validate all POST/PUT request bodies
- Storage interface fully typed with 50+ record types

**Issues found:**

| Location | Pattern | Severity |
|----------|---------|----------|
| `config.ts:635` | `(config as any)[field.key] = value` | Low — single occurrence, admin-only |
| `hooks.ts:76` | `as Record<string, unknown>` | Low — fetch response casting |
| `config.ts:445` | `process.env.AIMEAT_MSM_INSTALL_ROLE as 'operator' \| 'owner'` | Low — no runtime validation |
| `storage/providers/sqlite/index.ts` | 50+ `as Record<string, unknown>` casts | Medium — systematic, unavoidable for untyped DB rows |

**Recommendation:** Create a typed row deserializer helper for SQLite to centralize the 50+ type casts.

## 2. Error Handling

### 2.1 Envelope Pattern (Excellent)

All responses use `success()` / `error()` from `src/middleware/envelope.ts`:

```typescript
res.json(success(config.nodeId, { data: 'here' }, [hints]));
res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Resource not found'));
```

HTTP status codes are consistently paired with error codes. No stack traces leaked to clients.

### 2.2 Silent Error Swallowing (Concern)

~30 instances of `.catch(() => { /* ignore */ })` across services:

| File | Line (est.) | Context |
|------|-------------|---------|
| `services/hooks.ts:67` | `response.text().catch(() => '')` | Webhook body extraction |
| `routes/personal.ts:178` | `storage.expireSessionOtks().catch(() => {})` | Session cleanup |
| `services/federation.ts` | Multiple | Peer sync error suppression |
| `services/push.ts` | Multiple | Push notification delivery |

**Impact:** Debugging federation/replication issues becomes difficult when errors are silently discarded.

**Recommendation:** Replace silent catches with `logger.debug()` or `logger.warn()` calls that include operation context.

### 2.3 Global Error Handler

```typescript
// server.ts (simplified)
if (status >= 500) {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
}
res.status(status).json({
  error: {
    code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
    message: status >= 500 ? 'An unexpected error occurred' : err.message,
  },
});
```

Internal errors are logged server-side with stack traces; clients receive only generic messages.

## 3. Code Complexity

### 3.1 Largest Functions

| File | Function | LOC (est.) | Cyclomatic Complexity | Risk |
|------|----------|------------|----------------------|------|
| `routes/mcp.ts` | handleMCPSession | ~300 | 12+ | High |
| `routes/portal-human.ts` | portalRouter | ~200 | 10+ | High |
| `routes/knowledge.ts` | knowledgeRouter | ~200 | 9+ | High |
| `routes/admin-extensions.ts` | extension install handler | ~120 | 8+ | Medium |
| `routes/federation-sync.ts` | sync handler | ~200 | 10+ | High |

**Recommendation:** Functions over 100 LOC with 8+ branches should be split into smaller, testable units.

### 3.2 Largest Files

| File | LOC | Notes |
|------|-----|-------|
| `generated/api-types.ts` | ~12,050 | Auto-generated, acceptable |
| `storage/providers/sqlite/index.ts` | ~4,540 | Consider splitting by domain |
| `storage/providers/mongodb/index.ts` | ~4,107 | Consider splitting by domain |
| `cli/init-wizard.ts` | ~1,808 | UI-heavy, acceptable |
| `services/prompt-defaults.ts` | ~1,700 | Static data, acceptable |
| `routes/mcp.ts` | ~1,297 | Dense protocol handling |
| `routes/knowledge.ts` | ~1,182 | Graph + embedding logic |
| `storage/interface.ts` | ~1,115 | Interface definition, acceptable |
| `routes/agents.ts` | ~1,100 | Many sub-endpoints |

## 4. Code Duplication

### 4.1 High-Value Duplication

1. **Webhook invocation pattern** — 3 separate implementations of `fetch → timeout → error handling` in:
   - `services/hooks.ts`
   - `services/personal-tunnel.ts`
   - `routes/federation-sync.ts`

   **Fix:** Extract a shared `webhookFetch()` helper with timeout, retry, and error logging.

2. **Error envelope creation** — `error()` function called with nearly identical parameters 4 times in `auth/middleware.ts`.

   **Fix:** Extract `authError()` helper.

3. **Federation sync fetch+retry+parse** — Multiple similar patterns in `routes/federation-sync.ts` (~600 LOC).

   **Fix:** Extract `federationRequest()` helper with common retry/parse logic.

### 4.2 Well-Consolidated Patterns

- GAII parsing — single canonical implementation in `utils/gaii.ts`
- Quota enforcement — centralized in `services/quota.ts`
- Response envelope — single `success()`/`error()` source
- Rate limit configuration — centralized with per-tier overrides

## 5. Input Validation

### 5.1 Strengths

- Zod schemas validate all POST/PUT bodies via `validateBody()` middleware
- GAII/owner/agent name regex validation
- URL length limits (8KB) in config
- Anonymous namespace enforcement (`anonymous.*` keys only)
- Schema locking for memory keys (CSM-defined patterns)

### 5.2 Gaps

| Gap | Location | Risk |
|-----|----------|------|
| No per-endpoint request size limits | Global 15MB only | Low |
| Loose GAII parsing fallback | `utils/gaii.ts:62-71` | Low — returns empty strings instead of rejecting |
| No validation of computed overage values | `routes/memory.ts:143-146` | Medium — assumes balance exists |
| Federation URLs not always validated | Various federation routes | Medium |

## 6. Import Conventions

ESM `.js` extension rule consistently followed:

```typescript
import { foo } from '../services/foo.js';  // ✅ Correct throughout
```

No violations found.

## 7. Naming Conventions

| Convention | Status | Notes |
|------------|--------|-------|
| `AimeatConfig`, `AimeatResponse` | ✅ | No legacy `Meat` prefixes found |
| `AIMEAT_*` env vars | ✅ | Consistent prefix |
| camelCase for TS, snake_case for SQL | ✅ | Clean mapping |
| `adm-*` CSS classes for admin | ✅ | Namespace separation |
| `pf-*` CSS classes for profile | ✅ | Namespace separation |

## 8. Standards Compliance

### Followed

| Practice | Evidence |
|----------|----------|
| Single Responsibility | Routes handle HTTP, services handle logic, storage abstracted |
| Dependency Injection | Routes receive config + storage as parameters |
| DRY | Quota, GAII, envelope centralized |
| Error Handling | Consistent envelope, proper status codes |
| API Design | RESTful, AIMEAT envelope, pagination |
| Configuration | Externalized, multi-source, provenance tracking |

### Needs Improvement

| Practice | Current | Target |
|----------|---------|--------|
| Function size | Up to ~300 LOC | Max ~100 LOC |
| Cyclomatic complexity | Up to 12+ | Max 7 |
| Error context | Generic messages in catches | Operation-specific context |
| Unit test coverage | Unknown threshold | 70%+ enforced |
| Architecture docs | CLAUDE.md only | ADRs + architecture diagrams |

## 9. Code Metrics Summary

```
Critical issues:        0
High-priority issues:   3 (quota overage, silent federation errors, distributed rate limiting)
Medium-priority issues: 8 (function complexity, duplication, missing indexes, type casts)
Low-priority issues:    5 (config validation, anonymous identity, transaction isolation)
```
