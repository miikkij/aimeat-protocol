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

## 2. The sixteen invariants (the DNA — every change must preserve these)

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
done until both pass on PostgreSQL+Kysely **and** SQLite.

### 10. Security-relevant differences are posture config, not code forks
If a safe value differs local vs public, add it to `.env.example` with a safe **public** default and a
documented local override. Never hardcode a permissive value, never delete functionality to be safe. See §3.

---

### 11. The owner name is not a principal
`req.auth!.owner` carries the HUMAN's account name on every principal that belongs to them: an
app-grant token (`roles:['app']`), an ecosystem app, an agent JWT and an agent PAT alike. So a check
written as `req.auth!.owner !== name` is a CROSS-OWNER check and nothing more. It refuses a different
person and admits everything acting in this person's name, which is not what its author meant and not
what its name says.

The August 2026 audit produced this finding eleven times, and the report's own status pass then
recorded one of them as fixed because an operator clause had been added: `owner !== name &&
!roles.includes('operator')` WIDENS the door, and reading it as a narrowing cost a second pass.

**THE FORM THE GATE CANNOT SEE: a door that SCOPES a query by the name instead of REFUSING on it.**
`check:owner-principal` reads comparisons, so a door with no comparison on it is invisible to the
scanner however completely it acts on the human's own things. Four were found by hand on 2026-09-04
and all four are now behind `requireOwnerPrincipal()`:

- `GET`/`DELETE /v1/auth/sessions` and `DELETE /v1/auth/sessions/:id` pass `req.auth!.owner` to
  `listActiveSessions` and revoke what comes back — the human's device list, and signing them out of
  every device they own, their current one included, for any principal carrying their account name.
- `GET /v1/ghii/cors` names the web origins that already hold credentialed access to the account.
  Audit H-7 fenced the PUT and left the read, which is the reconnaissance for the same attack.
- `GET /v1/ghii/verify/eudiw/request` and `GET /v1/ghii/verify/ftn/authorize` mint a verification
  nonce stamped with `req.auth!.owner`. **This is the sharp one, and it shows the pattern's second
  half: a flow is only as fenced as its FIRST step.** The callbacks that consume those states cannot
  be authenticated — they are wallet and bank-ID redirects — so they write `verificationLevel: 3` and
  the presented attributes onto the GHII the NONCE names. Fencing the two POSTs in August left each
  rail half fenced: any principal in the person's name could open a verification bound to the human,
  and whoever then completed the bank-ID login had their own given name, family name, birthdate and
  national identifier hash stamped on somebody else's account as proved. The fence has to sit where
  the state is minted, because there is nowhere later to put it.

*Check:* every authorization names WHICH KIND of principal may do this, never only whose data it is.
A change to the account itself, its password, its recovery address, its second factor, its deletion or
its export, goes behind `requireOwnerPrincipal()`: role `owner` present, `agent`, `ecosystem` and
`app` absent. `requireRole('owner')` alone is not that test, because a role can be inherited (see 12).

