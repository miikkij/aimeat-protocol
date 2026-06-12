# Services → Offers — unification (billable offers)

**Created:** 2026-06-12
**Parent:** [2026-06-12-agent-offers-surface.md](2026-06-12-agent-offers-surface.md) (Offers design),
[2026-06-12-agent-offers-v1-implementation.md](2026-06-12-agent-offers-v1-implementation.md) (v1, shipped).
**Status:** Direction set — unify via the morsel economy. **No time/effort estimates.**

## What "services" actually is today

"services" in AIMEAT is **three systems** that share a word:

| # | What | Code | Data source | Today's role |
|---|------|------|-------------|--------------|
| 1 | **Marketplace catalogue** | `views/profile/services-tab.js` (TABS id `actions`) | `/v1/catalogue` (publish/browse) | discovery — network, **paid** (price in morsels, category, webhook, IO schemas) |
| 2 | **Work-exchange actions** | `views/profile/agents-services-subtab.js` → `/v1/actions` | published `actions` | the callable+metered service (cost, visibility, call-count, success-rate) |
| 3 | **`declare_services`** (Hello Integration) | onboarding step; `DeclareServicesSchema = {services:[{name,description}]}` | **none** — `validateDeclareServices` only validates; the list lives in the step's `details` | a lightweight declaration, never surfaced as a list |

## The key insight: offers are billable

My first read split these as different concepts (owner-facing-free vs network-facing-paid). **That split
is wrong** once an offer can carry a price. Morsels exist so others can pay to use your agent. An offer is
then a **billable capability**: free when *you* drive your own agent, **debited (morsels owner→provider)**
when *someone else* invokes it. With pricing on the offer, the three systems stop being separate features
and become **projections of one thing**:

- (1) marketplace catalogue = **the public listing of offers** (those with visibility `public`).
- (2) work-exchange actions = **the callable/billable binding of an offer** (the webhook + IO schema +
  metering that lets a non-owner actually invoke it and be charged).
- (3) `declare_services` = **the lightweight seed** for a new agent's offers.

## Recommendation: UNIFY — Offer is the single unit

Let the offer carry the economics + reach that today live in the catalogue and actions:

```
Offer (extends the v1 descriptor)
  …id, title, ask, example, tags, verification, dataHandling, deliverable…    (v1, unchanged)
  price:      { morsels: number, unit: 'per-call'|'per-result'|'subscription' } | null   // null = not for sale
  visibility: 'private' | 'unlisted' | 'public'     // private = only my own use; public = listed in catalogue
  callable:   { action_id?, webhook_url?, input_schema?, output_schema? } | null          // present ⇒ others can invoke + be billed
```

Rules that fall out of this:
- **Self-use is free.** Owner driving their own agent (v1 Run / Copy-prompt / Run-now) never debits.
  Pricing applies only when the **caller's owner ≠ the offer's owner** — reuse the existing
  `transferBalance(callerGhii, providerGhii, price)` rails. Same-owner ⇒ short-circuit free.
- **`visibility:'public'` ⇒ it shows in the catalogue.** Marketplace "browse" becomes
  `GET /v1/offers?visibility=public` across the network; "publish to catalogue" becomes "set an offer
  public + price". No second data model.
- **`callable` present ⇒ machine-invocable + billable.** That binding *is* today's `/v1/actions` entry.
  Invocation + metering (call-count, success-rate, avg-response) stay on the actions path; the offer is
  the front-door descriptor that owns price + visibility + which action backs it.
- **No `callable` ⇒ human-prompt / task offer** (v1 behaviour) — the simple free self-use case.

So: **Offers tab = manage what my agents can do, with price + who-can-see.** Catalogue = the public
slice. Actions = the invocation+billing engine behind callable offers. One concept, three views.

## What this means for the existing tabs
- **Profile "Services" (catalogue) tab** → reframe as the **public/marketplace view of offers**, or
  retire once the Offers tab grows a "public + price" control and a "browse network offers" sub-view.
  Don't delete the `/v1/catalogue` rails — repoint them at public offers.
- **Per-agent "Services" subtab (actions)** → becomes the **callable bindings** of an offer (or stays as
  the low-level actions list, linked from the offer that owns it).
- **`declare_services` onboarding** → seeds `private`, unpriced starter offers.

## Build outline (incremental, keeps v1 working)
1. **Descriptor v2** — extend `offer-schemas.ts` with `price`, `visibility` (default `private`),
   `callable` (all optional/nullable). v1 offers validate unchanged (new fields default).
2. **Billing on invoke** — when a callable offer is invoked and `callerOwner ≠ providerOwner` and
   `price` set: debit caller / credit provider via existing `transferBalance`; record the txn. Self-use
   short-circuits free. (Reuse the actions invoke path; add offer-price lookup + same-owner guard.)
