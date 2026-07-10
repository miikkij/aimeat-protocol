# Security Development DNA

**This is mandatory reading before changing any route, auth, storage, federation, extension, or AI path.**
It encodes *how AIMEAT stays secure while staying flexible* — the same node code runs a wide-open
single-user localhost node **and** a hardened multi-tenant public node. Security must be **posture-driven
config**, never a fork of the code.

> Principle: **flexible by configuration, secure by default on the public internet, functionality never
> reduced.** Anything whose safe value differs between localhost and public goes in `.env.example` with a
> safe *public* default and a documented *local* override — not hardcoded, not removed.

---

## 1. How AIMEAT actually works (the trust model you are defending)

Every request runs as exactly one **principal**. Get the principal + its trust tier right and most bugs disappear.

| Principal | Identity | Trust | Owns / can touch |
|---|---|---|---|
| **Operator** | owner with `operator` role | Highest — runs the node | Admin surface, mint, config, peers |
| **Owner (GHII)** | `owner@node` | Full over **their own** data | All their memory/files/wallet/agents/apps |
| **Agent (GAII)** | `agent#owner@node` | Scoped, owner's tool | Only what the owner's scopes allow, in the owner's namespace |
| **Ecosystem app (GEAI)** | `eco:app#owner@node` | Scoped external principal | Its `eco:` namespace + owner-granted data areas |
| **App grant** | role `app`, `sub`=owner GHII | Scoped, third-party code in the owner's browser | Exactly the scopes the owner approved, **writing into the owner's namespace** |
| **Federated peer** | another node | Zero-trust until **Ed25519-verified** + tiered | Signed replication/settlement/messages per tier |
| **Anonymous** | shared injected identity (opt-in mode) | Lowest | Only `anonymous.*`; never private data |

**The boundaries that must never leak:**

1. **Cross-owner is a hard wall.** Owner B can never read/write owner A's data. Enforced three ways and all three must stay intact: (a) **namespace** — `getMemory(gaii, key)` is a composite-key lookup scoped to the caller's resolved identity; (b) **visibility/consent** — a `private` record with no consent grant is denied to non-owners (`services/access-guard.ts`); (c) **encryption at rest** — secrets are AES-256-GCM (`services/encryption.ts`), so even a raw DB read yields ciphertext.
2. **Owner ↔ their own agents/apps is a *scope* boundary, not a wall.** An app/agent token resolves to the owner's GHII (`resolveIdentity` returns `sub` for non-owner sessions), so its writes land **in the owner's namespace**. That is by design — but it means **anything the server later reads and trusts from that namespace is attacker-influenceable by a granted app/agent** unless it is protected. See Invariant 2.
3. **Node ↔ peer is signature-gated.** Federation auth lives entirely in the handlers (there is no auth middleware on `/v1/federation/*`). Every inbound peer endpoint must verify a signature. See Invariant 5.
4. **Extension sandbox / app origin are isolation boundaries.** Extensions run in QuickJS with their own `ext:` namespace, CPU/memory caps, and owner-scoped secrets; published apps run on an isolated `*.apps.<host>` origin and get a scoped grant token, never the session.

---

## 2. The ten invariants (the DNA — every change must preserve these)

### 1. Authorize against the *resolved* identity, never a client-supplied id
Every route that stores/reads by identity MUST call `resolveIdentity(req.auth!, config.nodeId)` and
authorize against **that** — never raw `req.auth.sub`, never a `req.params`/`req.body`/`req.query`
`id`/`owner`/`gaii`. Load the object, then check ownership/membership **before** the read/mutate.
*Check:* "If I change the id in the request to someone else's, do I get 403?" Write that test.

### 2. Server-trusted config/secrets must not live in a principal-writable namespace
If the server **reads a value and acts on it** (a URL it will fetch, a credential, an autonomy policy, a
budget counter, a public-listing flag), that key must be **unreachable by a scoped app/agent**. Two
accepted patterns: (a) store it under a **synthetic system identity** the way network policy / site
templates do (`__network_policy__`, `SITE_OWNER_GAII`) so no owner-scoped principal can address it; or
(b) enforce a **reserved-key denylist** on `POST/PUT /v1/memory` for non-owner-session principals
(`openrouter.*`, `ai-usage.*`, `profile.*`, …).
*Why:* an app the owner granted `memory:write` can otherwise poison the owner's own config (e.g. redirect
where the AI key is sent). **Never mix user-data and security-load-bearing config in the same free-write namespace.**

