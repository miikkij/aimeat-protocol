# Building an AIMEAT-compatible ecosystem application

**Audience:** anyone building (or integrating) an external service that connects to AIMEAT — a
Zendesk-like support desk, an Airtable-like table store, a Notion-like collaborative editor — and the AI
you hand the build to.
**What it answers:** *what AIMEAT expects from an external app so it is "AIMEAT-compatible", how it joins,
and the exact contract it builds against today* — plus a copy-paste prompt that produces a valid
declaration.
**No time/effort estimates** anywhere.

> **This is the code-grounded developer spec.** It documents what is **built and callable now** and
> flags what is a **design target** (declared in the design docs but not yet enforced by the node). The
> single source of truth for the data shape is the **in-code schema** — when this doc and the schema
> disagree, **the schema wins**:
> - Identity: `aimeat/src/utils/gaii.ts` (GEAI helpers)
> - Manifest + static validation: `aimeat/src/models/ecosystem-manifest.ts` (`EcoManifestSchema`,
>   `validateEcoManifest`)
> - Event envelope + catalogs: `aimeat/src/models/ecosystem-event-schemas.ts`
> - Onboarding routes: `aimeat/src/routes/ecosystem-apps.ts` · events: `aimeat/src/routes/ecosystem-events.ts`
>
> **Companion docs:** the full design rationale + the richer target lives in
> [internal/ecosystem-developer-guide.md](internal/ecosystem-developer-guide.md) and the spec set under
> [internal/ecosystem-applications-architecture.md](internal/ecosystem-applications-architecture.md). The
> agent equivalent: [building-an-aimeat-compatible-agent.md](building-an-aimeat-compatible-agent.md).

---

## 0. What an ecosystem app is

An **ecosystem application** is a heavy-duty **external** service that connects to AIMEAT. It lives on its
**own domain**, can be written in **any language on any stack**, runs in **its own environment**, and
AIMEAT does not interfere with how it is built or where it runs — *as long as it handshakes and behaves
correctly*. It is modeled as a **near-copy of an AIMEAT agent connection** — an **agent-parallel external
principal**, the **GEAI** (`eco:{app}#{owner}@{node}`, role `ecosystem`).

It is **not** a federation peer (node-level, operator-approved) and **not** an in-AIMEAT user-space app
(WASM/browser sandbox). It is the third thing.

Governing principle — **peer integration, not domination:**

- Each system keeps its **own** user management and access control. The link is **only a per-user
  correspondence marker** ("this AIMEAT owner maps to this account on your side"). Neither system mints
  the other's permissions.
- **You own your raw data; the user owns the refined data.** High-frequency planes (CRDT, presence,
  realtime) stay entirely on your side. AIMEAT keeps the distilled, higher-value output in the user's
  GHII/organism namespace — written there with the owner's grant, exactly like an agent deposits.

**Deltas vs. an agent** (if you know the agent guide, only these change):

| Agent | Ecosystem app |
|---|---|
| Communicates via **MCP** | Communicates via **REST-over-tunnel + events** (MCP **not** used) |
| Has a **task queue** | **No task queue** — work is event- and capability-driven |
| Events are a secondary surface | **Events are the primary surface** |
| — | May ship its own AIMEAT-compatible views (design target) |

You do **not** implement the wire protocol. You run the **AIMEAT connector** (`aimeat connect serve`) as a
**sidecar** and talk **loopback HTTP/JSON** to it — the same mechanism agents use. The connector speaks
the tunnel; your service stays language-agnostic.

---

## 1. Compatibility levels (each additive, optional, graceful)

A plainly connected app that declares nothing extra already works and is never penalised. Levels mirror
the agent ladder; the **Built** column is what the node enforces **today**.

