# 02 — API Routes & Access Control

## Route Inventory

33+ route files serve 88+ endpoints. Authentication requirements by tier:

| Tier | Auth | Endpoint Count | Examples |
|------|------|---------------|----------|
| 0 (Public) | None | 15+ | `/v1/catalogue`, `/v1/actions` GET, `/v1/federation/directory` |
| 0.5 (Keyed) | OTK/access-code | 8+ | `/v1/mm`, `/v1/apps/:owner/:filename` |
| 1 (Agent) | JWT agent | 45+ | `/v1/memory`, `/v1/work`, `/v1/boards`, `/v1/wallet` |
| 1.5 (Owner) | JWT owner | 5+ | `/v1/personal/anchor`, `/v1/ghii` PUT |
| 2 (Operator) | JWT operator | 15+ | `/v1/admin/*`, `/v1/extensions` POST |

---

## 2.1 IDOR: Memory Access Without Ownership Validation

**Severity: CRITICAL**
**Files:** `src/routes/memory.ts:31-146`

Memory key is user-supplied in the request body. No validation that the authenticated agent owns the key being written or read. An agent can write to any memory key across all agents.

```typescript
const { key, value, visibility } = req.body;
const record = await storage.setMemory({ key, ownerGaii: gaii, value, ... });
```

**Attack:** POST `/v1/memory` with `key="hacker#attacker@node::secretkey"` overwrites another agent's memory.

**Recommendation:** Validate that the memory key's owner prefix matches `req.auth.sub` (the authenticated GAII).

---

## 2.2 IDOR: Storage File Access

**Severity: HIGH**
**Files:** `src/routes/storage-files.ts:105+`

Storage file GET endpoint returns files based on visibility flag. An agent can enumerate and download other agents' public files by guessing storage keys.

**Recommendation:** Add ownership validation. Only return files where `file.ownerGaii === req.auth.sub` OR where explicit consent exists.

---

## 2.3 Path Traversal in Apps Endpoint

**Severity: HIGH**
**Files:** `src/routes/apps.ts:92-134`

The filename parameter in GET `/v1/apps/:owner/:filename` is not sanitized for `..` sequences:

```typescript
const filename = req.params.filename as string;
const storageKey = `apps/${filename}`;
```

**Attack:** `GET /v1/apps/victim/../../attacker-gaii/private-file` could read arbitrary storage files.

**Mitigating factor:** The filename validation regex (`/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/`) blocks `/` and `..` characters, significantly reducing exploitability. Risk remains if URL-encoded `%2F` bypasses the regex after decoding.

**Recommendation:**
```typescript
if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
  return res.status(400).json(error(..., 'Invalid filename'));
}
```

---

## 2.4 Unauthenticated Federation Peer Introduction

**Severity: CRITICAL**
**Files:** `src/routes/federation.ts:67-130`

POST `/v1/federation/peer/introduce` requires NO authentication. Any attacker can introduce a malicious node:

```
POST /v1/federation/peer/introduce
{ "node_id": "evil-node", "node_url": "https://evil.com",
  "public_key": "...", "role": "contributor" }
```

Contributors are auto-approved and added to the peer list. Work requests may then be forwarded to the malicious node.

**No signature verification** on the public key provided.

**Recommendation:**
- Require cryptographic signature verification on peer introduction
- Never auto-approve peers
- All peer introductions should require operator approval

---

## 2.5 SSRF via Federation and Work Forwarding

**Severity: HIGH**
**Files:** `src/routes/federation.ts:206-216`, `src/routes/work.ts:135-144`

Federation fetches arbitrary URLs without validation:
```typescript
fetch(`${target_url}/.well-known/aimeat`)
```

Work forwarding sends request bodies to peer URLs:
```typescript
const resp = await fetch(`${resolved.nodeUrl}/v1/work/request`, { body: ... });
```

No validation against private IP ranges, localhost, or internal services.

