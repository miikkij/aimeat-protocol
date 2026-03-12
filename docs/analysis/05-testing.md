# 05 — Testing & API Specification Analysis

## 1. Test Infrastructure

### 1.1 Frameworks

| Framework | Purpose | Config |
|-----------|---------|--------|
| Vitest 4.0 | Unit + integration tests | `vitest.config.ts` |
| Playwright 1.58 | Browser E2E tests | `playwright.config.ts` |
| Custom harness | API integration tests | `test/api-full.ts` |
| V8 coverage | Code coverage reporting | `pnpm test:coverage` |

### 1.2 Test Inventory

| Type | Files | Cases (est.) | Framework |
|------|-------|-------------|-----------|
| Unit tests | 44 | 300+ | Vitest |
| API integration | 1 (main) | 127 | Custom harness |
| E2E suites | 19 | 200+ | Custom harness |
| Browser E2E | 4 | 15+ | Playwright |
| Integration | 2 | 20+ | Vitest |
| **Total** | **67+** | **660+** | |

### 1.3 Test Commands

```bash
pnpm test                    # Unit + integration (Vitest)
pnpm test:coverage           # Coverage report (LCOV)
pnpm test:watch              # Watch mode
pnpm test:api                # Main API suite (127 tests)
pnpm test:e2e:security       # Security E2E
pnpm test:e2e:disputes       # Dispute resolution E2E
pnpm test:e2e:federation     # Federation E2E
pnpm test:e2e:hooks          # Event hooks E2E
pnpm test:e2e:extensions     # Extension runtime E2E
pnpm test:e2e:mcp            # MCP protocol E2E
pnpm test:e2e:knowledge      # Knowledge base E2E
pnpm test:e2e:concurrency    # Race condition E2E
pnpm test:e2e:ci             # CI runner (auto server lifecycle)
# ... 10 more E2E suites
```

## 2. Unit Test Analysis

### 2.1 Coverage Areas

| Domain | Test File | Cases | Quality |
|--------|-----------|-------|---------|
| GAII parsing | `gaii.test.ts` | 26 | Excellent — edge cases, invalid formats |
| Morsel economics | `morsel.test.ts` | 30+ | Excellent — boundary conditions, in-memory DB |
| Auth middleware | `auth-middleware.test.ts` | 35+ | Excellent — scope matching, role hierarchy |
| Cookie consent | `cookie-consent.test.ts` | 10+ | Good — middleware behavior |
| Config loading | `config-loader.test.ts` | 15+ | Good — multi-source priority |
| Consul config | `consul-config.test.ts` | 10+ | Good — external service integration |

### 2.2 Unit Test Patterns

**Positive patterns:**
- Vitest `describe()` / `it()` / `expect()` API
- `vi.mock()` for dependency isolation
- Custom builders for test data (`makeAgent`, `makeWork`, `makeConfig`)
- In-memory SQLite (`:memory:`) for storage tests
- Focused assertions with descriptive names

**Example of good test structure:**
```typescript
describe('parseGaii', () => {
  it('parses full GAII correctly', () => {
    const result = parseGaii('agent#owner@node');
    expect(result.agentName).toBe('agent');
    expect(result.ownerName).toBe('owner');
    expect(result.nodeId).toBe('node');
  });

  it('rejects reserved names', () => {
    expect(() => validateAgentName('system')).toThrow();
  });
});
```

### 2.3 Unit Test Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| No tests for `src/utils/` utilities (logger, OTK, tracking) | Medium | P2 |
| No tests for quota service edge cases | Medium | P1 |
| No tests for consent service matching | Medium | P1 |
| No tests for trust scoring algorithm | Medium | P2 |
| No tests for federation helpers | High | P1 |
| No tests for realtime manager | Low | P3 |
| No frontend component tests | Medium | P2 |

## 3. E2E Test Analysis

### 3.1 Main API Suite (`test/api-full.ts`)

**127 tests across 8+ phases:**

| Phase | Domain | Tests | Coverage |
|-------|--------|-------|----------|
| 1 | Bootstrap, auth, owner/agent registration | 20+ | Good |
| 2 | Wallet, actions, catalogue, work lifecycle | 20+ | Good |
| 3 | Agent profiles, boards, prompts | 15+ | Good |
| 4 | OTK, admin, federation, rate limiting | 15+ | Good |
| 5 | OpenAPI spec, documentation | 5 | Basic |
| 6 | Extended API (check-in, catalogue, stats, validation) | 15+ | Good |
| 7 | TTL expiry, chunked upload, optimistic locking | 15+ | Good |
| 7b-7c | Initial OTK, auto-identification | 10+ | Good |
| 8 | Chat, site, boards, scoped agents, consent, GDPR | 15+ | Good |

**Test isolation:** Creates unique owner names via `Date.now()`. Cleanup via GDPR cascade delete at end.

### 3.2 Specialized E2E Suites

| Suite | Focus | Quality |
|-------|-------|---------|
| `e2e-security.ts` | Permission/scope enforcement, cross-owner isolation | Excellent |
| `e2e-disputes.ts` | Work dispute lifecycle | Good |
| `e2e-federation.ts` | Multi-node peering | Good |
| `e2e-hooks.ts` | Event hook system | Good |
| `e2e-extensions.ts` | V8 isolate sandbox | Good |
| `e2e-mcp.ts` | Model Context Protocol | Good |
| `e2e-concurrency.ts` | Race conditions | Good |
| `e2e-anonymous.ts` | Unauthenticated access | Good |
| `e2e-phase0.ts` | Schema locking, CSM, consent | Good |
| `e2e-storage-visibility.ts` | Consent-based data access | Good |
| `e2e-profile-tabs.ts` | Profile UI (59 KB, very large) | Comprehensive |