| Level | What the app does | Built now? |
|---|---|---|
| **0 — Connected** | Completes the *hello integration* handshake; has a per-user GEAI; holds a tunnel; reads/writes within granted scopes | ✅ Built — `ecosystem-apps.ts`, tunnel accepts the `ecosystem` role |
| **1 — Capability-providing** | Declares `capabilities` (id + I/O schema) agents can invoke, and/or `scopes` it consumes against AIMEAT | ✅ Manifest fields + static validation + capability invocation over the tunnel built. (Per-capability **pricing/visibility** is a design target.) |
| **2 — Event-exchanging** | **Emits** events AIMEAT subscribes to as workflow triggers, and/or **subscribes** to AIMEAT events | ✅ Bidirectional event envelope + inbound/outbound catalogs + router built. (Per-event **payload schemas** in the manifest are a design target — `emits`/`subscribes` are name lists today.) |
| **3 — Workflow-compatible** | Capabilities carry workflow **signals** (`success_signal`, `required_to_function`, `deliverable.location`) so a call/deposit can be a chained, signal-checked step | ⏳ **Design target** — not in `EcoManifestSchema` yet. The grammar exists for agents (`workflow-schemas.ts`); ecosystem capabilities will reuse it. |

An ecosystem app is "AIMEAT-compatible" in the full sense when it reaches level 3 on at least one
capability — but levels 0–2 are real and usable now.

---

## 2. Identity (level 0) — BUILT

Your principal is a **GEAI**: `eco:{app}#{owner}@{node}` (e.g. `eco:zendesk#teppo@aimeat-fi-001-genesis`),
role **`ecosystem`**.

- The **`eco:` prefix is the discriminator.** AIMEAT's `gaii.ts` will **not** claim `eco:` identities as
  agent GAIIs — do not present yourself as an agent.
- `{app}` follows the agent-name charset/reserved rules (`validateAppName`). One AIMEAT owner connecting
  one external service = **one GEAI** with that owner's own scopes. Two users of the same service get two
  independent GEAIs.
- Registration is **per-node, per-user, independent** — like a GAII. "Global" just means the same
  external software forms many independent per-node connections. Each node pins your `public_key` at first
  connect (**TOFU**); there is no cross-instance verification.
- **Ownership invariant:** the GEAI works in its **own** `eco:` memory namespace. `resolveIdentity()`
  returns the `eco:` sub **as-is** for the `ecosystem` role (it does not remap writes to GHII). The owner
  owns the data via owner-session aggregation (the same path that covers agents) and via refined-data
  deposits into the organism.

Helpers (source of truth): `parseGEAI`, `buildGEAI`, `isValidGEAI`, `isGEAI`, `validateAppName`,
`ECO_PREFIX` in `aimeat/src/utils/gaii.ts`.

---

## 3. How to JOIN — the real flow (BUILT)

Joining is a near-copy of agent device-auth (RFC 8628), **bidirectional** (either side may initiate the
handshake; the AIMEAT owner always grants the AIMEAT-side scopes). Run the connector as a sidecar; it
drives these endpoints for you.

### 3.1 `POST /v1/ecosystem-apps/hello` — start the handshake (no auth; TOFU key pin)

Request body:

```jsonc
{
  "owner": "teppo",                  // required — the AIMEAT owner you are connecting to
  "app": "zendesk",                  // required — your {app} segment (validateAppName)
  "public_key": "<ed25519 pubkey>",  // required — pinned TOFU at first connect
  "display_name": "Zendesk Support", // optional
  "description": "…",                // optional
  "scopes": ["memory:read", "memory:write"],   // optional — defaults to node defaultEcoScopes
  "data_areas": [ … ],               // optional — consent-grant allowlist (stored at approval)
  "bound_ref": "<opaque acct ref>",  // optional — your account marker; lives on the record, NOT the JWT
  "manifest": { … }                  // optional — if present, statically validated now (see §5)
}
```

Response (RFC-8628 shape): `{ device_code, user_code, verification_uri, verification_uri_complete,
expires_in, interval, validation, user_instructions }`. The owner is told to approve at
`/v1/profile#ecosystem-apps` with `user_code`. **Rate limit: 10 pending requests per owner.**

### 3.2 Owner approval (owner-authenticated)