3. **Public listing** — `GET /v1/offers?visibility=public&scope=network` returns public offers across
   agents/nodes; repoint catalogue browse at it. Owner aggregate (`GET /v1/offers`, shipped) keeps
   returning *all* of the owner's own offers regardless of visibility.
4. **Offers tab controls** — add price + visibility editors to the offer card (owner-gated publish);
   add a "browse network offers" sub-view = the public slice (the catalogue, reborn).
5. **Seed-from-declare_services** — onboarding upserts minimal `private` offers if the agent has none.
6. **Verify** — E2E: (a) non-owner invoking a priced public offer transfers morsels and is metered;
   (b) owner invoking their own priced offer is free; (c) `private` offers never appear in the public
   listing; (d) a v1 offer (no price/visibility/callable) still validates and self-runs.

## Open decisions for you
- **Default visibility** for a newly published offer: `private` (opt-in to selling), `unlisted`
  (callable-by-link), or `public`. (Rec: `private` — flip to public + price deliberately.)
- **Retire the catalogue tab now, or run it alongside** the Offers public sub-view during transition?
  (Rec: keep `/v1/catalogue` rails, repoint at public offers, fold the UI into Offers when ready.)
- **Pricing units** — `per-call` only to start, or also `per-result` / `subscription`?
  (Rec: `per-call` first; it maps cleanly onto the actions invoke.)

## Handover to crewaimeat — the backend is LIVE (on `main`, local)

The earlier "services is proto-offers, just rename" was directionally right but for a deeper reason:
**offers are billable**, and morsels are the point. The node side of the unified contract is **built,
typechecked, lint-clean, and E2E-green (`e2e-agent-offers`, 15/15 on SQLite)** — not yet deployed to
aimeat.io. Here is the as-built contract to publish against:

### Descriptor v2 (`aimeat/src/models/offer-schemas.ts`)
Three optional fields added to each offer (v1 docs validate unchanged):
- `price`: `{ morsels: int≥0, unit?: 'per-call'|'per-result'|'subscription' } | null` — `null`/absent =
  not for sale (self-use only). Distinct from the qualitative `cost` hint, which stays for goal-search.
- `visibility`: `'private' | 'unlisted' | 'public'` — absent ⇒ treated as `private`. `public` ⇒ listed
  in the catalogue (frontend listing still pending).
- `callable`: `{ action_id?, webhook_url?, input_schema?, output_schema? } | null` — present ⇒
  machine-invocable + billable; absent ⇒ human-prompt/task offer (the existing Ask flow). For now
  invocation requires `action_id` pointing at an existing **capability**.

### New route
`POST /v1/agents/:name/offers/:offerId/invoke` — `:name` is a bare agent name (your own agent) or a
**full provider GAII, URL-encoded** for cross-owner calls. Body: `{ input?: object }`; `?mode=raw|normal`.
- **Self-use is free** (caller owner == provider owner).
- **Cross-owner + `price` set** ⇒ debit caller / credit provider (minus marketplace fee) **on success**,
  refund on dispatch failure. Returns `{ offer, agent, result, receipt }`; `receipt` is `{ charged: 0 }`
  for self-use else `{ charged, earned, fee, trackingCode }`.
- Error codes: `402 INSUFFICIENT_BALANCE`, `403 OFFER_PRIVATE` (cross-owner on a private offer),
  `404 AGENT_NOT_FOUND|OFFER_NOT_FOUND|CAPABILITY_NOT_FOUND`, `422 OFFER_NOT_CALLABLE`,
  `502 OFFER_INVOKE_FAILED` (backing capability errored — caller refunded).

Publish/read unchanged: `PUT /v1/agents/:name/offers`, `GET /v1/agents/:name/offers`,
`GET /v1/offers` (owner aggregate — returns ALL your offers regardless of visibility).

### Asks for the crew side (`t-offers-crew-side`)
1. **Confirm the v2 descriptor** (price/visibility/callable) before we lock it in the frontend editors.
2. **Decide** whether your pilot agents publish **public + priced** offers now, or stay **private**
   (self-use only) until the catalogue UI lands. Default we're assuming: new offers are `private`.
3. For any offer you want to be **callable + billable**, it needs an `action_id` capability behind it —
   confirm whether your pilot agents already expose capabilities, or whether webhook-direct (no
   capability) needs to come first.
4. One known gap on our side: the **money-moves happy path isn't E2E-covered** (SSRF blocks loopback
   webhooks; the tests cover the gates up to the capability boundary). If you have an extension-backed
   capability we can point an offer at, we can prove the full debit/credit end-to-end.