*Gate:* `pnpm check:owner-principal`, since 2026-09-04. It reads every refusal decided by comparing
`auth.owner` and requires each door to be behind a principal guard, to compute the test itself, or to
be listed in `security/owner-principal-exemptions.json` with the sentence that makes a name the right
question there. 45 refusals, 15 doors already naming the principal, 30 listed and triaged. It found
`GET /v1/ghii/:ghii/credential` minting a SIGNED verifiable identity credential for any principal
carrying the account name — the same file's two write doors had been closed in August and the read
that hands identity out had not. Three of the 30 are marked an open question rather than cleared:
`requireRole('owner')` keeps machine principals out but an owner-level PAT satisfies it, and the door
grants something (an agent's scopes, an agent's key, an ecosystem app's access). What counts as a
principal guard is one list, `AUTHORIZATION_GATES` in `scripts/inventory/principals.ts` — this script
and `check:route-scopes` used to carry one each and they disagreed about four names.

### 12. A role is granted, never inherited at mint time
`POST /v1/auth/token` read the owner record and copied the owner's `owner` and `operator` roles onto
the AGENT's JWT, so every agent of an operator was an operator. The consequence was not the role test
but the laundering: that token passed `requireRole('owner')` at the PAT mint, `isOperator` was true so
`grant_operator` was permitted, and the resulting PAT resolved to `['owner','operator']` with
`scopes: []` and no `agent` role, at which point `requireScope` bypasses entirely. Two calls turned a
scope-limited agent into an unscoped operator credential.

*Check:* a mint issues the roles the PRINCIPAL was granted. Privilege comes from an approval somebody
made on purpose, never from who your owner happens to be. When you add a mint, diff its role list
against the other mints; there were four and one of them disagreed for months.

### 13. A gate reads the normalized value, never the raw request
`POST /v1/capabilities` checks the webhook allowlist against `body.source.type === 'manual'`, and the
record builder defaults a MISSING type to `'manual'`. So omitting `source` entirely skips both
`WEBHOOKS_DISABLED` and the domain allowlist, and the record is then built as exactly the manual
capability the gate would have refused. The gate and the record disagree about what the request was.

The same shape reached the isolation boundary: `middleware/subdomain.ts` set `req.appOrigin` from the
`X-App-Origin` REQUEST header, so one header made the node believe a request had arrived on the
isolated app origin and serve app HTML on the session origin instead.

*Check:* normalize first, then gate on the normalized value. If a header or a field decides
authorization, the code must be able to verify it independently of the sender, or it is not a gate.

### 14. Refuse before you write
Three separate defects in one audit, one shape. `installCortex` read who held a cortex name, wrote the
lib BYTES, and inserted last, so an install aimed at a bundled pack during boot seeding replaced the
JavaScript this node serves to every browser and only then collided. `enforcePaywall` stood down on a
`settled` internal pass without comparing the pass's product coordinate to the action it was about to
run. `POST /.../tasks/:id/complete` sent its response before awaiting the completion fan-out, so on
Postgres the caller's next read raced the counters it had just been told about.

*Check:* nothing an attacker controls is written, served or answered before the check that would
refuse it. When a handler both writes and validates, read the ORDER, not just the presence.

### 15. A permission word is enforced on every door or it does not exist
`organism:write` deletes `aimeat_organism_create` from an agent's MCP surface, because a `TOOL_SCOPES`
entry removes the tool rather than refusing the call. The same agent gets `201 Created` from
`POST /v1/organisms`, because `requireRoleOrScope('agent', 'organism:write')` admits any principal
holding the `agent` role BEFORE it looks at scopes. The word is real on the surface an owner reads and
decorative on the door that writes.

*Check:* when you add a scope word, name every door that reaches the capability and gate all of them.
A word enforced on one door teaches an owner that they have controlled something they have not.

#### 15b. Closing a bypass, or inventing a requirement: the twin decides

Satisfying 15 means adding a gate to a door that has none, and that is where it can go wrong in the
other direction. If a route is one an agent drives as its ordinary work, demanding a word nobody knew
to ask for turns the capability off for every agent already doing the job. So the question before
adding a gate is not "does this door look unguarded" but **"does an MCP tool doing the SAME KIND OF
THING already demand this word?"**

Per operation, not per word, and that is the whole of the refinement. A word can be write-only in the
tool table and still look twin-backed to anyone who checks only the word. `cortex:write` is demanded
by install, activate, deactivate and delete — and by no read. So gating the four `GET /v1/cortex/…`
routes behind it invents a requirement, and `ext:write` is the same story: invoke, install, activate,
deactivate, delete, and no read, so an agent granted `ext:invoke` would stop being able to list the
instances it invokes. Both were about to be gated by a bulk pass on 2026-09-04 that was quoting this
rule while doing it, and the reverts came from grepping the diff for read doors handed a write word.

- **A twin demands it** → gating the REST door closes a BYPASS. It cannot turn anything off, because
  every agent doing that job through the tool already holds the word: the owner ticked that box the
  day they connected it. `POST /v1/exchange/work/:id/deliver` demanded nothing while
  `aimeat_exchange_work_deliver` had demanded `exchange:write` all along, and the triage measured what
  the gap bought — an app grant with one unrelated scope could mark work delivered and charge a THIRD
  PARTY. Gate it, and say in the diff which tool the word came from.
- **No twin demands it** → the word is a PROPOSAL, not a finding. `organism:read` is asked for by one
  REST route and zero tools, so gating the eleven workspace reads behind it would create a
  requirement no owner has ever granted and dress it as a fix. Read who actually calls the route
  first, and expect the answer sometimes to be that the word should not exist.

Measured on 2026-09-04 against the 156 route-scope entries marked DEBT: **102 are twin-backed and 54
are not.** Two thirds of that backlog is mechanical and the rest is a judgement per route, which is
worth knowing before anyone promises a date for it.

**A bulk pass is the draft, never the result.** Applying the triage's proposed word across a batch is
the right way to move a hundred routes, and it is wrong often enough that the review step is part of
the method rather than diligence on top of it: grep the resulting diff for READ doors handed a
write-flavoured word and re-test each one per operation. On 2026-09-04 that step caught six of
ninety-one, and each of the six had TWO independent reasons to be left alone — no read tool demanded
the word, and the two extension reads already carried an owner fence in the handler (15c). The
mechanical pass saw neither.

*Check:* `TOOL_SCOPES` in `src/mcp/catalog/scopes.ts` is the register, and the tool NAMES in it are
what you read — `aimeat_x_list` and `aimeat_x_read` demanding a word is what makes that word safe on
a GET. `pnpm check:scope-parity` fails when a word lives on one side only, in either direction, which
is the same question asked before either side exists.

#### 15c. A door already gated on the word it needs does not get a weaker one in front

15b says when a word may be added. This says when it may not. A route whose handler already refuses
without the strongest word for what it does is gated; adding a second, weaker word in front of it
satisfies a middleware scanner and changes nothing about who gets in — except that it can now refuse
somebody the first word would have let through.

Both payment-completion doors on this node are in that state, and they are why this is a rule rather
than a judgement made twice. `POST /v1/commerce/checkout-sessions/:id/complete` and its UCP twin both
refuse without `contract:spend`, bounded by the owner's per-app spend ceiling; the triage entry for
the first says in as many words "This is the H-3 fix and it holds on this door". `commerce:buy` in
front of either would be a scanner-shaped change to a money path, and the caller is not obviously the
buyer — a PSP callback holds no buyer scopes at all. Both were left, and both exemptions now say why,
so the next reader does not "finish the job".

**A door can be gated by DEGRADING instead of by refusing, and a middleware destroys that.** This is
the third form, and it is the one that reads as ungated from every angle a scanner has.
`GET /v1/librarian/search` reads `memory:read` and uses it to NARROW: without the word the search
stays inside the caller's own records, and `e2e-librarian` asserts exactly that — status 200, and a
sibling agent's private record absent from the hits. A `requireScope` in front turns "serves you your
own things" into "refuses you", which is a worse answer to the same question.

**And a door whose permission depends on the answer is decided after the answer, not before it.** The
extension-invoke routes hold their decision until the paywall knows whether the call costs anything.
This codebase had already learned it once, and `e2e-money-audit` carries the sentence: the permission
"used to be demanded before the node knew whether the call cost anything, so an app holding only
`memory:read` was refused with `SCOPE_DENIED` on a capability that charges nobody — which locked
published apps out of their own free extensions." Both invoke doors were re-gated on 2026-09-04 by a
scanner-driven pass and both reintroduced that regression one word over. Any gate on such a door
belongs INSIDE the paywall, after the price is known, never in front of it.

*Check:* before gating, read what the handler already refuses. If the answer is "the word that
matters for this operation", the door is done and the exemption needs a sentence, not a middleware.
Then read what it does with the word when the word is absent: if it answers a narrower question
rather than refusing, or if it defers until it knows the price, the middleware is the wrong shape and
the exemption says which of the three it is.

#### 15d. A ratchet is recomputed, not maintained — that is the whole of it

"The count may only go down" is the property people remember. "The count is recomputed from source on
every run" is the one doing the work, and the difference shows only in the failure nobody reports:
an exemption cleared AHEAD of the code. The file says the debt is gone, the count went down, the
commit message is true about intent — and the door is still open. Every direction a person would look
reads as progress.

Measured 2026-09-04, on this exact mistake: clearing the entry for `GET /v1/schedules/:id` while
gating only the four routes the triage had listed. `check:route-scopes` failed on the next run with
one NEW ungated handler naming that line, because it counts the source and compares, rather than
trusting the file. A checklist would have accepted it and the number would have been right.

*Check:* a new gate script recomputes its finding every run and uses the seed file only to decide
whether a finding is NEW. A gate that reads its own bookkeeping as the truth is a list, not a gate.

### 16. Deprecated is not removed
RFC v4.0 marks One-Time Keys / Tier 0.5 deprecated and says the feature sits behind
`keyedBrowseEnabled`. Three of its write paths were behind no flag at all, and the flag defaults to
ON, so they were live on every node: two wrote work status with no task bridge and no event, and the
third created a board post with no access check, no price, no hook and no provenance.

*Check:* deprecating something names the flag, the default and the version it is removed in. A
deprecation note with none of those is a comment, and the code keeps running.

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
- [ ] **Ownership test:** added a cross-owner "→403" E2E and a cross-scope "→403" E2E (Inv. 9); both green on PostgreSQL+Kysely + SQLite.
- [ ] **Scope/role:** every mutating handler has `requireScope`/`requireRole` (Inv. 4).
- [ ] **Reserved keys:** if the server reads-and-trusts any memory key you introduced, it's system-namespaced or denylisted (Inv. 2).
- [ ] **Egress:** any non-constant outbound URL uses `safeFetch`; private-egress respects posture (Inv. 3).
- [ ] **Federation:** new inbound peer endpoints verify a signature unconditionally from an approved peer (Inv. 5).
- [ ] **Anonymous:** no `if(!req.auth)` gate; `members` reads check `!req.auth.anonymous` (Inv. 6).
- [ ] **Secrets:** encrypted at rest, never returned/logged, destination allowlisted (Inv. 7).
- [ ] **Config:** any security value that differs local↔public is in `.env.example` with a safe public default (Inv. 10).
- [ ] **Provenance:** does this path produce or serve model output? If yes, does it mint or propagate provenance? Minting goes through `services/ai-provenance.ts`; serving carries it via `services/ai-provenance-marks.ts`. A new publishing container also goes in `PUBLICLY_LINKED_CONTAINERS` and both providers' predicates, or the labels it produces resolve to a 404 and read as "no provenance". `pnpm check:ai-disclosure` enforces the parts it can see.
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