- `GET /v1/ecosystem-apps/pending` — owner lists pending hello requests.
- `POST /v1/ecosystem-apps/:userCode/approve` — owner approves/denies **and selects the scopes +
  data-areas** the GEAI may use; flips status to active and makes the credential issuable.

### 3.3 `POST /v1/ecosystem-apps/token` — connector polls for the credential

Poll with `{ device_code, grant_type }`. Before approval you get `authorization_pending` / `slow_down`
(agent device-token semantics). After approval you get the **GEAI JWT** once (one-time pickup): a
long-lived EdDSA token with `sub = eco:{app}#{owner}@{node}`, `roles: ['ecosystem']`, `owner`, `node`,
`scopes`, and an `eco_app` claim. (`bound_ref` is **not** in the JWT — it stays on the storage record.)

### 3.4 Owner management

- `GET /v1/ecosystem-apps` — owner lists their connected GEAIs.
- `DELETE /v1/ecosystem-apps/:app` — owner revokes (status → `revoked`; credential revoked).

Then: hold a tunnel (the `/v1/connect/tunnel` upgrade accepts the `ecosystem` role), read/write within
granted scopes, and exchange events.

---

## 4. The MANIFEST — the real contract (BUILT schema)

`manifest` is **optional** at hello (back-compat: no manifest ⇒ no validation gate). When you send one, it
is validated against **`EcoManifestSchema`** — *this* is what the node enforces today:

```jsonc
{
  "app": "zendesk",                  // required — must equal the hello `app`
  "origin": "https://support.example.com",   // optional — your domain
  "scopes": ["memory:read", "memory:write"], // optional — MUST be ⊆ the requested scopes
  "capabilities": [                  // optional — agents may invoke these over the tunnel
    {
      "id": "reply-ticket",          // required, unique across capabilities
      "inputSchema":  { "ticket_id": { "type": "string" }, "body": { "type": "string" } }, // optional
      "outputSchema": { "reply_id": { "type": "string" }, "status": { "type": "string" } } // optional
    }
  ],
  "events": {                        // optional — names only (no payload schema in the built manifest)
    "emits":      ["ticket.resolved", "csat.dropped"],
    "subscribes": ["memory.write", "offer.ordered"]
  }
}
```

> **Design-target fields (NOT in the built schema — do not rely on them being enforced yet):**
> per-capability `price` / `visibility` / `title` / `description`, the level-3 workflow signals
> (`success_signal`, `required_to_function`, `deliverable.location`), per-event payload schemas, and a
> `views` (shipped-UI) section. They are specified in the internal developer guide as the target; until
> they land in `EcoManifestSchema` the node neither requires nor validates them. Including them is
> harmless (extra keys), but build against the table above for anything you depend on today.

The **canonical published manifest** lives in the GEAI's own `eco:` memory namespace (mirroring how
agents publish `agents.{name}.offers`); the connector transmits it. One source of truth.

---

## 5. Compatibility validation — what runs today (BUILT: static only)

When a `manifest` is provided at hello, `validateEcoManifest(app, requestedScopes, manifest, maxEcoScopes)`
runs and the per-check report is returned in the hello response (`validation.checks`) so the owner
approves a known-good integration. The **static** checks (all must pass for `ok: true`):

1. **`manifest_schema`** — parses/validates against `EcoManifestSchema`.
2. **`app_name_valid`** — `m.app` is a clean `{app}` segment (no GAII/`eco:` collision).
3. **`app_matches_request`** — `m.app` equals the hello `app`.
4. **`declared_scopes_subset_requested`** — `manifest.scopes ⊆ requested scopes`.
5. **`scopes_within_ceiling`** — requested scopes stay within the node's `maxEcoScopes` ceiling.
6. **`capability_ids_unique`** — no duplicate capability ids.

> **The DYNAMIC handler-probing harness is deferred.** The internal guide describes a phase that *exercises*
> each declared capability/event over an uncredentialled tunnel before approval. That is **not built yet** —
> today's gate is the static manifest check above. Design your handlers to round-trip correctly regardless,
> because the dynamic gate is the planned next step and the owner approves on the assumption you behave.

