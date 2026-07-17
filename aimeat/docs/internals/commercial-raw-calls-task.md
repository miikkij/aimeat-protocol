# Task: `commercial` — priced raw extension calls (per-call paywall)

> **Self-contained execution prompt for a focused session.** Design is APPROVED and published.
> Everything needed to build is below — you should not need to re-discover the current state.
> Work in the existing worktree `.claude/worktrees/feat+commercial-raw-calls` (branch
> `worktree-feat+commercial-raw-calls`).

## 0. Source of truth

- **Design spec (published, v1):** dev organism `fbb51de5-…` → Development ws `ws-mq664uyfz21` →
  notes `doc-r6tyr3o` ("Design spec: `commercial` — priced raw extension calls"). Read it first via
  `aimeat_workspace_read(ids:["doc-r6tyr3o"])`. It carries the governing invariants + the 4 locked
  decisions (D1–D4). This task doc is the code-level execution plan; the spec is the contract.
- **Roadmap item (published):** `rm-commercial-raw-calls`.
- Origin: TURBO PRH demo, 2026-07-17 — raw ext calls (`POST /v1/ext/:name/:action`) have no
  enforceable price; `public_access` is all-or-nothing free; `ctx.wallet.consume` is a *burn*
  (debits caller, never credits owner — `actions.ts:178-198`); commerce checkout credits the owner
  but a callable tool invokes **as the buyer** (`sellable-resolvers.ts:214`) so it needs
  `public_access:true` → free raw bypass.

## 1. Governing invariants (from the spec — DO NOT violate)

- **M1** morsels become REVENUE (credited to owner) ONLY via `commercial.payMorsels`. Everywhere else
  (`tollMorsels`, `ctx.wallet.consume`) morsels are BURNED, never credited. A migration must NEVER
  silently promote an existing morsel price to revenue (default legacy `price.morsels` → toll).
- **C1** a `commercial` block must set at least one real payment channel: `payMorsels>0` OR `payMoney`.
- **Owner-free** the ext owner (`caller.owner === ext.installedBy`) and their own principals always
  call free, no toll.
- **PSP-gated money** `payMoney` sellable only if seller has `commerce.psp`; absent → 402 explaining
  how to connect it, never a silent success.
- **No-mint** reject non-finite/≤0 amounts on every debit/credit (reuse the CR-1 guard); atomic ops.
- **Refund on throw** if the script throws after payment, refund and leave nothing charged.

## 2. Home of the config — the EXTENSION MANIFEST (refinement of the spec)

Raw calls hit `POST /v1/ext/:extName/:actionId` directly, so the price MUST live on the **extension
action** (unambiguous), NOT an app-tool record (many apps → many prices → ambiguous for a raw call).
The spec already permits this ("optional per-action default in the extension manifest"). The
`apps.{appId}.tools` price stays the CHECKOUT/commerce home; this feature is the RAW home.

Per-action manifest fields (YAML):
```yaml
actions:
  - id: getCompany
    method: POST
    path: /getCompany
    script: getCompany
    tollMorsels: 1                      # optional anti-abuse burn (worthless), independent. Default 0.
    commercial:                          # present => priced raw call. Absent => free (public_access rules).
      payMorsels: 5                      # morsels CREDITED to owner as payment (0 = not paid in morsels)
      payMoney: { amount: 50000, currency: EUR }   # 6-decimal micro-units, PSP-settled (optional)
```
Three combos (spec §3): (1) morsels-only, (2) morsels+money, (3) money-only (payMorsels:0 + payMoney).

## 3. Integration points (verified in this worktree)

- **Action type:** `aimeat/src/storage/types/organisms-federation.ts` — `ExtensionRecord.actions[]` =
  `{ id, method, path, inputSchema, outputSchema, scriptContent }`. Add `tollMorsels?: number` and
  `commercial?: { payMorsels: number; payMoney?: { amount: number; currency: string } }`.
