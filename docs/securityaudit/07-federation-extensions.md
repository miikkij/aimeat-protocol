# 07 — Federation & Extensions

## Architecture Clarification

AIMEAT has three separate extension/integration systems. Understanding what each does is critical to evaluating security correctly:

| System | Code Path | Executes JS on Server? | Purpose |
|--------|-----------|----------------------|---------|
| **Cortex** | `cortex.ts`, `cortex-manifest.ts` | **No** | Declarative manifests: schemas, prompts, board templates, seed data, ontologies. Lib files are served as static JS to the browser via `/v1/cortex/:name/libs/:libFile`. |
| **MSM** | `msm.ts`, `msm-parser.ts` | **No** | YAML service definitions describing external API integrations (endpoints, auth types, input/output schemas). Purely declarative. |
| **Old Extensions** | `extensions.ts`, `extension-runtime.ts` | **Yes — in V8 isolate sandbox** | Operator-installed scripts executed via `isolated-vm` with memory limits, execution timeouts, and API call counters. |

### Sandbox Assessment — Old Extensions Runtime

The V8 isolate sandbox in `extension-runtime.ts` is **properly implemented**:

| Security Control | Status | Detail |
|-----------------|--------|--------|
| V8 Isolate | **Enforced** | `new ivm.Isolate({ memoryLimit: limits.memoryMb })` |
| Execution timeout | **Enforced** | `compiled.run(context, { timeout: limits.timeoutMs })` |
| API call counter | **Enforced** | `counter.count > maxApiCalls` check on every bridge call |
| No Node.js globals | **Enforced** | Fresh context with only explicit `ivm.Reference` bridges |
| No `fetch`/`require`/`process` | **Enforced** | Not available inside isolate |
| Cleanup | **Enforced** | `isolate.dispose()` in `finally` block |
| Installation auth | **Enforced** | `requireAuth(), requireRole('operator')` |
| Execution auth | **Enforced** | `requireAuth()` on `/v1/ext/:extName/:actionId` |

### Cortex Lib Safety Patterns — Context

The `UNSAFE_PATTERNS` in `cortex-manifest.ts` check lib files for `eval()`, `new Function()`, etc. These produce **warnings, not errors**. Since Cortex lib files run in the **browser** (not on the server), these patterns are informational — they help operators review client-side code for potential XSS or data exfiltration. The browser's same-origin policy and CSP provide the actual runtime protection.

---

## 7.1 Extension API Bridge — Missing Ownership Enforcement

**Severity: MEDIUM**
**Files:** `src/routes/extensions.ts:336-434`

The API bridge given to old-style extension scripts provides wallet, trust, and consent operations without enforcing that the caller owns the target GAII. These bridges should enforce the **same permission rules** as the corresponding REST API endpoints.

**Current state — wallet bridge:**
```typescript
wallet: {
  transfer: async (from, to, amount, reason) => {
    // Transfers morsels from ANY gaii to ANY gaii
    // No check that from === ctx.caller.gaii
    await storage.addTransaction({ gaii: from, amount: -amount, ... });
    await storage.addTransaction({ gaii: to, amount: amount, ... });
  },
  hold: async (from, amount, reason) => {
    // Holds escrow from ANY gaii
    await storage.createEscrowHold({ fromGaii: from, ... });
  },
  getBalance: async (gaii) => {
    // Reads ANY agent's balance
    return agent?.morselBalance ?? 0;
  },
}
```

**Current state — trust bridge:**
```typescript
trust: {
  adjust: async (gaii, delta, reason) => {
    // Adjusts ANY agent's trust score
    await storage.updateAgent(gaii, { trustScore: newScore });
  },
}
```

**What the REST API does:** The normal wallet/trust endpoints validate that the authenticated user owns the resource being modified. The extension bridge should do the same.

**Recommendation:** Enforce `from === ctx.caller.gaii` for wallet debits. Restrict `trust.adjust` to the caller's own agents or require operator role. Align extension bridge permissions with the REST API's permission model.

---

## 7.2 Extension Hook System — Webhook SSRF

**Severity: HIGH**
**Files:** `src/services/hooks.ts:44-56`