---

## 6. Events — the primary surface (BUILT)

Bidirectional, via `ecosystem-event-schemas.ts`. Envelope:
`{ version, event, timestamp, node_id, geai, data }` where `version` is the event-type **MAJOR** (a
workflow trigger pins it and is **fail-safe** — does not fire — on a major mismatch).

- **OUTBOUND (AIMEAT → your subscribed GEAI):** `memory.write`, `memory.delete`, `offer.ordered`,
  `workflow.step`, `binding.revoked`. Delivery is gated by the owner's grant.
- **INBOUND (your GEAI → AIMEAT):** an **open set** — emit any event your manifest declares. The initial
  documented catalog: `ticket.resolved`, `feedback.received`, `csat.dropped`, `table.updated`,
  `note.changed`. The workflow engine matches on `{ app, event, version }`; **consumers ignore unknown
  events**, so a new emit type never breaks anyone.
- Primary transport is the tunnel `deliver` frame; a **signed-webhook fallback** survives the GEAI being
  offline. Design your events to be **workflow triggers**, not just notifications.

---

## 7. What to honor (the peer model)

1. **Keep your own user management + access control.** No delegated tokens, no shared permission minting.
   When an agent calls your capability, **you** enforce the bound account's ACL. When the GEAI reads/writes
   AIMEAT, **AIMEAT** enforces consent + scopes.
2. **The binding is just a marker** ("owner X ↔ your account ref Y"). It carries no rights of its own.
3. **You own raw data; the user owns refined data.** Deposit the distilled, higher-value output into the
   user's GHII/organism namespace (with grant), like an agent does. Prefer **references + read-through +
   schema-shaped display** over copying bulk content. Keep raw records and any realtime plane on your side.
4. **AIMEAT is never your data plane.** Only control + refined data + references + events + capability
   calls cross the bus.
5. **No task queue.** Your work is event- and capability-driven. (Agents keep tasks; you do not.)
6. **The organism is the neutral hub.** Ecosystem apps do not couple to each other — each couples to
   AIMEAT; composition happens in the organism via agents.

---

## 8. Copy-paste prompt — hand this to the AI that builds the app

> Fill the `<…>` blanks, then paste into the chat of the AI building your service (or the Claude Code
> building it). It produces a manifest **valid against the built `EcoManifestSchema`** plus the loopback
> handler stubs.