- **Manifest parse/validate:** `aimeat/src/routes/extensions/manifest.ts` — the `actions.map(...)`
  at :97-104 builds each action. Parse+validate `tollMorsels`/`commercial` there (reject invalid;
  enforce C1). Keep it backward compatible (both optional).
- **Enforcement:** `aimeat/src/routes/extensions/actions.ts` — TWO handlers:
  `/v1/ext/:extName/:instanceId/:actionId` (:31, executes :280) and
  `/v1/ext/:extName/:actionId` (:304, executes :540). `callerGaii = resolveIdentity(req.auth!, …)`
  (:35/:307); ext owner = `ext.installedBy` (bare owner name). Inject a shared `enforcePaywall(...)`
  helper AFTER the action is resolved and BEFORE `executeExtensionAction(...)` in BOTH handlers.
  Extract the helper to a sibling file (e.g. `extensions/paywall.ts`) to respect the 800-line cap.
- **Settlement:** `storage.debitBalance(gaii, n)` / `storage.creditBalance(gaii, n)` (atomic; used by
  `services/morsel.ts` — mirror its `payProvider` pattern for debit-caller + credit-owner). Caller
  GHII from `parseGAII(callerGaii).owner` → owner GHII. Cap: `config.extensionMaxDebitPerCall`.
- **Money 402:** `commerce/x402.ts` `paymentChallenge(config)` → the x402 `accepts` envelope;
  `commerce/payment-handlers.ts` `listPaymentHandlers()`; seller PSP at `getMemory(sellerGhii,'commerce.psp')`.

## 4. `enforcePaywall(ctx)` logic (both handlers, before execute)

```
resolveIdentity(caller) → callerGaii; callerOwner = parseGAII(callerGaii).owner
ownerName = ext.installedBy
if (callerOwner === ownerName) return ALLOW            // owner-free, no toll
if (action.tollMorsels > 0) {                          // anti-abuse burn (never credits owner)
  if (tollMorsels > config.extensionMaxDebitPerCall) → 500 config error
  ok = await storage.debitBalance(callerGaii, tollMorsels)
  if (!ok) return res.402 + paymentChallenge  (INSUFFICIENT_MORSELS — top up)
  addTransaction(type:'extension_toll', amount:-tollMorsels, burn)
}
if (!action.commercial) return ALLOW (public_access already checked by the script)  // free public
// commercial:
if (payMorsels > 0) {
  atomic: debitBalance(callerGaii, payMorsels) THEN creditBalance(ownerGhii, payMorsels)
  (on debit fail → 402 + challenge; on credit fail → refund the debit, 500)
  addTransaction both sides (type:'extension_pay')
}
if (payMoney) {
  token = verifyMoneyToken(req.header('x-aimeat-pay-token'))   // D1/D3: 5-min, single-use, bound to (caller, ext, action, amount)
  if (!token) return res.402 + paymentChallenge(config) + { needs: {app? , checkout hint} }   // D1: open+complete checkout → token → retry
  consumeTokenOnce(token)                                       // replay → 409
}
return ALLOW → executeExtensionAction(...)
// wrap execute: if it throws AFTER a pay/credit, refund (credit back caller / debit back owner).
```

Owner-free short-circuits BEFORE the toll (owner never pays toll). Toll applies to every non-owner
regardless of `commercial` (spec D2: allowed on top of money-only). Money path (payMoney) is the
larger sub-piece — see Phase 3.

## 5. Phases (commit per phase; keep each green)

1. **Schema** — extend the action type + `manifest.ts` parse/validate + C1. Unit-ish: a manifest with
   each combo validates; invalid (`commercial:{}` → C1 fail, `payMorsels:-1`) rejects 400.
2. **Morsel enforcement** — `paywall.ts` + wire into both handlers: owner-free, toll burn, payMorsels
   atomic debit-caller/credit-owner, refund-on-throw. `commercial` money path returns 402 stub for now.