Extension hooks (`pre_agent_registration`, `pre_board_post`, `pre_federation_peer`, etc.) call external webhook URLs with no URL validation:

```typescript
const response = await fetch(webhookUrl, {
    method: 'POST',
    body: JSON.stringify({ hook: hookName, context, node_id: config.nodeId }),
    signal: AbortSignal.timeout(10_000),
});
```

The `webhookUrl` comes from an action record in storage. The 10-second timeout prevents indefinite hangs but doesn't prevent the request from reaching internal services.

**Attack scenario:**
1. Register an action with `webhookUrl: "http://169.254.169.254/latest/meta-data/"`
2. Configure it as a hook for `pre_agent_registration`
3. Every new agent registration triggers a request to the cloud metadata endpoint
4. Response data is logged in hook rejection messages

**Also affects:** Board subscriber `callbackUrl` (boards.ts) — same pattern.

**Recommendation:** Validate all outbound webhook URLs against private IP ranges, localhost, and cloud metadata endpoints. Apply same validation to federation URLs and work forwarding URLs.

---

## 7.3 Unauthenticated Federation Peer Introduction

**Severity: CRITICAL**
**Files:** `src/routes/federation.ts:67-130`

POST `/v1/federation/peer/introduce` requires **no authentication**:

```
POST /v1/federation/peer/introduce
{
  "node_id": "evil-node",
  "node_url": "https://evil.com",
  "public_key": "attacker-key",
  "role": "contributor"
}
```

Contributors are **auto-approved** and immediately added to the peer list.

**No signature verification:** The public key in the request is accepted without validation. Anyone can claim any node identity.

**Recommendation:**
- Require all peer introductions to be signed with the introducing node's private key
- Never auto-approve peers; require operator confirmation
- Verify public key ownership via challenge-response
- Rate-limit peer introduction requests

---

## 7.4 Federation SSRF

**Severity: HIGH**
**Files:** `src/routes/federation.ts:206-216`

Federation endpoint fetches arbitrary URLs without validation against private IP ranges, localhost, or cloud metadata endpoints.

**Also affects:**
- Work forwarding (`src/routes/work.ts:135-144`) — sends full request bodies to peer URLs
- Webhook notifications — callback URLs are external and unvalidated

**Recommendation:** Implement a shared URL validation utility that blocks requests to:
- `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- `localhost`, `::1`
- `169.254.169.254` (cloud metadata)
- Non-HTTP(S) protocols

Apply it to all outbound fetch calls (federation, hooks, webhooks, work forwarding).

---

## 7.5 Work Request Forwarding — Request Body Relay

**Severity: HIGH**
**Files:** `src/routes/work.ts:135-144`

When work requests target a federated peer, the full request body is forwarded:

```typescript
const resp = await fetch(`${resolved.nodeUrl}/v1/work/request`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

**Risks:**
- Request body may contain sensitive agent data
- If peer URL is compromised (via unauthenticated peer introduction), data goes to attacker
- No request signing — peer cannot verify the forwarding node's identity
- Response from peer is returned to the original requester without validation

**Recommendation:**
- Sign forwarded requests with the node's Ed25519 key
- Validate peer responses (check signatures)
- Sanitize forwarded payloads (remove internal-only fields)
- Verify peer identity before forwarding

---

## 7.6 YAML Parsing Security

**Severity: LOW**
**Files:** `src/routes/extensions.ts:61`, `src/routes/cortex.ts:87`, `src/services/msm-parser.ts:168`

Multiple routes parse user-supplied YAML using the `yaml` package. The `yaml` npm package (v2+) is safe by default — it does NOT support `!!js/function` or other dangerous YAML tags. It is not vulnerable to billion-laughs attacks.

**Status:** Low risk with current parser. Would become a risk if the parser is changed to `js-yaml` with unsafe schema options.

---

## 7.7 Federation Peer Discovery Information Leak

**Severity: LOW**
**Files:** `src/routes/federation.ts`

GET `/v1/federation/directory` is public and returns all peer information including node URLs, public keys, and roles.

**Acceptable risk:** This is intentional for federation discovery. However, it reveals the full network topology.

**Recommendation:** Consider optional authenticated-only peer directory for sensitive deployments.