```text
You are setting up an external service as an AIMEAT-compatible ECOSYSTEM APPLICATION — a NEAR-COPY of an
AIMEAT agent connection with these deltas: it is EXTERNAL (own domain, any language), communicates over
REST-over-tunnel + events (NOT MCP), has NO task queue, EVENTS are its primary surface. It attaches via
the AIMEAT connector run as a SIDECAR (loopback HTTP), so you do NOT implement the wire protocol.

Governing principle: PEER INTEGRATION, NOT DOMINATION — keep your own user management and access control;
the binding is only a per-user marker; you own your raw data; AIMEAT owns the refined data the user keeps
(deposited into the user's GHII/organism namespace with grant).

APP NAME (the {app} segment of eco:{app}#{owner}@{node}): <e.g. zendesk>
ORIGIN (your domain): <e.g. https://support.example.com>
ONE PROVIDED CAPABILITY, with its NEGATIVE scope: <e.g. "Reply to a support ticket as the bound user.
  Does NOT create/delete tickets and does NOT change billing.">
  - input fields it reads:  <e.g. ticket_id, body>
  - output fields it returns: <e.g. reply_id, status>
EVENTS YOU EMIT (workflow triggers): <e.g. ticket.resolved, csat.dropped>
AIMEAT EVENTS YOU SUBSCRIBE TO: <subset of: memory.write, memory.delete, offer.ordered, workflow.step,
  binding.revoked>
AIMEAT SCOPES YOU NEED: <e.g. memory:read, memory:write>

Produce ONE manifest (JSON) in EXACTLY this shape — only these fields are validated by the node today:

{
  "app": "<APP NAME>",
  "origin": "<ORIGIN>",
  "scopes": [ <only scopes you actually use> ],
  "capabilities": [
    { "id": "<kebab-id>",
      "inputSchema":  { <fields> },
      "outputSchema": { <fields> } }
  ],
  "events": {
    "emits":      [ <event names> ],
    "subscribes": [ <AIMEAT event names from the allowed set above> ]
  }
}

Rules you MUST follow:
- `app` MUST equal the app name you send in the hello request, and be a clean lowercase {app} segment.
- `scopes` in the manifest MUST be a subset of the scopes you request at hello, and within the node's
  ceiling — declare only what you use.
- capability ids MUST be unique.
- Communicate via REST-over-tunnel + events; do NOT add MCP and do NOT model work as AIMEAT tasks.
- Keep your own user management/access control; the binding is just a per-user marker.
- Deposit refined data into the user's GHII/organism namespace (with grant); keep raw + realtime data on
  your side.

Then ALSO produce: (a) the connector hello call (POST /v1/ecosystem-apps/hello with owner, app,
public_key, scopes, and this manifest), (b) a loopback HTTP handler for each capability that returns
schema-valid output, (c) an emitter for each event in `emits`, (d) a handler for each event in
`subscribes`. Generate an ed25519 keypair for the app and send the PUBLIC key as public_key (pinned TOFU).
```

---

## 9. Quick self-check (against what's built today)

- [ ] Hello sent with `owner`, `app`, `public_key`; owner approved in Profile → Ecosystem apps; token
      picked up → GEAI JWT with `roles:['ecosystem']`, `sub = eco:{app}#{owner}@{node}`.
- [ ] If a `manifest` is sent, all six static checks pass (`validation.ok === true`).
- [ ] `manifest.app` equals the hello `app`; `manifest.scopes ⊆ requested scopes`; capability ids unique.
- [ ] Capabilities respond with schema-valid output over the tunnel; subscribed events are acknowledged;
      emitted events use the `{version, event, …, data}` envelope.
- [ ] Refined output is deposited into the owner's namespace (with grant); raw + realtime data stays on
      your side.
- [ ] You did **not** rely on design-target fields (pricing, level-3 signals, per-event schemas, shipped
      views) being enforced — they aren't yet.

---

## 10. Built vs. deferred — at a glance

| Surface | Status | Where |
|---|---|---|
| GEAI identity (`eco:` helpers, role, resolveIdentity) | ✅ Built | `utils/gaii.ts` |
| Onboarding (hello/token/pending/approve/list/revoke) | ✅ Built | `routes/ecosystem-apps.ts` |
| Manifest schema + static validation | ✅ Built | `models/ecosystem-manifest.ts` |
| Event envelope + inbound/outbound catalogs + router | ✅ Built | `models/ecosystem-event-schemas.ts`, `routes/ecosystem-events.ts` |
| Tunnel accepts `ecosystem` role; capability invocation over tunnel | ✅ Built | tunnel upgrade + connector |
| Owner aggregation incl. GEAIs; balance resolves `eco:`→owner GHII | ✅ Built | storage + `gaii.ts` |
| Per-capability pricing / visibility | ⏳ Design target | internal guide §1, §4 |
| Level-3 workflow signals on capabilities | ⏳ Design target | reuse `workflow-schemas.ts` |
| Per-event payload schemas in the manifest | ⏳ Design target | manifest has name lists today |
| Dynamic handler-probing validation harness | ⏳ Deferred | static gate only today |
| Shipped views (`views`) via app-catalog | ⏳ Design target | internal guide §4 |
| Profile "Ecosystem apps" UI tab | ⏳ See profile-ui spec | `internal/ecosystem-spec-profile-ui.md` |

Build against the ✅ rows. Treat ⏳ rows as the roadmap, not the contract.
