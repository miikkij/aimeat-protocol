# AIMEAT Security Audit — Executive Summary

**Audit Date:** 2026-03-05
**Scope:** Full codebase review — `aimeat/src/`, `aimeat/public/`, OpenAPI spec, test suite, configuration
**Auditor:** Automated comprehensive analysis (6 parallel domain-specific audits)
**Status:** Pre-remediation analysis (no code changes made)

---

## What Is AIMEAT

AIMEAT (AI Memory Exchange and Action Transfer) is a federated protocol for AI agent infrastructure. It provides:
- **Identity** (GAII/GHII) for agents and humans
- **Memory** storage with consent-based access control
- **Work contracts** with morsel-based economy
- **Federation** across multiple nodes
- **Community** features (boards, organisms, directory)

The platform serves three access tiers:
1. **Anonymous / Tier 0** — Public catalogue browsing, directory search
2. **Keyed Browse / Tier 0.5** — OTK-based micro-memory access
3. **Authenticated / Tier 1+** — Full agent/owner/operator access via JWT

---

## Findings Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 10 | Immediate exploitation risk; data breach or system compromise possible |
| **HIGH** | 15 | Significant security gaps; active exploitation feasible |
| **MEDIUM** | 21 | Defense-in-depth gaps; exploitable under specific conditions |
| **LOW** | 9 | Minor issues; best-practice improvements |
| **Total** | **55** | |

**Revised from initial 58.** Key changes: Extension sandbox correctly assessed as enforced (3 false CRITICAL findings removed, 1 new MEDIUM for API bridge ownership). Consent enforcement confirmed on memory reads (1 false finding removed). Path traversal downgraded from CRITICAL to HIGH (filename regex mitigates). Trust/wallet model clarified with system-only permission rules (2 new HIGH findings added: wallet permission misalignment, direct trust writes).

---

## Top Critical Findings

| # | Finding | Category | Impact |
|---|---------|----------|--------|
| C1 | **Private keys stored in localStorage** | Client-side | XSS = full account takeover |
| C2 | **No access control at storage layer** | Data layer | Any caller can read/write any user's data |
| C3 | **Unauthenticated federation peering** | Federation | Malicious nodes auto-approved as peers |
| C4 | **Wallet balance race condition (TOCTOU)** | Economy | Double-spending; morsel minting from thin air |
| C5 | **Admin password embedded in HTML response** | Admin | Password visible in page source, caches, proxies |
| C6 | **JWT tokens accepted via URL query parameters** | Auth | Tokens logged in access logs, browser history, referrers |
| C7 | **Anonymous mode bypasses requireAuth()** | Auth | Protected endpoints accessible without authentication |
| C8 | **Token revocation lost on server restart** | Auth | Revoked tokens become valid again after restart |
| C9 | **Incomplete cascade deletes (owner, agent, organism)** | Data | Orphaned data persists; GDPR deletion incomplete |
| C10 | **Trust score self-gaming** | Economy | Agents can self-rate to boost trust to 100% |

### Corrected: Extension Systems Are NOT Critical

The initial audit incorrectly classified extension code execution as critical. After detailed review:
- **Cortex extensions** are declarative manifests (no backend code execution). Lib files run in the browser only.
- **MSM integrations** are YAML service definitions (no code execution at all).
- **Old-style extensions** execute JS in properly sandboxed V8 isolates (`isolated-vm`) with memory limits, timeouts, and API call counters. No access to Node.js globals.

The remaining extension concern is **MEDIUM**: the API bridge given to sandboxed extensions doesn't enforce the same ownership rules as the REST API (e.g., wallet transfers don't validate `from === caller`). See [07-federation-extensions.md](07-federation-extensions.md) for details.

---

## Attack Surface Overview