3. **Money token (D1/D3)** — mint a one-time 5-min token on checkout-complete for a raw ext call
   (extend the checkout/session-service fulfill path or a dedicated `POST /v1/ext-pay/checkout`),
   bound to (caller, ext, action, amount); verify+consume-once in the paywall; 402 x402 challenge
   describes the flow. PSP settles to owner (reuse payment-handlers). D4: cross-node → money only.
4. **E2E both backends** (`--test=<name>` on sqlite AND postgres-kysely; both green): owner-free (0
   charged), payMorsels credits owner + debits caller (balances move, atomic), cross-owner
   insufficient → 402, toll burns without crediting owner, no-mint (negative rejected), refund-on-throw,
   money-only → 402 without token then success with a valid token. Add cross-owner + cross-scope 402
   cases (Rule 10). Register the suite in `test/run-e2e-ci.ts`.
5. **openapi.yaml** — document the 402 responses + the new manifest action fields (Rule 3);
   `pnpm generate:types`. **i18n** en.json + fi.json for any new user-facing strings (Rule 4).
   `pnpm lint` + `pnpm typecheck` + `pnpm typecheck:frontend` clean.

## 6. Guardrails

- Rule 10 (security DNA): this is a money path — atomic settlement, no-mint guard, owner-free,
  cross-owner/cross-scope 402 tests. Diff the guard chain; never widen access.
- Rule 1: E2E both backends green before "done".
- Rule 2: file headers on new/touched files. Rule 7: lint. 800-line cap → `paywall.ts` sibling.
- Node change → **do not deploy**; hand the branch to Jouni. Update `rm-commercial-raw-calls` status
  and log a `decision` (gated) when the build lands.
- Do NOT touch the existing app-tool checkout path (`sellable-resolvers.ts`) — this is additive on the
  raw route only. `price`/`priceMoney` on app-tool records stay the checkout home (§2).

## 7. Status — BUILT (2026-07-17), not yet committed/deployed

All five phases implemented in this worktree and verified:

- **Phase 1 (schema)** — `organisms-federation.ts` action type + `manifest.ts` validation (C1/no-mint).
- **Phase 2 (enforcement)** — `paywall.ts` (owner-free / toll burn / morsel pay atomic debit-caller +
  credit-owner / refund-on-throw) wired into both invoke handlers.
- **Phase 3 (money token)** — `services/ext-pay-token.ts` (5-min, single-use) + `ext-call` sellable
  resolver (mints the token on settled checkout) + env-gated `test-money-handler.ts` (E2E rail) +
  paywall consumes `x-aimeat-pay-token`.
- **Phase 4 (E2E)** — `test/e2e-ext-paywall.ts`, registered in `run-e2e-ci.ts`:
  **13/13 on sqlite AND postgres-kysely** with `AIMEAT_TEST_MONEY_HANDLER=true` (owner-free,
  cross-owner morsel revenue+atomic, toll-burn≠revenue, money 402→checkout→token→retry 200→replay 402,
  insufficient 402, refund-on-throw, C1/no-mint). Graceful skip of the money chain when the flag is
  off; `e2e-commerce` stays 34/34 (EUR→422 unchanged — the test handler is default-off).
- **Phase 5 (openapi)** — 402 + `x-aimeat-pay-token` header on the invoke path + `ext-call` checkout
  kind; `pnpm generate:types` green. i18n: no new user-facing UI keys (API error strings only).

`pnpm typecheck` 0 errors · `eslint` 0 errors on all changed files.

**Bug the E2E caught (would have shipped otherwise):** owner-free compared `parseGAII(callerGaii).owner`,
which returns null for an owner **GHII** session (`owner@node`, no `#`) → the owner was billed the toll;
the paid case masked it (self debit+credit nets zero). Fixed with a form-agnostic owner extraction.

**Remaining before merge (developer):** the real money RAIL is EE (Stripe handler); the OSS core here
is complete + proven with the test double. Deploy is the developer's (node-core change). Update
`rm-commercial-raw-calls` status + log a gated `decision` when it lands.