### 3.3 Browser E2E (Playwright)

| Spec | Focus |
|------|-------|
| `libs.spec.ts` | Client library functionality |
| `profile-chat-sessions.spec.ts` | Chat UI interactions |
| `profile-portfolio.spec.ts` | Portfolio management UI |
| `profile-wallet.spec.ts` | Wallet operations UI |

### 3.4 CI Runner (`test/run-e2e-ci.ts`)

Sophisticated CI orchestrator:
- Auto-starts/stops server for tests
- Configurable via environment variables
- Parses test output for results
- Graceful shutdown with SIGTERM/SIGKILL fallback
- Summary table of all suite results

## 4. Test Quality Issues

### 4.1 Anti-Patterns Found

| Issue | Description | Severity |
|-------|-------------|----------|
| No inter-test cleanup | Resources accumulate during suite; relies on final GDPR delete | Medium |
| Manual test harness | Custom `test()` and `assert()` instead of framework | Low |
| Hardcoded ports | Default `localhost:40251` with env var fallback | Low |
| Brittle assertions | Many tests check only `body.ok === true` | Medium |
| Limited error case coverage | Most tests check happy path only | Medium |
| No external service mocking | E2E hits real storage, auth, federation | Low (intentional) |

### 4.2 Missing Test Scenarios

| Scenario | Type Needed | Priority |
|----------|-------------|----------|
| Malformed JSON requests | Unit/E2E | P1 |
| Missing required headers | Unit/E2E | P1 |
| Concurrent write conflicts | E2E | P2 |
| Rate limiting exhaustion | E2E | P2 |
| CSP header verification | E2E | P2 |
| Pagination boundary conditions | Unit | P2 |
| Large payload handling | E2E | P3 |
| Performance/load testing | Dedicated | P3 |

## 5. Code Coverage

### 5.1 Configuration

```typescript
// vitest.config.ts
coverage: {
  provider: 'v8',
  include: ['src/**/*.ts'],
  exclude: ['src/**/__tests__/**', 'src/cli/**'],
  reporter: ['text', 'text-summary', 'lcov'],
  reportsDirectory: './coverage',
}
```

### 5.2 Assessment

- Coverage configured but **no enforcement thresholds**
- No coverage gates in CI/CD (no CI configured)
- CLI code excluded from coverage (acceptable)
- Test files excluded (correct)

**Recommendation:** Set minimum coverage thresholds (70% lines, 60% branches) and enforce in CI.

## 6. Linting

### 6.1 ESLint Configuration

```javascript
// eslint.config.js
- ESLint recommended rules
- TypeScript ESLint configs
- `any` types: warn only (not error)
- Unused vars: ignored if prefixed with `_`
- Test files excluded from linting
```

### 6.2 Missing Tools

| Tool | Purpose | Status |
|------|---------|--------|
| Prettier | Code formatting | Not configured |
| Pre-commit hooks | Enforce lint/type-check | Not configured |
| GitHub Actions | Automated testing | Not configured |
| Dependency audit | `pnpm audit` in CI | Not configured |

## 7. OpenAPI Specification Analysis

### 7.1 Overview

| Metric | Value |
|--------|-------|
| File | `openapi.yaml` (10,665 lines) |
| Paths | 196 |
| Operations | 235 |
| Tags | 22+ categories |
| Auth schemes | 3 (Bearer, Signature, OTK) |

### 7.2 API Design Quality

**Strengths:**
- Standardized `AimeatEnvelope` response structure with `ok`, `data`, `error`, `hints`
- 15+ well-defined error codes (AUTH_REQUIRED, ACCESS_DENIED, NOT_FOUND, etc.)
- HATEOAS hints for discoverability
- Three-tier security scheme (JWT, Ed25519 signature, OTK)
- Comprehensive schemas for all major entities

**Weaknesses:**

| Issue | Description | Impact |
|-------|-------------|--------|
| Missing response schemas | Some 200/201 responses use inline or generic `data` | Medium |
| Inconsistent field naming | `ghii` vs `username`, `gaii` vs `agent_gaii` | Low |
| No pagination standard | Mix of `limit/offset` and `page` | Medium |
| No version changelog | No documented breaking changes | Medium |
| Missing payload limits | Max body size, key length, etc. not documented | Low |
| Timestamp inconsistency | Mix of `date-time` format and plain `string` | Low |
| No parameter documentation | Some query filters described loosely | Low |

### 7.3 Schema Quality

**Well-defined schemas:**
- WorkRecord (with status enum: 12 states)
- DisputeStatus, DisputeEventType (13 types)
- ConsentGrant with recipient patterns
- DirectoryEntry, DirectorySearchResult
- TotpSetupResponse
- CsmDefinition with semantic annotations
- Extension runtime schemas

**Incomplete schemas:**
- Some endpoints reference generic data object without structure
- Request/response headers not documented (Content-Type, X-Request-ID)
- No field length/range constraints documented

## 8. Summary

### Test Maturity Assessment

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Unit tests | 7/10 | Good core coverage, gaps in services/utils |
| E2E tests | 8/10 | Comprehensive 19-suite coverage |
| Browser E2E | 6/10 | 4 Playwright specs, limited scope |
| Integration | 5/10 | Only 2 database-specific files |
| CI/CD | 2/10 | Runner exists but no pipeline configured |
| Coverage | 5/10 | Configured, no thresholds enforced |
| Linting | 6/10 | ESLint configured, no Prettier/hooks |
| API spec | 7/10 | Comprehensive but some documentation gaps |
| **Overall** | **7/10** | Solid foundation, needs CI/CD and coverage gates |