**Recommendation:** Implement URL validation that blocks:
- `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- `localhost`, `::1`
- `169.254.169.254` (cloud metadata)
- Non-HTTP(S) protocols

---

## 2.6 Dev Mode Account Wipe Without Confirmation

**Severity: HIGH**
**Files:** `src/routes/ghii.ts:67-75`

In dev mode, registering an existing GHII silently deletes all agents and the old GHII without confirmation:
```typescript
for (const agent of oldAgents) {
    await storage.deleteAgent(agent.gaii);
}
```

**Risk:** If dev mode is accidentally left on in production, any attacker knowing an owner name can delete all their agents.

**Recommendation:** Remove silent deletion. Return a 409 conflict instead. Require explicit admin action for account reset.

---

## 2.7 Extension API Bridge — Missing Ownership Enforcement

**Severity: MEDIUM**
**Files:** `src/routes/extensions.ts:336-434`

**CORRECTED:** The initial audit incorrectly classified extension code execution as CRITICAL. After detailed review:
- **Old-style extensions** execute in properly sandboxed V8 isolates (`isolated-vm`) with memory limits, timeouts, API call counters, and no access to `fetch`, `require`, `process`, or Node.js globals.
- **Cortex** is declarative manifests only (no backend JS execution). Lib files run in the browser.
- **MSM** is declarative YAML (no code execution).
- The `UNSAFE_PATTERNS` in `cortex-manifest.ts` check browser-side lib files and produce informational warnings — this is appropriate.

**Actual concern (MEDIUM):** The API bridge given to old-style extensions provides wallet, trust, and consent operations without enforcing that the caller owns the target GAII. The extension bridge should enforce the same permission rules as the REST API endpoints. See [07-federation-extensions.md](07-federation-extensions.md) §7.1 for details.

**Recommendation:** Enforce `from === ctx.caller.gaii` for wallet operations. Remove `trust.adjust` entirely (trust is system-computed only). Align extension bridge permissions with the REST API model.

---

## 2.8 Anonymous Micro-Memory Writes

**Severity: HIGH**
**Files:** `src/routes/micro-memory.ts:132-150`

When anonymous mode is enabled, unauthenticated users can write to shared micro-memory sets via GET `/v1/mm?op=add`. No rate limiting per anonymous session.

**Recommendation:** Implement per-IP rate limits for anonymous writes. Consider requiring a CAPTCHA or proof-of-work for anonymous operations.

---

## 2.9 Board Auto-Creation Without Approval

**Severity: MEDIUM**
**Files:** `src/routes/boards.ts:122-134`

Posting to a non-existent board automatically creates it as a public board. No operator approval needed. An attacker can create boards with misleading names.

**Recommendation:** Require operator approval for board creation, or restrict auto-creation to the posting agent's namespace.

---

## 2.10 Webhook Notification Data Leakage

**Severity: MEDIUM**
**Files:** `src/routes/boards.ts:15-43`

Board subscriber `callbackUrl` is an external URL with no validation. The server sends POST requests to attacker-controlled URLs containing post metadata.

**Recommendation:** Validate callback URLs against allowed domains or require HTTPS. Rate-limit webhook deliveries.

---

## 2.11 Flag Appeal Authorization Bypass

**Severity: HIGH**
**Files:** `src/routes/appeals.ts:86-107`

Operators can appeal flags on content they don't own. Organism admins can moderate flags for content outside their organism.

**Recommendation:** Restrict appeals to content owners and direct organism admins only. Operators should not bypass content ownership checks.

---

## 2.12 Missing Rate Limiting on Critical Endpoints

| Endpoint | Attack Vector | Recommended Limit |
|----------|--------------|-------------------|
| `/v1/auth/challenge` | Owner name enumeration | 10/min per IP |
| `/v1/owners` POST | Account creation spam | 5/hour per IP |
| `/v1/ghii` POST | GHII creation spam | 5/hour per IP |
| `/v1/flags` POST | Coordinated flagging spam | 20/hour per agent |
| `/v1/wallet/request` | Morsel allowance spam | 1/hour per agent |
| `/v1/apps/:filename` GET | Access code brute force | 5 failures/min per IP |
| `/v1/mm` (access-code) | Access code guessing | 3 failures/min per IP |
| `/v1/appeals` POST | Appeal spam | 20/day per agent |
| `/v1/admin/setup` | Admin password brute force | 5/min per IP |
| TOTP verification | Code brute force | 5/min per user |

---

## 2.13 Owner/User Enumeration

**Severity: MEDIUM**
**Files:** `src/routes/owners.ts:98`

Error messages distinguish between "owner not found" (404) and authentication failure. This allows attackers to enumerate valid owner names.

```typescript
res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${req.params.name}`));
```

**Recommendation:** Return generic error messages that don't reveal whether an account exists. Use the same 404 response for both cases.

---

## 2.14 GHII Deletion Without Confirmation

**Severity: HIGH**
**Files:** `src/routes/admin-features.ts:78-86`

DELETE `/v1/admin/ghii/:ghii` deletes a user identity with a single request and no confirmation. Likely cascades to owner and agents.

**Recommendation:** Require a confirmation parameter (e.g., `?confirm=true`) and implement an undo window or soft-delete mechanism.

---

## 2.15 Unexamined Routes

The following route files were not fully examined and should be audited in a follow-up:

| File | Risk Area |
|------|-----------|
| `cortex.ts` | AI scaffolding — prompt injection risk |
| `csm.ts` | Community manifests — validation |
| `lib-*.ts` (6 files) | Client library APIs |
| `matches.ts` | Matching engine — privacy |
| `mcp.ts` | MCP connector — external integration |
| `msm.ts` | Morsel stream management |
| `push.ts` | Push notifications — SSRF risk |
| `realtime.ts` | Realtime sync — WebSocket security |
| `schemas.ts` | Schema management |
| `site.ts` | Site pages |
| `verification.ts` | Email verification |
| `wellknown.ts` | Well-known endpoints |