### 3. All outbound HTTP goes through `safeFetch` (redirect-revalidating)
Any `fetch` whose URL is not a compile-time constant MUST use `safeFetch` (`utils/url-validator.ts`),
which re-validates **every redirect hop** — not just `validateOutboundUrl` on the first hop, and never a
raw `fetch(url)` with default `redirect:'follow'`. A validated host can 3xx-bounce to an internal target.
The strictness of *what counts as internal* is posture-driven (Invariant "posture"): localhost egress is
allowed on a local node (so it can reach a local Ollama/LM Studio), blocked on a public node.
*Especially:* never fetch a URL taken verbatim from a peer/agent/user response without validation.

### 4. Every state-changing route has an explicit scope/role gate
A mutation with only `requireAuth()` is a privilege-escalation hole for `app`/`agent` tokens (they hold a
session but a *narrow* scope). Add `requireScope('domain:write')` / `requireRole(...)` to **every**
POST/PUT/PATCH/DELETE and every sensitive GET. New scoped surface (schedules, workflows, capabilities,
tasks) must gate per kind (`ai:use`, `task:write`, …). *Check:* grep the router for `requireScope`; count
must equal the number of mutating handlers.

### 5. Federation is zero-trust: signatures are mandatory, never conditional
Every inbound `/v1/federation/*` endpoint that mutates or discloses MUST verify an **Ed25519 signature**
from an **already-approved** peer, using the peer's **previously-established** key. Rules:
- Never `if (signature && peer.publicKey) verify(...)` — an attacker just omits the signature. Verify **unconditionally**; reject when absent.
- Never overwrite an active peer's key without a signature from the **current** key.
- Never derive trust (`isGenesis`, tier, admission) from a **body-supplied** `node_url`/`node_id` — those are claims, not proof.
- `requesting_node` naming an active peer is a *claim*, not authentication.

### 6. `optionalAuth` injects an identity — never gate on `if (!req.auth)`
`optionalAuth()` runs globally and, in anonymous mode, injects a shared anonymous identity, so `req.auth`
is truthy even when unauthenticated. To require real auth use `requireAuth()`; to detect anonymity check
`req.auth.anonymous === true`. `members`-visibility reads must confirm `req.auth && req.auth.anonymous !== true`.

### 7. Secrets: encrypt at rest, never return/log, allowlist the destination
Store secrets only via `encryption.ts` (AES-256-GCM). Never return a decrypted secret in a response or a
log line. The **destination** a secret is transmitted to must be an allowlisted host (ties to Invariants 2 & 3).
`AIMEAT_ENCRYPTION_KEY` must be set on any node holding secrets (keys, TOTP) — a public node without it must fail loudly.

### 8. Least privilege by default; consent text must convey real capability
App/agent default scopes stay minimal; powerful scopes (`ai:use`, `task:write`, `memory:delete`) are
explicit and separately consented. When a scope's real blast radius exceeds its label ("write your data"
also lets an app redirect your AI key), fix the boundary (Invariant 2) — don't rely on the label.