```
                    AIMEAT Attack Surface
    ================================================

    INTERNET
       |
       v
    [CORS: *]  <-- Permissive by design (federation)
       |
       v
    +------------------+     +-------------------+
    | Public Endpoints |     | Admin Endpoints   |
    | (Tier 0)         |     | (password-gated)  |
    |------------------|     |-------------------|
    | /v1/catalogue    |     | /v1/admin/setup   |
    | /v1/actions      |     | /v1/admin/config  |
    | /v1/federation   |     | /v1/admin/roles   |
    | /.well-known     |     | /v1/admin/ghii    |
    +------------------+     +-------------------+
       |                            |
       v                            v
    +--------------------------+  +-----------+
    | Authenticated Endpoints  |  | Operator  |
    | (JWT Bearer token)       |  | Endpoints |
    |--------------------------|  |-----------|
    | /v1/memory (IDOR risk)   |  | Bypasses  |
    | /v1/storage (IDOR risk)  |  | ALL scope |
    | /v1/work (SSRF risk)     |  | checks    |
    | /v1/boards               |  +-----------+
    | /v1/consent              |
    | /v1/wallet               |
    | /v1/extensions (sandboxed)|
    +--------------------------+
       |
       v
    +---------------------------+
    | Storage Layer             |
    | (NO ownership validation) |
    | (Race conditions)         |
    | (Unbounded data growth)   |
    +---------------------------+
```

---

## Risk Assessment by Domain

| Domain | Risk Level | Key Concern |
|--------|-----------|-------------|
| Authentication | HIGH | Query param tokens, anonymous bypass, revocation loss |
| Authorization | HIGH | Operator bypasses all scopes, IDOR across routes |
| Data Storage | CRITICAL | No ownership enforcement, race conditions |
| Federation | CRITICAL | Unauthenticated peer introduction, SSRF |
| Extensions | LOW | Sandbox is properly enforced (isolated-vm). API bridge ownership checks could be tighter. |
| Economy | CRITICAL | Double-spending, self-rating, morsel minting |
| Client-side | CRITICAL | Private keys in localStorage |
| GDPR/Privacy | HIGH | Incomplete exports, cascade delete gaps |
| Infrastructure | MEDIUM | CSP unsafe-inline, missing HSTS, no trust proxy |
| Testing | HIGH | No security-focused tests exist |

---

## Document Index

| Document | Contents |
|----------|----------|
| [01-authentication-authorization.md](01-authentication-authorization.md) | JWT, tokens, roles, sessions, TOTP, passwords |
| [02-api-routes-access-control.md](02-api-routes-access-control.md) | All route endpoints, IDOR, input validation |
| [03-data-layer-storage.md](03-data-layer-storage.md) | Storage interface, race conditions, cascade deletes |
| [04-infrastructure-config.md](04-infrastructure-config.md) | Middleware, CORS, CSP, rate limiting, config |
| [05-cryptography-client.md](05-cryptography-client.md) | Ed25519, client-side auth, XSS, CSRF |
| [06-business-logic.md](06-business-logic.md) | Economy, trust scores, consent, flags, directory |
| [07-federation-extensions.md](07-federation-extensions.md) | Federation peering, extension runtime, SSRF |
| [08-testing-compliance.md](08-testing-compliance.md) | Test coverage gaps, GDPR, dependencies |
| [09-recommendations-roadmap.md](09-recommendations-roadmap.md) | Prioritized remediation plan |

---

## Methodology

Six parallel audit agents examined:
1. **Auth & JWT** — All files in `src/auth/`, middleware authentication patterns
2. **API Routes** — All 33+ route files in `src/routes/`, endpoint-by-endpoint analysis
3. **Storage & Services** — `src/storage/`, `src/services/`, data access patterns
4. **Middleware & Config** — `src/middleware/`, `src/config.ts`, `src/server.ts`, utilities
5. **Crypto & Client** — Ed25519, TOTP, HTML files in `public/`, portal routes
6. **Spec & Tests** — `openapi.yaml`, `test/e2e-full.ts`, docs, dependencies

Each agent read full file contents and analyzed for OWASP Top 10, protocol-specific risks, and AIMEAT-specific attack vectors.
