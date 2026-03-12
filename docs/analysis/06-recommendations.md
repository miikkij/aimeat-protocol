# 06 — Recommendations

## Priority Levels

| Level | Meaning | Timeline |
|-------|---------|----------|
| P0 | Critical — security or data integrity risk | 1-2 weeks |
| P1 | High — significant quality or reliability improvement | 2-4 weeks |
| P2 | Medium — code quality and maintainability | 1-2 months |
| P3 | Low — nice-to-have improvements | Backlog |

---

## Security Recommendations

### P0 — Immediate

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| S1 | Change CSP `style-src 'unsafe-inline'` to `style-src 'nonce-${nonce}'` | Small | Eliminates style-based XSS vector |
| S2 | Add Subresource Integrity (SRI) to CDN script tags | Small | Mitigates CDN compromise risk |
| S3 | Verify admin panel has no form-based POST without CSRF protection | Small | Confirm CSRF safety |

### P1 — Short-Term

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| S4 | Implement distributed rate limiting (Redis/Consul backend) | Medium | Fleet-wide DDoS protection |
| S5 | Add `Permissions-Policy` security header | Small | Feature restriction |
| S6 | Add key rotation mechanism without service restart | Medium | Reduce key compromise blast radius |
| S7 | Run `pnpm audit` in CI/CD pipeline | Small | Automated vulnerability detection |
| S8 | Remove default scope fallback `['*']` for new JWTs | Small | Enforce least-privilege |

### P2 — Medium-Term

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| S9 | Auto-sanitize DataTable `_html` cells instead of trusting callers | Small | Defense in depth |
| S10 | Enforce TOTP 2FA for operator accounts | Medium | Protect admin access |
| S11 | Migrate hobbies.js from localStorage to centralized auth | Small | Consistent auth pattern |

---

## Code Quality Recommendations

### P0 — Immediate

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| Q1 | Add quota overage balance check before memory write (`routes/memory.ts:143-146`) | Small | Prevent writes beyond available balance |
| Q2 | Log federation sync errors instead of silent catch (`routes/federation-sync.ts`) | Small | Enable debugging of desync issues |

### P1 — Short-Term

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| Q3 | Extract shared `webhookFetch()` helper (from hooks.ts, personal-tunnel.ts, federation.ts) | Medium | Reduce 3x duplication |
| Q4 | Add SQLite indexes on frequently queried columns (`agents.owner`, `work.provider`, federation tables) | Small | Performance improvement |
| Q5 | Create typed SQLite row deserializer to replace 50+ `as Record<string, unknown>` casts | Medium | Type safety, maintainability |
| Q6 | Replace 30+ silent `.catch(() => {})` with `logger.warn()` | Medium | Improved debuggability |

### P2 — Medium-Term

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| Q7 | Split functions over 200 LOC (mcp.ts, knowledge.ts, federation-sync.ts, admin-extensions.ts) | Large | Testability, readability |
| Q8 | Extract admin route validators and file I/O helpers | Medium | Reduce complexity |
| Q9 | Add circuit breaker for federation peer calls | Medium | Resilience |
| Q10 | Consider OpenTelemetry for distributed tracing | Large | Observability in multi-node |

### P3 — Backlog

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| Q11 | Standardize GAII parsing to reject invalid formats instead of empty fallback | Small | Correctness |
| Q12 | Add runtime validation for config enum fields (e.g., `AIMEAT_MSM_INSTALL_ROLE`) | Small | Configuration safety |
| Q13 | Document architecture decisions (ADRs) | Medium | Knowledge transfer |

---

## Testing Recommendations

### P0 — Immediate

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| T1 | Set up CI/CD pipeline (GitHub Actions) with unit tests, lint, type-check | Medium | Automated quality gates |
| T2 | Add coverage thresholds (70% lines, 60% branches) and enforce in CI | Small | Prevent regression |

### P1 — Short-Term

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| T3 | Add unit tests for quota service edge cases | Small | Critical business logic coverage |
| T4 | Add unit tests for consent service matching | Small | GDPR-critical logic |
| T5 | Add unit tests for federation helpers | Medium | Federation reliability |
| T6 | Add malformed request / missing header tests | Small | Error handling validation |
| T7 | Add pre-commit hooks (lint + type-check) | Small | Catch issues before commit |

### P2 — Medium-Term

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| T8 | Improve E2E assertions (validate full envelope structure, not just `body.ok`) | Medium | Test quality |
| T9 | Add E2E cleanup between test phases (not just final GDPR delete) | Medium | Test isolation |
| T10 | Add Prettier for consistent formatting | Small | Code consistency |
| T11 | Add performance/load tests | Large | Capacity planning |

### P3 — Backlog

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| T12 | Add frontend component tests | Large | UI reliability |
| T13 | Add OpenAPI response schema validation in tests | Medium | API contract enforcement |
| T14 | Standardize pagination in OpenAPI spec | Medium | API consistency |

---

## Architecture Recommendations

### P1 — Short-Term

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| A1 | Document microservice boundaries for future scaling | Medium | Scaling readiness |
| A2 | Evaluate external message queue for federation/webhooks (RabbitMQ, Redis Streams) | Medium | Production reliability |

### P2 — Medium-Term

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| A3 | Add Redis/external store for session state, rate limiting, revocation cache | Large | Multi-instance support |
| A4 | Consider splitting SQLite/MongoDB storage providers by domain (~4,500 LOC each) | Medium | Maintainability |
| A5 | Add architecture diagrams (C4 model) to documentation | Medium | Developer onboarding |

### P3 — Backlog

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| A6 | Evaluate bundling strategy for production frontend (trade-off vs. no-build simplicity) | Medium | Performance |
| A7 | Add ARIA labels and screen reader testing for accessibility | Medium | Accessibility |
| A8 | Add OpenAPI changelog and version history | Small | API evolution tracking |

---

## Summary Matrix

| Category | P0 | P1 | P2 | P3 |
|----------|----|----|----|----|
| Security | 3 | 5 | 3 | 0 |
| Code Quality | 2 | 4 | 4 | 3 |
| Testing | 2 | 5 | 4 | 3 |
| Architecture | 0 | 2 | 3 | 3 |
| **Total** | **7** | **16** | **14** | **9** |

### Top 10 Actions (by impact/effort ratio)

1. **T1** — Set up CI/CD pipeline
2. **S1** — Fix CSP `style-src 'unsafe-inline'`
3. **Q2** — Log federation sync errors
4. **Q1** — Add quota overage balance check
5. **S2** — Add SRI to CDN scripts
6. **T2** — Enforce coverage thresholds
7. **Q6** — Replace silent catches with logging
8. **T7** — Add pre-commit hooks
9. **Q4** — Add SQLite indexes
10. **S7** — Run `pnpm audit` in CI