### 9. Prove multi-tenant isolation with a test, every time
Every feature touching identity ships with two E2E checks (Rule 1): **cross-owner** ("B touches A's
object → 403") and **cross-scope** ("token with only scope X attempts scope Y → 403"). A feature isn't
done until both pass on SQLite **and** MongoDB.

### 10. Security-relevant differences are posture config, not code forks
If a safe value differs local vs public, add it to `.env.example` with a safe **public** default and a
documented local override. Never hardcode a permissive value, never delete functionality to be safe. See §3.

---

## 3. Security posture: one codebase, localhost-flexible → public-strict

AIMEAT must run wide-open on localhost (dev, personal node, cabin, IoT) **and** locked-down on the public
internet, from the **same code**. Model this as a **posture** derived from the deployment, with every knob
individually overridable so unusual use cases stay possible.

**Derivation (recommended):** `AIMEAT_SECURITY_PROFILE = local | public`.
Default to `local` when `AIMEAT_BASE_URL` is `http://localhost`/`127.0.0.1`/an RFC1918 host **or**
`AIMEAT_NODE_TYPE=personal`; default to `public` otherwise (https + public hostname). The profile only sets
**defaults** for the knobs below — any explicit `AIMEAT_*` var always wins.

| Knob (env) | `local` default | `public` default | Controls |
|---|---|---|---|
| `AIMEAT_ALLOW_PRIVATE_EGRESS` | `true` | `false` | Whether server-side fetches (AI provider `baseUrl`, webhooks, extension `ctx.fetch`) may target loopback/RFC1918/link-local. Local: reach a local Ollama/LM Studio. Public: block internal SSRF + cloud metadata. |
| `AIMEAT_AI_PROVIDER_ALLOWLIST` | *(empty = any)* | `openrouter.ai,api.openai.com,…` | Hosts an AI `baseUrl` may point at. Public restricts where a (decrypted) key can be sent. |
| `AIMEAT_ANONYMOUS` | may be `true` | **`false`** | Shared-identity anonymous mode — safe for single-user local, unsafe multi-tenant. |
| `AIMEAT_FEDERATION_AUTH_POLICY` | `disabled`/`all_peers` | `specific_peers` | Which peers may interact. (Signature verification itself is **always** on — that's code, not a knob.) |
| `AIMEAT_FEDERATION_OPEN_JOIN` | may be `true` | **`false`** | Self-admitting `visiting` peers. |
| `AIMEAT_CORS_ALLOWED_ORIGINS` | `*` | explicit origins | Origin allowlist. (API is Bearer-token; the only cookie, `aimeat_rt`, is `SameSite=strict` + `/v1/auth`-scoped + custom-header-guarded — so CORS is defense-in-depth, but `*` is still discouraged on public.) |
| `AIMEAT_STATS_ACCESS` / `AIMEAT_METRICS_ACCESS` | `public` | `authenticated`/`operator` | Don't leak node internals publicly. |
| `AIMEAT_SETUP_ALLOWED_IPS` | *(open)* | `127.0.0.1,::1` | Restrict the first-owner setup wizard. |
| `AIMEAT_EXT_INSTALL_ROLE` | `owner` | `operator` | Who may install sandboxed extensions. |
| `AIMEAT_DEFAULT_AGENT_SCOPES` | permissive ok | minimal (`memory:read,catalogue:read`) | Ambient agent scope floor. |
| `AIMEAT_KEY_PASSPHRASE` / `AIMEAT_ENCRYPTION_KEY` | optional | **required** | Node key + secret encryption at rest. |

**Reserved-key guard (Invariant 2) is NOT a posture knob — it is always on.** Even a local node with
third-party apps benefits; the denylist is a code invariant.

**Startup self-check (recommended):** on boot, if the profile resolves to `public`, **warn loudly (or
refuse to start)** on any unsafe combination: `AIMEAT_ANONYMOUS=true`, `AIMEAT_ALLOW_PRIVATE_EGRESS=true`,
`AIMEAT_FEDERATION_OPEN_JOIN=true`, missing `AIMEAT_ENCRYPTION_KEY`, `AIMEAT_CORS_ALLOWED_ORIGINS=*` with
credentials, or `AIMEAT_STATS_ACCESS=public`. Make insecure-on-the-internet a conscious override, not an accident.

> Implementation note: the `AIMEAT_SECURITY_PROFILE`, `AIMEAT_ALLOW_PRIVATE_EGRESS`, and
> `AIMEAT_AI_PROVIDER_ALLOWLIST` knobs above are the **proposed** wiring — they land in `config.ts` +
> `.env.example` together with the egress/reserved-key fixes, so the doc and the enforcement ship as one change.

---

## 4. Per-change security checklist (paste into the PR)

Before merging any change to `src/routes/`, `src/auth/`, `src/services/`, `src/storage/`, federation, extensions, or an AI path:

- [ ] **Identity:** uses `resolveIdentity()`; authorizes against it before every read/mutate; no client id trusted (Inv. 1).
- [ ] **Ownership test:** added a cross-owner "→403" E2E and a cross-scope "→403" E2E (Inv. 9); both green on SQLite + MongoDB.
- [ ] **Scope/role:** every mutating handler has `requireScope`/`requireRole` (Inv. 4).
- [ ] **Reserved keys:** if the server reads-and-trusts any memory key you introduced, it's system-namespaced or denylisted (Inv. 2).
- [ ] **Egress:** any non-constant outbound URL uses `safeFetch`; private-egress respects posture (Inv. 3).
- [ ] **Federation:** new inbound peer endpoints verify a signature unconditionally from an approved peer (Inv. 5).
- [ ] **Anonymous:** no `if(!req.auth)` gate; `members` reads check `!req.auth.anonymous` (Inv. 6).
- [ ] **Secrets:** encrypted at rest, never returned/logged, destination allowlisted (Inv. 7).
- [ ] **Config:** any security value that differs local↔public is in `.env.example` with a safe public default (Inv. 10).
- [ ] **Spec + campsite:** `openapi.yaml` marks the route's auth; fixed any adjacent gaps you passed.
- [ ] Ran `/security-review` on the diff (or the branch security review) for anything non-trivial.

---

## 5. Where the live findings live

The point-in-time vulnerability audit (2026-07-10) that motivated this DNA is tracked separately (it
contains exploit detail — keep it out of the public repo). Fix order and status live with the developer.
This document is the **forward-looking** contract: new code must not reintroduce any invariant above.

*Related:* [security.md](security.md) (auth/validation/XSS/rate-limiting reference) ·
[identity-model.md](identity-model.md) (GHII/GAII/GEAI) ·
[extension-memory-architecture.md](extension-memory-architecture.md) (namespaces) ·
[environment-configs.md](environment-configs.md) (node types) · [testing-requirements.md](testing-requirements.md) (E2E rules).
