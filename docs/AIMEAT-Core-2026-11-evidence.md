# AIMEAT Core 2026-11: conformance evidence for the reference node

**For:** [AIMEAT Core 2026-11](AIMEAT-Core-2026-11.md), which is normative since node 4.0.0 (released 2026-10-13).
**Checked against:** `origin/main` at `9902b6287` (node 3.26.1), 2026-10-12, with the updates below for what closed after that. Paths are relative to the repository root. A line number is where the behaviour is, read from the file; a few rows say "not verified" where nobody read every code path.
**Gaps and the wish bucket:** every gap names the wish in the Lifecycle Central wish bucket (organism AIMEAT CODING CENTRAL, workspace `ws-mtemu9rieuk`) that carries the fix. The list is at the end.

## Answer first

Counted on 2026-11-15 from the rows below (node 4.3.1):

- **214 numbered requirements**: 209 carry a MUST or MUST NOT, 5 are SHOULD only.
- **The reference node meets 182 of them**, 13 of those from 4.0.0, the release the requirement is normative in. 18 more are met with a shortfall or are not verified on every path ("partial" below), and 5 are rules for readers or editors with no node behaviour to check ("n/a").
- **9 are gaps**: ID-11, AUTH-06, DATA-06, HTTP-01, HTTP-02 and DISC-03 (Base), PACE-05 and PACE-11 (Pacing), and FED-16 (Federation). Each names its wish in the list at the end.

The first count, on 2026-10-12 at `9902b6287` (node 3.26.1), was 209 requirements: 155 met, 18 partial, 5 n/a and 31 gaps. 8 of those gaps were the planned 4.0.0 changes (AUTH-05, AUTH-24, FED-09, FED-10, HTTP-08, DISC-01, DISC-02, AUTHZ-18) and 23 were defects or missing pieces. The updates below say how each closed.

**Update 2026-10-12 (session cc-joumii-gates-4-0).** 14 of the 31 gaps are closed in code: the 8 planned 4.0.0 changes (AUTH-05, AUTH-24, FED-09, FED-10, HTTP-08, DISC-01, DISC-02, AUTHZ-18) and HTTP-07, FED-13, PROV-07, PACE-21, DISC-05 and DATA-26. Each removal and each 4.0.0 change is a version gate: its own constant, compared with the running version, refused or changed from 4.0.0 whatever the configuration says, and before 4.0.0 answered with the Deprecation headers (`aimeat/src/services/deprecation.ts`). Their rows below say **met (4.0.0)**. The tests run the node as 4.0.0 and as 3.26.1: `aimeat/test/unit/removals-4-0-0.test.ts`, `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts`. MCP-06, MCP-07, AUTH-11 and ID-10 were fixed earlier the same day (commits `a3194232c`, `9c7324cbe`) and are not re-read here, so their rows and the counts above still show the state of `9902b6287`.

**Update 2026-10-12 (session cc-joumii-rest-scopes).** AUTHZ-01 and SEC-03 are closed in code as **met (4.0.0)**: the 70 authenticated REST routes that asked no scope word ask one through `requireRestScope` (`aimeat/src/auth/rest-scope-gate.ts`), refused from 4.0.0 and allowed before it with the Deprecation headers, and every other authenticated route asks a word or carries its reason in `aimeat/security/route-scope-exemptions.json`, held by `pnpm check:route-scopes`. Ruling Q21. The counts above are not recomputed.

**Update 2026-10-12 (session cc-joumii-mcp-token-rest).** MCP-07 is closed in code as **met (4.0.0)**: besides the binding and the MCP endpoint's refusal, a REST route refuses a token bound to the MCP endpoint from 4.0.0 and counts it before (`aimeat/src/auth/mcp-token-on-rest.ts`). Ruling `decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan` item 8. The counts above are not recomputed.

**Update 2026-10-13 (node 4.0.0 released, session cc-joumii-release-4-0-0).** The reference node runs as 4.0.0, so every **met (4.0.0)** row is met by the released node. PACE-11 is closer: a capability's pacing amount is `cost.toll_morsels`, and a knowledge package's is `sharing.toll_morsels`. The old names `cost.morsels` and `sharing.morsel_price` are accepted with the Deprecation headers and refused from node 5.0.0 (ruling `decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll`; `aimeat/src/services/toll-morsels-names.ts`). The board's "post cost" wording is still open, so PACE-11 stays a gap. The counts above are not recomputed.

**Update 2026-10-16 (QA audit, node 4.0.3).** The list at the end is recomputed for the released node: **10 requirements are open**, ID-11, AUTH-06, DATA-06, HTTP-01, HTTP-02 and DISC-03 (Base), PACE-05 and PACE-11 (Pacing), FED-06 and FED-16 (Federation). ID-10, AUTH-11 and MCP-06 are met (their rows below now say so), and PACE-04 is met since 2026-10-15: the daily allowance credits each person once and writes a ledger row (`aimeat/src/services/daily-allowance.ts`). The node claims its profiles with these open requirements, as Core §0.3 allows: discovery lists them in `profile_gaps` (`aimeat/src/services/core-discovery.ts`, `CORE_OPEN_REQUIREMENTS`), and `aimeat/test/unit/core-open-requirements.test.ts` fails when that list and the open rows of this file differ. The per-status counts at the top of this section still describe `9902b6287`; the open list is the current one.

**Update 2026-11-15 (documentation audit, node 4.3.1).** FED-06 is met: the node writes a used invitation on the version it read (`setMemoryIfVersion`, since 2026-10-18), so of two introductions with one token only one is admitted, and `aimeat/test/unit/atomic-once-limits.test.ts` runs the two at once on both providers. Item 22 is closed and FED-06 is gone from `CORE_OPEN_REQUIREMENTS`. **9 requirements are open.** The rows ID-11, DATA-06 and DATA-19 are read again against the code and say what is still missing: ID-11 stays a gap, but only for organism content, because the erasure has read memberships under the bare account name since 2026-10-20; DATA-06 stays a gap for record writes, because files now take all six values; DATA-19 stays partial, because the expiry job now covers every owner. The counts at the top are recomputed on this date, and the line numbers in the rows are moved to where the cited code is now.

Status words: **met** · **met (4.0.0)** (met from the release the requirement is normative in; the code gates it by the running version, and 3.x keeps the old behaviour with the Deprecation headers) · **partial** (met, with a stated shortfall, or not verified on every path) · **gap** (not met) · **n/a** (a rule for readers or editors, no node behaviour to check).

## What changed since the reviewed draft

**Rulings of 2026-10-12** (decision `decision-core-2026-11-avoimet-kysymykset-ja-agenttien-automaattinen-l`) changed these requirements, and so their status:

| ID | Ruling | Status before | Status now |
|---|---|---|---|
| ID-02 | An agent may be created without a separate approval when the system creates it automatically; the owner sees and can remove every agent | gap | met |
| AUTH-09 | An agent may approve another agent of the same owner | gap | met |
| AUTHZ-06 | Follows AUTH-09: a same-owner agent's approval is not reserved to the owner in person | met | met |
| AUTHZ-18 (new) | Consent reach: `local`, `federation`, `auth`; `private` and `dmz` are aliases of `local` through 4.x; default `local` from 4.0.0 | gap in naming, not numbered | gap (4.0.0) |
| CLS-02 | An application acting within its declared purpose may receive an exception the node records | partial | met |
| PACE-09 | No minimum burn rate in Core; an operator share is allowed beside the burn | met | met |
| FED-13 | HTTPS between peers on a public node; a local node is exempt | gap | gap |
| PROV-07 | A public node cannot turn provenance recording off; a local node may | gap | gap |
| HTTP-08 (new) | "Removed in 4.0.0" means refused whatever the configuration says | not numbered | gap (4.0.0) |
| DISC-01 | The bootstrap document repeats the discovery fields | gap | gap |

**Code since the draft's evidence** (`aa01d5dc9`, 23 commits): one cited file changed, `aimeat/src/services/metered-settlement.ts` (pacing rows name the initiator only when someone else made the call, and an existing operator share of a flow is kept). PACE-08, PACE-09 and PACE-10 were read again and their line numbers below are current. No other cited file changed, so the other rows stand as checked.

## 0. Facts behind section 0

| Statement | Evidence |
|---|---|
| The node states `version: 'v1'` and `software_version`, and no protocol version | `aimeat/src/routes/wellknown.ts:146-173`; `aimeat/src/routes/bootstrap.ts:357-374` |
| A peer that states no protocol version reads as `v1` | `aimeat/src/routes/federation-peer/promotion.ts:35`; `aimeat/src/utils/protocol-version.ts:28-29` |
| Protocol versions are compared as versions (`vN`, RFC numbers and dated names), not strings | `aimeat/src/utils/protocol-version.ts:34-77`; used at `aimeat/src/services/network-policy.ts:189,213` |
| Every 4.0.0 removal is gated by the running version (since 2026-10-12; before that only the morsel price fields were) | `*_REMOVED_IN` constants in `aimeat/src/config/security.ts`, `aimeat/src/config/federation.ts`, `aimeat/src/config/pacing.ts`, `aimeat/src/config-ai-models.ts`, `aimeat/src/config/turn.ts`, `aimeat/src/services/workflow/store.ts`, `aimeat/src/mcp/oauth-binding.ts`; `removedFrom` in `aimeat/src/services/deprecation.ts` |
| Discovery states the protocol version from node 4.0.0, and the API description and the MCP server state the node's software version | `aimeat/src/services/core-discovery.ts`; `openapi.yaml` `info.version` (held by `pnpm check:openapi`) and `x-aimeat-protocol`; `aimeat/src/mcp/index.ts` (`serverInfo.version`) |
| v4.0's own versioning rule ("within a version only backward-compatible additions") | `docs/AIMEAT-RFC-v4.0-Core-full.md:231` |

## 3. Principals and identity

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| ID-01 | met | `aimeat/src/utils/gaii.ts:416-447` (`resolveIdentity`, three cases); `aimeat/src/utils/gaii.ts:312-316` (`isOwnerInPerson`) | |
| ID-02 | met | The node creates agents automatically: a default agent at e-mail verification `aimeat/src/routes/ghii/web-verify.ts:166-202,549-550` and at sign-in link verification `:682`, at setup `aimeat/src/routes/setup.ts:278-296`, and the built-in chat agent under the owner `aimeat/src/services/chat-agent.ts:128-147`. A connectivity key is a one-time key the owner issued for one agent `aimeat/src/routes/agents/registration.ts`. The anonymous `shared` agent is the node's own `aimeat/src/server-bootstrap/anonymous-identity.ts:47`. The owner lists every agent of the account `aimeat/src/routes/agents/profile-metadata.ts:206-221` and deletes any of them `aimeat/src/routes/agents/management.ts:612-632`. Same-owner approval: see AUTH-09 | Met under the ruling of 2026-10-12 (Q3). The ruling's examples are hosted services and fleet management; the default agent at sign-up is read here as an automatic creation for the node's own chat and onboarding. |
| ID-03 | met | `aimeat/src/storage/providers/sqlite/repos/ghii-resolve.ts:20-36`; `aimeat/src/storage/providers/postgres-kysely/ghii-resolve.ts:21-34`; `aimeat/src/routes/wallet.ts:103` | |
| ID-04 | partial | `aimeat/src/utils/gaii.ts:509-518` (`callerPrincipal` gives `eco:{app}#owner@node` for role `app`) | The attribution function exists; not verified that every write path stores it. |
| ID-05 | met | Grammar `aimeat/src/utils/gaii.ts:90-97`; reserved list `:98-108`; refusal 400 `INVALID_INPUT` at `aimeat/src/routes/agents/device-auth.ts:239-242`, `aimeat/src/routes/ghii/register-login.ts:161-163`, `aimeat/src/routes/owners.ts:95-97` | v4.0's `RESERVED_NAME` code is not used; Core specifies 400 only. |
| ID-06 | met | `aimeat/src/utils/gaii.ts:126,200` | |
| ID-07 | met | `aimeat/src/services/db/owner-identity.ts:90-102`; `aimeat/src/services/db/memory-db-service.ts:192-245`; `aimeat/src/services/access-guard.ts:153-165` | |
| ID-08 | met | Writes go to the resolved identity (`aimeat/src/utils/gaii.ts:416-447`); the owner's write for an agent is the `agent` field `aimeat/src/models/schemas.ts:159-161` | |
| ID-09 | met | `aimeat/src/services/owner-lifecycle.ts:94-163` (one transaction: disable, sessions, PATs, app grants, device auths, enrolment grants, MCP refresh tokens, then tunnels); `aimeat/src/auth/jwt.ts:163-166`; `aimeat/src/auth/credential-revoked.ts:97-102`; SCIM `aimeat/src/services/scim-users.ts:144,266-272` | |
| ID-10 | met | `aimeat/src/routes/ghii/web-verify.ts` (the verification tokens carry a session row) | Closed 2026-10-12: deleting the agent revokes these tokens with its other sessions. |
| ID-11 | **gap** | `aimeat/src/services/owner-erasure.ts` (`eraseOwner`); `aimeat/src/storage/providers/sqlite/methods/identity.ts`; Postgres cascade `aimeat/src/storage/providers/postgres-kysely/methods/owner-cascade.ts` | Memberships are met since 2026-10-20: the `memberships` step reads the rows under the GHII and under the bare account name, and takes the name off every owners, admins and members list (`removeAccountFromOrganism`). Still open: not verified that organism content written by the deleted owner loses the name. |
| ID-12 | met | `aimeat/src/routes/owners/export.ts:110` | Files are exported as metadata, without bytes. |
| ID-13 | met | `aimeat/src/services/parties/keys.ts` (32 random bytes, SHA-256, `timingSafeEqual`); `aimeat/src/services/parties/token.ts` (`typ: 'party'`, refused by `verifyJWT`); `aimeat/src/auth/middleware.ts` (`optionalAuth` answers 401 for a party token outside `PARTY_TOKEN_ROUTES`, `aimeat/src/services/parties/contract.ts`) | `aimeat/test/e2e-party.ts` (five node routes refuse a party token). Added 2026-11-01. |
| ID-14 | met | `aimeat/src/services/audience.ts` (`isNodeAccount` refuses a reader with `party`); `aimeat/src/services/datapackage/audience.ts` (`datapackageReadable` admits a party only to the package its share names; `versionOpenTo` to the pinned version) | `aimeat/test/e2e-party.ts` D2.8, `aimeat/test/unit/party-contract.test.ts`. |
| ID-15 | met | `aimeat/src/services/parties/verify.ts` (the `parties` record read per request, the token by uid and key id); `aimeat/src/services/parties/read-gate.ts` (the share per read) | `aimeat/test/e2e-party.ts` invariant 19, `aimeat/test/e2e-data-share.ts` (revoke with an earlier token). |
| ID-16 | met | `aimeat/src/routes/parties.ts`, `aimeat/src/services/parties/service.ts` (`party:manage`, outside every wildcard in `aimeat/src/utils/scope-coverage.ts`); read log `aimeat/src/services/parties/activity.ts` | |
| ID-17 | met | `aimeat/src/services/parties/admin.ts`; `POST /v1/admin/parties/{owner}/{name}/stop` | `aimeat/test/e2e-party.ts` D2.9. |

## 4. Authentication

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| AUTH-01 | met | Password `aimeat/src/routes/ghii/register-login.ts:385`; OIDC `aimeat/src/routes/oauth-login.ts:86,118,205`; SAML `aimeat/src/routes/saml-login.ts:151,185,297`; passkeys `aimeat/src/routes/passkeys.ts:166,175`; sign-in link `aimeat/src/routes/ghii/web-verify.ts:593`, `aimeat/src/routes/ghii/login-link-open.ts:49` | |
| AUTH-02 | met | scrypt N=32768 r=8 p=1, `aimeat/src/services/password.ts:15` | |
| AUTH-03 | met | Password `aimeat/src/routes/ghii/register-login.ts:672`; sign-in link gives a second-factor ticket `aimeat/src/routes/ghii/login-link-open.ts:65`; passkey is its own method `aimeat/src/routes/passkeys.ts:5-8` | OIDC and SAML sign-ins do not ask the node's second factor (`aimeat/src/services/external-login.ts`); Core allows that. |
| AUTH-04 | met | `aimeat/src/services/owner-session.ts:74-203,284-326,405-411,450,468,492-512`; access token 900 s `aimeat/src/config.ts:352` | |
| AUTH-05 | met (4.0.0) | `OWNER_KEY_LOGIN_REMOVED_IN` and `ownerKeyLoginAllowed` in `aimeat/src/config/security.ts`; the owner branch of `POST /v1/auth/token` in `aimeat/src/routes/auth.ts` answers 410 `OWNER_KEY_LOGIN_OFF` from 4.0.0 whatever `AIMEAT_OWNER_KEY_LOGIN` says, and spends its signature on first use; test `aimeat/test/unit/removals-4-0-0.test.ts` | Before 4.0.0 it is still on by default, with the Deprecation headers. The challenge from `GET /v1/auth/challenge` is still issued and never read. |
| AUTH-06 | **gap** | Unknown account and wrong password both answer 401 `AUTH_REQUIRED` (`aimeat/src/routes/ghii/register-login.ts:638`; `aimeat/src/services/password-check.ts:75`); tarpit `aimeat/src/middleware/login-tarpit.ts:164,174` | An account without a password answers 400 `NO_PASSWORD` (`aimeat/src/services/password-check.ts:168`), which tells a caller the account exists. |
| AUTH-07 | met | `aimeat/src/auth/credential-revoked.ts:155-176` (`credentialRevoked`: token, session, app grant, ecosystem app, account) | |
| AUTH-08 | met | `aimeat/src/auth/effective-scopes.ts:66-135` | |
| AUTH-09 | met | Owner approval `aimeat/src/routes/agents/device-auth.ts:618-637,685-686`. Same-owner approval `device-auth.ts:337-353` (the approver must be an agent of the same owner and hold `agent:write`; applications and ecosystem principals never approve), `:470-497` (a scope beyond the approving agent's own leaves the request pending for the owner; `approvedBy` names the approver) | Met under the ruling of 2026-10-12 (Q4). The operator can switch same-owner approval off (`sameOwnerAutoApprove`, default on). |
| AUTH-10 | met | `aimeat/src/routes/agents/constants.ts:27`; `aimeat/src/routes/agents/device-auth.ts:193,432,507` | |
| AUTH-11 | met | `aimeat/src/routes/auth.ts` (`spendSignature`) | Closed 2026-10-12: a renewal signature works once. |
| AUTH-12 | met | `aimeat/src/services/ecosystem-refresh.ts:33,71-94`; `aimeat/src/routes/auth.ts:569-595`; pin `aimeat/src/routes/ecosystem-apps.ts:406-453` | |
| AUTH-13 | met | `ECO_REAPPROVAL_SECONDS` 365 days, `aimeat/src/services/ecosystem-refresh.ts:33` | |
| AUTH-14 | met | `aimeat/src/auth/middleware.ts:736-738` | |
| AUTH-15 | met | `aimeat/src/routes/agents-v2/enrolment.ts:91-289` | |
| AUTH-16 | met | `aimeat/src/routes/agents-v2/token.ts:52-207` (EdDSA JWS, `aud` = node id, `jti`, at most 300 s, `spendAssertion`) | |
| AUTH-17 | met | `aimeat/src/routes/agents-v2/card.ts:110-128,158-221,223,247-255` | |
| AUTH-18 | met | `aimeat/src/routes/agents-v2/migrate.ts:146,175`; `aimeat/src/routes/agents-v2/enrolment.ts:181-188,268` | |
| AUTH-19 | met | `aimeat/src/routes/app-grants.ts:349-378,702-714` | PKCE accepts `plain` as well as S256 (`:389-390`). |
| AUTH-20 | met | `aimeat/src/routes/app-grants.ts:739-778` | The refresh token has no expiry and no reuse detection; Core does not require them. |
| AUTH-21 | met | `aimeat/src/routes/app-grants.ts:527-536`; `aimeat/src/auth/account-security.ts:94,104`; `aimeat/src/auth/credential-revoked.ts:70-82` | |
| AUTH-22 | met | `aimeat/src/routes/access-tokens.ts:58-175`; `aimeat/src/services/access-token.ts:25,40-69` | |
| AUTH-23 | met | `aimeat/src/auth/ws-upgrade.ts:53,61,134-160`; `aimeat/src/routes/sse.ts:230-246` | |
| AUTH-24 | met (4.0.0) | `WS_QUERY_TOKEN_REMOVED_IN` in `aimeat/src/config/security.ts`; `authenticateUpgrade` in `aimeat/src/auth/ws-upgrade.ts` refuses `?token=` with `WS_QUERY_TOKEN_DISABLED` from 4.0.0 whatever the setting says; test `aimeat/test/unit/removals-4-0-0.test.ts` | Before 4.0.0 still accepted by default; the 101 answer carries the Deprecation headers (`upgradeDeprecationHeaderLines`). |
| AUTH-25 | met | `aimeat/src/utils/scope-coverage.ts:460-477`; `aimeat/src/routes/agents/device-auth.ts:168` | |
| AUTH-26 | met | `aimeat/src/routes/agents/management.ts:416,437-495`; app grant revoke `aimeat/src/routes/app-grants-manage.ts:216` | |

## 5. Authorization

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| AUTHZ-01 | **met (4.0.0)** | Refusal `aimeat/src/auth/deny.ts:139-165` (403 `SCOPE_DENIED`, `WWW-Authenticate`). The 70 authenticated routes that asked no word carry `requireRestScope` (`aimeat/src/auth/rest-scope-gate.ts`): refused from 4.0.0 (`REST_SCOPE_GATES_ENFORCED_IN`), allowed before it with the Deprecation headers and counted per word in `GET /v1/stats`. Their MCP twins name the same word (catalog `scopeEnforcedFrom`, `aimeat/src/tool-catalog/scopes.ts`). The other authenticated routes either ask a word in the handler or carry a recorded reason why none applies (the caller's own record, the owner in person, no owner data) in `aimeat/security/route-scope-exemptions.json`, and `pnpm check:route-scopes` refuses a new route with neither. The new words `packages:read` and `agent:read` (the owner's agent list, `GET /v1/agents` and its two previews) were given once to every existing agent (`aimeat/src/services/rest-scope-gates-migration.ts`). On a node's first start as 4.0.x, every agent and approved ecosystem app that existed before it gets every word the gates check and it lacks, the existing words included, and its owner is told on the activity feed (`aimeat/src/services/rest-scope-keep-working-migration.ts`). Tests: `aimeat/test/unit/rest-scope-gates.test.ts`, `aimeat/test/unit/rest-scope-gates-migration.test.ts`, `aimeat/test/unit/agent-read-scope.test.ts`, `aimeat/test/unit/rest-scope-keep-working.test.ts`, `aimeat/test/e2e-rest-scope-keep-working.ts`. | An app published before that start whose code calls a gated route its `aimeat-scopes` does not name keeps the word as declared (`aimeat/src/services/app/scope-allowance.ts`, read by `aimeat/src/services/app/scope-needs.ts`; `aimeat/test/e2e-app-scope-allowance.ts`). An app published after it keeps nothing: its publish answer warns, and the call is refused until its author declares the word. |
| AUTHZ-02 | met | `aimeat/src/auth/middleware.ts:540-550,736-740`; app role `aimeat/src/routes/app-grants.ts:532`; ecosystem role `aimeat/src/routes/ecosystem-apps.ts:461` | `requireAnyScope`'s owner bypass lacks the foreign check (`middleware.ts:714`); a federated token no longer carries `owner`, so it does not open. |
| AUTHZ-03 | met | `aimeat/src/utils/scope-coverage.ts:447-454` | |
| AUTHZ-04 | partial | `aimeat/src/utils/scope-coverage.ts:98-421` (19 words, a superset of the minimum in Core) | The list is published in the web app's scope model, not in `openapi.yaml` or discovery. |
| AUTHZ-05 | partial | Per-operation scopes in `openapi.yaml`; tool scopes in `aimeat/src/tool-catalog/definitions/` | No single vocabulary document. Five words exist on MCP only (`commerce:psp`, `commerce:beneficiary-verify`, `consent:groups`, `social:members`, `messages:read-as-owner`). |
| AUTHZ-06 | met | Password `aimeat/src/routes/ghii/recovery.ts:510`; TOTP `aimeat/src/routes/totp.ts:62`; sessions `aimeat/src/routes/auth.ts:692-771`; agent approval `aimeat/src/routes/agents-v2/agent-proposals.ts:179,448`; delete `aimeat/src/routes/owners.ts:321`; export `aimeat/src/routes/owners/export.ts:110`; AI keys `aimeat/src/routes/ai-providers.ts:97-126` | 64 code uses of `requireOwnerPrincipal` in routes. The same-owner agent approval of AUTH-09 is the exception the requirement names. |
| AUTHZ-07 | met | `aimeat/src/auth/account-security.ts:88-105,152-170` | |
| AUTHZ-08 | met | `aimeat/src/routes/setup.ts:233-255`; `aimeat/src/routes/ghii/register-login.ts:274-277`; `aimeat/src/routes/ghii/owner-session.ts:110-151` | |
| AUTHZ-09 | met | `aimeat/src/auth/operator-gate.ts:55-96`; `aimeat/src/services/operator-principal.ts:14-19` | |
| AUTHZ-10 | met | `aimeat/src/services/operator-override.ts:1-27` (used in 25 files, for example `aimeat/src/services/consent/consent-read.ts:85`) | Not verified that every operator act on another owner's data goes through it. |
| AUTHZ-11 | met | `aimeat/src/services/consent-write.ts:409`; operator path `aimeat/src/services/consent/consent-read.ts:85` | |
| AUTHZ-12 | met | `aimeat/src/storage/providers/sqlite/methods/consent.ts:108-129` | |
| AUTHZ-13 | met | `aimeat/src/routes/consent.ts:132-177`; `aimeat/src/services/consent.ts:158-160`; retention 365 days `aimeat/src/config/data-access.ts:48` | |
| AUTHZ-14 | met | `aimeat/src/routes/consent.ts:69,126,138,171,233,268`; `aimeat/src/services/consent-write.ts:204-219` | `consent:manage` is inside the wildcard. |
| AUTHZ-18 | met (4.0.0) | `aimeat/src/utils/consent-reach.ts` (`CONSENT_REACH_LOCAL_DEFAULT_IN`, `consentReachOf`); `grantConsent` in `aimeat/src/services/consent-write.ts` takes `local`, `federation`, `auth`, stores `private` and `dmz` as `local` (with the Deprecation headers) and gives an absent reach `local` from 4.0.0; both providers read a stored `private` or `dmz` as `local`; test `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts` | Before 4.0.0 an absent reach is still `federation`. The compliance roll-up (`consentFacets`) groups by the stored value. |
| AUTHZ-15 | met | `aimeat/src/services/access-guard.ts:134-238`; `aimeat/src/services/consent.ts:76-181` | Boards and the organism key gate run their own consent checks (`aimeat/src/services/board-read-access.ts:115`, `aimeat/src/services/organism-namespace-access.ts:235-264`); both are stricter, not looser. |
| AUTHZ-16 | partial | Provenance answers one 404 (`aimeat/src/routes/ai-provenance.ts:250-307`); memory read 404 | Not verified on every route. |
| AUTHZ-17 | partial (SHOULD) | `aimeat/src/middleware/refusal-recorder.ts`; `aimeat/src/auth/deny.ts`; `aimeat/src/services/auth-audit.ts` | Every HTTP 401 and 403 reaches the refusal log since 2026-10-16, including the 403s written directly in route handlers. A refusal inside an MCP tool is a tool result, not an HTTP status: it is noted on the agent's card, not in this log. |
| CLS-01 | met | `aimeat/src/services/classification/reader.ts` (show, useForAi, leave); gate `aimeat/security/classification-reach.json` | |
| CLS-02 | met | `aimeat/src/services/classification/exceptions.ts:9-40` (a person's exception with a reason; an application's automatic exception with the application and the act as its reason, on the same list; each making, use and withdrawal writes an audit row); `aimeat/src/services/classification/egress.ts`; `aimeat/src/services/classification/reader.ts:128-134` | Met under the ruling of 2026-10-12 (Q9). |
| CLS-03 | met | `aimeat/src/services/classification/reader.ts` (`useForAi`) | |
| CLS-04 | met | `aimeat/src/middleware/refusals.ts:125-143` | |
| CLS-05 | met | `aimeat/src/services/classification/levels.ts:13-17,432` (`POLICY_DILUTES`) | |
| CLS-06 | met | `aimeat/src/services/classification-run/switch.ts:9-21` (`PERSON_REQUIRED`); `aimeat/src/services/classification/policy-admin.ts:13-17`; owner in audience `aimeat/src/services/classification/audience.ts:16-29` | |
| CLS-07 | met | `aimeat/src/services/classification/audit.ts:5-50` | |
| CLS-08 | met | `aimeat/src/services/classification/labels.ts:153-154` | |
| Classification default off | fact | `aimeat/src/config/data-access.ts:26-42,52` (`off`, `owner`, `all`) | |
| Built-in levels | fact | `aimeat/src/services/classification/defaults.ts:163-182` (`julkinen` 0, `sisainen` 10 default, `luottamuksellinen` 20, `erittain-luottamuksellinen` 30) | |
| IAM not enforcing | fact | `aimeat/src/services/iam/model.ts:6-10` | |

## 6. Data

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| DATA-01 | met | `aimeat/src/storage/providers/sqlite/methods/memory.ts:222` (key per `ownerGaii`) | |
| DATA-02 | met | `aimeat/src/routes/memory/key.ts:453-456` | |
| DATA-03 | met | `aimeat/src/services/memory-write.ts:520`; `aimeat/src/routes/memory/key.ts:489` | |
| DATA-04 | met | `aimeat/src/models/schemas.ts:178`; `aimeat/src/routes/memory/key.ts:459-464`; `aimeat/src/services/memory-write.ts:447-456` | |
| DATA-05 | met | `aimeat/src/services/memory-write.ts:533-541` (`setMemoryIfVersion`) | |
| DATA-06 | **gap** | The words in one place: `aimeat/src/utils/visibility-words.ts` (`STORED_VISIBILITY_WORDS`, six, for files and the stored column; `MEMORY_WRITE_VISIBILITIES`, five, for record writes) | Files are met: an upload, a chunked upload and `PATCH /v1/storage/{key}/visibility` take all six (`storedVisibilitySchema`). A write at `group` that names no group and finds none on the record is refused (`aimeat/src/services/memory-write.ts`, 2026-11-05). The bulk write refuses `workspace` as the single write does (2026-10-16). Still open: a record write (`POST /v1/memory`, `PATCH`, the bulk write, `aimeat_memory_write`) does not take `workspace` (`memoryWriteVisibilitySchema`). Ruling of 2026-10-12 (Q10): one vocabulary of six on records and files. |
| DATA-07 | met | `aimeat/src/utils/visibility-words.ts:52-63`; `aimeat/src/services/memory-replication.ts:413-414` | |
| DATA-08 | met | `aimeat/src/routes/organisms/workspace-rows.ts:148` | |
| DATA-09 | met | `aimeat/src/routes/organisms/workspace-rows.ts:205-227` | |
| DATA-10 | met | `aimeat/src/services/workspace-rows/row-service.ts:553-574` | Retention runs after an append only; no timer calls the sweep (`row-service.ts:341`). |
| DATA-11 | met | `aimeat/src/routes/storage-files-chunked.ts:113,216,284,388`; `aimeat/src/services/storage-file-write.ts:413-419` | |
| DATA-12 | met | `aimeat/src/utils/http-range.ts:362` | |
| DATA-13 | partial | `aimeat/src/routes/storage-files.ts:477,549,655` | With the consent layer off, a non-public file answers 404 even to a member who could read it. |
| DATA-14 | met | `aimeat/src/routes/memory/key.ts:479-489`; `aimeat/src/services/memory-write.ts:329` | |
| DATA-15 | met | `aimeat/src/routes/schemas.ts:80,137,203` (`SCHEMA_LOCKED_BY_OTHER`) | |
| DATA-16 | met | `aimeat/src/routes/spec.ts:64-84`; `aimeat/src/services/contract-docs.ts:30`; `openapi.yaml` `/v1/specs/{name}` | `openapi.yaml` lists three names, the code serves five. |
| DATA-17 | n/a | Where the node reads its own records it checks `spec`: `aimeat/src/services/data-map/data-map-access.ts:116`, `aimeat/src/services/agent/ties.ts:95` | |
| DATA-18 | n/a | Editorial rule | |
| DATA-19 | partial | Read time `aimeat/src/routes/memory/key.ts`; the cross-owner listing filters in SQL (`liveSql` in `aimeat/src/storage/providers/postgres-kysely/methods/memory.ts`); job `memory-ttl-cleanup` (`runMemoryTtlCleanupJob` in `aimeat/src/services/core-jobs.ts`), one `deleteExpiredMemory` over every owner every five minutes on both providers, since 2026-10-16 | Not verified that every list and search path on PostgreSQL leaves out a record that expired between two runs of the job. |
| DATA-20 | met | `aimeat/src/storage/providers/sqlite/methods/memory.ts:218-228` (`deletedAt IS NULL`) | |
| DATA-21 | met | `aimeat/src/routes/memory/key.ts:127-140,331-355`; `aimeat/src/config.ts:370` | |
| DATA-22 | met | `aimeat/src/services/memory-bin-sweep.ts`; started at `aimeat/src/server-bootstrap/service-init.ts:576-580` | |
| DATA-23 | met | `aimeat/src/services/memory-bin.ts:311-320` | |
| DATA-24 | met | `aimeat/src/storage/types/commerce.ts:72-80`; `aimeat/src/routes/memory/crud.ts:382` | |
| DATA-25 | met | `aimeat/src/services/archive.ts:120,123,142` (`archivedRoot`) | |
| DATA-26 | met | 413 `QUOTA_EXCEEDED` at `aimeat/src/services/memory-ceilings.ts:102,133,144`, and at memory copy (`aimeat/src/routes/memory/bulk.ts`) since 2026-10-12 | Memory copy answered 429 until 2026-10-12. Not covered by a test that fills a quota. |
| DATA-27 | partial | Deleted list uses the classification reader (`aimeat/src/routes/memory/key.ts:130-131`) | Not verified that search applies classification to every result. |
| DATA-28 | met | `aimeat/src/services/event-bus.ts:144-237`; `aimeat/src/routes/sse.ts:172,249,367` | |

## 7. Collaboration

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| COL-01 | met | `aimeat/src/services/organism-namespace-access.ts:53-54`; `aimeat/src/services/workspace/roles.ts:5-16` | |
| COL-02 | partial | Roles `aimeat/src/storage/types/organisms-federation.ts:156-167`; join `aimeat/src/routes/organisms/crud.ts:407`; invitations `aimeat/src/routes/organisms/membership.ts:452` | Not verified that the last admin cannot leave; an operator repair word exists for organisms nobody can reach (`aimeat/src/utils/scope-coverage.ts:144`). |
| COL-03 | met | `aimeat/src/services/organism-agent-access.ts:13-58`; `aimeat/src/routes/organisms.ts:135-153` | |
| COL-04 | met | `aimeat/src/services/organism-namespace-access.ts` (content owned by the writer's identity) | |
| COL-05 | met | `aimeat/src/services/organism-export.ts` (header); `aimeat/src/routes/organisms/workspace-transfer.ts:136,170` | |
| COL-06 | met | `aimeat/src/services/organism-gate.ts` (publish, about 285-300); `aimeat/src/config.ts:332` (20 versions) | |
| COL-07 | met | `aimeat/src/services/write-guards.ts:189-209` | |
| COL-08 | met | `aimeat/src/services/write-guards.ts:183-187`; `aimeat/src/routes/organisms/gates.ts:333-337`; `aimeat/src/services/memory-bin.ts:311-320` | |
| COL-09 | partial | `aimeat/src/routes/organisms/workspace-access.ts:395-416` (`organism:invite`); `aimeat/src/services/workspace/roles.ts:46,86` | Not verified that an owner who is a plain member is refused. |
| COL-10 | partial | `aimeat/src/routes/organisms/workspace-read.ts:552-692` | Read-gate inheritance not verified. |
| COL-11 | met | `aimeat/src/routes/organisms/gates.ts` (schema failure 422) | |
| COL-12 | met | `aimeat/src/routes/boards.ts:362,418-434,478` | |
| COL-13 | met | `aimeat/src/services/board-post.ts:101,263,408-418`; sweep `aimeat/src/services/job-seeding.ts:66` | |
| COL-14 | met | `aimeat/src/services/board-write.ts:509-519` | |
| COL-15 | met | `aimeat/src/services/board-moderation.ts:28-43`; threshold `aimeat/src/config.ts:626` | |
| COL-16 | met | `aimeat/src/services/board-subscribers.ts:64-98` | The SHOULD is not met: the push carries no signature. |
| COL-17 | met | `aimeat/src/services/board-post.ts:160-165,229,279` | The code calls it a post cost and an anti-flood price; see PACE-11. |
| COL-18 | met | `aimeat/src/services/message-send.ts:319-327,385-399`; `aimeat/src/routes/messages.ts:755,763,789` | |
| COL-19 | met | `aimeat/src/services/message-delivery.ts:102-130,201-229`; `aimeat/src/routes/federation-sync/messaging.ts:335` | |
| COL-20 | met | `aimeat/src/services/conversation-group.ts`; `aimeat/src/storage/types/direct-messages.ts:240-275` | Group threads are node-local, with one remote party allowed. |

## 8. Pacing and metering

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| PACE-01 | met | `aimeat/src/storage/providers/sqlite/repos/ghii-resolve.ts:20-36`; `aimeat/src/utils/gaii.ts:567-572` | |
| PACE-02 | met | Job `aimeat/src/services/core-jobs.ts:109,373-378`; 50 a day, cap 500 `aimeat/src/config.ts:359-360` | The job credits once per agent, so an owner with several agents gets several credits up to the cap. |
| PACE-03 | met | `aimeat/src/storage/providers/sqlite/methods/wallet.ts:30-70`; `aimeat/src/storage/providers/postgres-kysely/methods/wallet.ts:107-145` | |
| PACE-04 | met | `aimeat/src/services/daily-allowance.ts` | Closed 2026-10-15: the allowance credits each person once and writes a ledger row. |
| PACE-05 | **gap** | `isMoneyCurrency` `aimeat/src/commerce/money.ts:49-54`; ACP and UCP refuse a non-money session `aimeat/src/commerce/protocol-money.ts:34-74`; morsel handler removed `aimeat/src/commerce/payment-handlers.ts:19-21,57` | Marketplace listing rows still carry `{ unit: 'morsels', basePrice: n }` (`aimeat/src/services/exchange-source-terms.ts:89-90`). |
| PACE-06 | met | `aimeat/src/commerce/pacing-pack.ts:1-102` (inside the daily mint cap, `:95-102`) | Off by default. |
| PACE-07 | met | `aimeat/src/models/offer-schemas.ts:168-190`; `aimeat/src/models/app-tool-schemas.ts:108-140`; `aimeat/src/storage/types/organisms-federation.ts:424-448` | |
| PACE-08 | met | `aimeat/src/services/metered-settlement.ts:85-91` (`resolvePacingToll`: the provider's amount, the node default when none, clamped to the ceiling); ceiling `aimeat/src/config.ts:668`; `aimeat/src/models/offer-schemas.ts:228` | Node default 0 (`aimeat/src/config.ts:678`). |
| PACE-09 | met | `aimeat/src/services/metered-settlement.ts:122-185` (`chargePacing`: one transaction; debit, burn at `burnRate`, an existing operator share `:133-136`, the rest to the provider, every ledger row; `reverse` gives it all back); burn rate 10 % by default `aimeat/src/config.ts:323`; chokepoint `aimeat/src/services/metered-access.ts:334-346`; own use free `aimeat/src/services/extension-access/pacing.ts:75` | The operator share applies only to flows that had a marketplace fee before the pacing ruling; with no operator account it burns. |
| PACE-10 | met | `aimeat/src/commerce/pacing-pack.ts:43-49` (`insufficientMorselsMessage`: the daily allowance and, when the operator sells one, the pacing pack); used by checkout `aimeat/src/commerce/session-service.ts:594` and by the metered refusal `aimeat/src/services/extension-access/metered-response.ts`; `aimeat/src/services/extension-access/pacing.ts:81-86` | |
| PACE-11 | **gap** | | Capabilities exposed the pacing amount as `cost.morsels`; since 4.0.0 it is `cost.toll_morsels`, and the old name is deprecated until 5.0.0 (`aimeat/src/services/toll-morsels-names.ts`). Listing rows call it `basePrice` (PACE-05); board code calls it a price (`aimeat/src/services/board-post.ts`). |
| PACE-12 | met | `aimeat/src/services/usage-metering.ts:79,226-250`; `aimeat/src/services/ai/usage-record.ts:191-218`; `aimeat/src/routes/ledger.ts:170-345` | |
| PACE-13 | met | No conversion path found | |
| PACE-14 | met | `requireScope('ai:use')` in 14 places | |
| PACE-15 | met | `aimeat/src/services/ai/call-guards.ts:98-120`; `aimeat/src/services/ai/daily-budget.ts:21`; `aimeat/src/services/ai/completion.ts:487-489` | |
| PACE-16 | met | `aimeat/src/services/ai/call-guards.ts:47-56,75-92`; `aimeat/src/services/ai/route-plan.ts:369` | |
| PACE-17 | n/a | A rule about profile claims | |
| PACE-18 | met | `aimeat/src/models/offer-schemas.ts:175-190` | |
| PACE-19 | met | `aimeat/src/routes/commerce.ts:365`; `PaymentHandler` with collect, payout, refund `aimeat/src/commerce/types.ts:294` | |
| PACE-20 | met | `aimeat/src/commerce/agent-purchase-limit.ts:43-151` | |
| PACE-21 | met | `payment_bindings` in `/.well-known/aimeat` and in `GET /` `this_node`, from `paymentBindings` in `aimeat/src/services/core-discovery.ts` (`stripe`, `invoice`, `ucp`, `acp`, and `x402` when it is on; none while commerce is off). Binding documents: `/.well-known/x402.json` `aimeat/src/routes/agent-conventions.ts:257`; `/.well-known/acp.json` `aimeat/src/routes/commerce-acp.ts:162`; UCP profile in `aimeat/src/routes/wellknown.ts` | Listed in every release, not only from 4.0.0. |
| Bindings | fact | Stripe `aimeat/src/commerce/stripe-handler.ts:5-12`; UCP `aimeat/src/routes/ucp-checkout.ts:135-206`; ACP `aimeat/src/routes/commerce-acp.ts:298-318`; x402 `aimeat/src/commerce/x402.ts:48-109`; registry `aimeat/src/commerce/payment-handlers.ts:29-39`, `aimeat/src/server-bootstrap/commerce-rails.ts:28-55` | A `test.money` handler exists for end-to-end tests and for testing the money path in production. It is registered whenever its flag is set; on a node whose base URL is not loopback, the start log and the Security page report it as critical (`aimeat/src/utils/test-money-guard.ts:41-49`). It is not a binding of Core §8.6. |

## 9. Federation

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| FED-01 | met | `aimeat/src/services/federation-peer-gate.ts:111-149` (403 `POLICY_DENIED`) | |
| FED-02 | met | `aimeat/src/services/federation-tiers.ts:164-194`; `aimeat/src/routes/federation-peer/peers.ts:554` | |
| FED-03 | met | `aimeat/src/routes/federation-sync/catalogue-trust.ts:278` | |
| FED-04 | met | `aimeat/src/services/federation-peer-gate.ts:169-171`; `aimeat/src/services/memory-replication.ts:212`; `aimeat/src/routes/federation-sync/routing.ts:237,321,538` | |
| FED-05 | met | `aimeat/src/routes/federation-peer/link-invites.ts:33-44`; `aimeat/src/routes/federation-peer/introduce.ts:357-414` | |
| FED-06 | met | Hash `aimeat/src/services/link-invites.ts` (`hashToken`, SHA-256; the key is the hash); expiry (`expiresAt`, refused once past); single use: the used invite is written on the version that was read (`setMemoryIfVersion` in `consumeAtKey`), so of two introductions with one token one is admitted and the other is answered as a used invite | `aimeat/test/unit/atomic-once-limits.test.ts` runs two introductions with one token at once on both providers. Met since 2026-10-18. |
| FED-07 | met | `aimeat/src/routes/federation-peer/introduce.ts:482-501` | |
| FED-08 | partial | `aimeat/src/services/signed-node-request.ts` (`checkNodeRequest`, `audienceRefusal`, `deliveryRefusal`, `signedMessageRefusal`, `signedGetRefusal`); window `aimeat/src/services/request-nonce.ts:31`. The template listing (`aimeat/src/routes/federation-sync/templates.ts`) and the service summary (`aimeat/src/routes/federation-peer/introduce.ts`) check signature, audience, window and single use since 2026-10-16; the settlement (`aimeat/src/routes/federation-settlements.ts`) checks its audience (`to_node`), its window and its tracking code once. Tests `aimeat/test/e2e-federation-settlements-sync.ts`, `aimeat/test/e2e-federation-contact-link.ts` | The replay cache is an in-process map (`request-nonce.ts:27-49`); it holds for a single-process node only. The key exchange and the trust advisory are outside FED-08 as section 9.3 says. The emergency de-peering notice (`aimeat/src/services/federation-peer-remove.ts`) is sent unsigned to the receiving node's trust-advisory route, which asks for an operator credential, so no node acts on it. |
| FED-09 | met (4.0.0) | `UNPROVEN_FORMAT_REMOVED_IN` and `unprovenFormatLive` in `aimeat/src/config/federation.ts`; `audienceRefusal` and `deliveryRefusal` in `aimeat/src/services/signed-node-request.ts` refuse a message without the proof from 4.0.0 whatever `required` says, and the environment cannot turn `federation.audience_required` off from then; test `aimeat/test/unit/removals-4-0-0.test.ts` | Before 4.0.0 `AIMEAT_FEDERATION_AUDIENCE_REQUIRED=false` still lets one in, counted (`deprecated_use: federation_unproven_format`) and with the Deprecation headers. |
| FED-10 | met (4.0.0) | `RELAY_CLAIM_OPTIONAL_REMOVED_IN` in `aimeat/src/config/federation.ts` (re-exported by `aimeat/src/services/relay-claim-policy.ts`); `effectiveRelayClaim` answers `required` from 4.0.0 whatever the node or the peer says, `parsePeerRelayClaim` refuses `optional`, the environment's `optional` reads as `required`; `aimeat/src/middleware/relay-gate.ts`; test `aimeat/test/unit/removals-4-0-0.test.ts` | Before 4.0.0 an unclaimed relay let through on `optional` carries the Deprecation headers. |
| FED-11 | met | `aimeat/src/services/signed-node-request.ts:393-438` (`pinnedRefusal`) | |
| FED-12 | partial | `aimeat/src/utils/protocol-version.ts:34-77` | The introduction never passes the stated version to the check (`aimeat/src/routes/federation-peer/introduce.ts:381`), so every peer reads as `v1`. |
| FED-13 | met (4.0.0) | `PEER_HTTPS_REQUIRED_IN` and `peerUrlRefusal` in `aimeat/src/services/peer-url-policy.ts`, asked by the introduction, the peering request, the readiness test, adding and editing a peer, a re-admission, a genesis peering and the key exchange (`aimeat/src/services/federation-helpers.ts`); test `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts` | A public node refuses a plain-http peer address from 4.0.0 (400 `PEER_HTTPS_REQUIRED`); a local node keeps plain http (ruling Q16). A peer row stored with an http address before 4.0.0 is not rewritten; the key exchange refuses it, and other outbound calls to such a row are not checked one by one. |
| FED-14 | met | `aimeat/src/routes/federation-peer/peers.ts:210-279` (`KEY_ROTATION_DENIED`) | |
| FED-15 | met | `aimeat/src/services/federation-peer-remove.ts:127-192` | |
| FED-16 | **gap** | `aimeat/src/routes/federation-auth.ts:83-222` | The home node checks the tier ceiling for federated sign-in, not the peer's own permission word (`federation-auth.ts:101`). |
| FED-17 | met | `aimeat/src/auth/account-security.ts:95-101`; `aimeat/src/auth/jwt.ts:250-254` | |
| FED-18 | met | Same read decision path (`aimeat/src/services/access-guard.ts:134-238`) | |
| FED-19 | met | `aimeat/src/services/a2a-foreign.ts:5-35` | |
| FED-20 | met | `aimeat/src/services/memory-replication.ts:103-126,203,212`; `aimeat/src/services/classification-exits.ts:68-79` | |
| FED-21 | met | `aimeat/src/utils/visibility-words.ts:52-63`; `aimeat/src/services/memory-replication.ts:413-414` | |
| FED-22 | met | `aimeat/src/services/memory-replication.ts:230` | The SHOULD is not met: the reference is outside the signed payload (`:166-174`) and the receiver does not check it (`aimeat/src/routes/federation-sync/messaging.ts:215-331`). |
| FED-23 | met | `aimeat/src/services/personal-tunnel.ts:140-141,305-342` | `sendRequest` (`:317`) has no caller: no live forwarding, as Core says. |
| FED-24 | met | `aimeat/src/auth/ws-upgrade.ts:46` (personal and connect tunnels) | Accepts `?token=` before node 4.0.0 (AUTH-24). |
| FED-25 | met | `aimeat/src/services/connect-tunnel.ts:4-17,138`; `aimeat/src/services/connect-tunnel-forward.ts:8-15,55-63,70-90` | Opt-in, `aimeat/src/config.ts:479`. |
| Heartbeat states | fact | `aimeat/src/services/federation.ts:289,506-529` (active, degraded after 3 misses, offline after 10) | v4.0 said `unreachable`; the code writes `offline`. |
| Relay shares unpaid | fact | `docs/known_gaps.md:32-43` (GAP-001); `aimeat/src/services/morsel.ts:188-214` | |
| Package repository uses signed node requests | fact | `aimeat/src/services/packages/peer/package-pull.ts:321,521,591`; `aimeat/src/services/packages/peer/package-node-auth.ts:81` | A request with no node headers returns null rather than a refusal. |

## 10. Provenance

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| PROV-01 | met | `aimeat/src/routes/ai-provenance.ts:210-215`; `aimeat/src/models/ai-provenance-schemas.ts:339-408` | |
| PROV-02 | n/a | Reader rule | |
| PROV-03 | partial | Stated at `aimeat/src/services/ai/provenance.ts:629`, `aimeat/src/models/ai-provenance-schemas.ts:162` | Not verified that no publish path raises the value. |
| PROV-04 | met | `aimeat/src/models/ai-provenance-schemas.ts` (camelCase record) | The MCP wrapper says `record_url`, the envelope wrapper `recordUrl`; both are wrappers, as Core allows. |
| PROV-05 | n/a | Editorial rule | |
| PROV-06 | met | `aimeat/src/storage/repositories/ai-provenance.repository.ts:5-8,42-127` (no update, no delete) | |
| PROV-07 | met (4.0.0) | `PROVENANCE_SWITCH_LOCAL_ONLY_IN` and `aiProvenanceFromEnv` in `aimeat/src/config/ai-label.ts`, read by `aimeat/src/config.ts`; the start-up check says the setting was refused (`aimeat/src/config/posture.ts`); test `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts` | From 4.0.0 a public node records whatever `AIMEAT_AI_PROVENANCE` says; a local node keeps the switch (ruling Q17). Before 4.0.0 the switch still works on a public node, and the start-up check says it stops working in 4.0.0. |
| PROV-08 | met | `aimeat/src/services/app/serve-marks-strip.ts:173`; `aimeat/src/services/app/publish.ts:284-293`; `aimeat/src/services/app/serve-marks.ts:240` | HTML only. |
| PROV-09 | met | `aimeat/src/services/ai/provenance-marks.ts:619-648` | |
| PROV-10 | met | `aimeat/src/routes/ai-provenance.ts:172,221-247` (60 a minute per address) | |
| PROV-11 | met | `aimeat/src/routes/ai-provenance.ts:260` | |
| PROV-12 | partial | `aimeat/src/services/ai/provenance-marks.ts:283-288` | Not verified on every re-serialising route. |
| PROV-13 | met | `disclosure` computed in `aimeat/src/models/ai-provenance-schemas.ts` | |
| PROV-14 | met (SHOULD) | Served labels, `aimeat/src/config/ai-label.ts` | |
| PROV-15 | met | `aimeat/src/config/ai-label.ts:20-26` (`off` becomes `strict` on a public node) | |
| PROV-16 | partial | `aimeat/src/routes/ai-transparency.ts:344,362` | Not verified that an unset authority reads as unstated. |

## 11. Bindings

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| HTTP-01 | **gap** | `aimeat/src/middleware/envelope.ts:47-58,77-89,129-150` | The two 429 answers still build their JSON by hand without `node` and `request_id`: the rate limit (`aimeat/src/middleware/rate-limit.ts:111-125`) and the sign-in tarpit (`aimeat/src/middleware/login-tarpit.ts:209-216,228-232`). Since 2026-10-15 the idempotency errors (`aimeat/src/middleware/idempotency.ts:134,153,178`) and the JSON 404 and the global error handler (`aimeat/src/middleware/fallback-handlers.ts`) go through `error()`. |
| HTTP-02 | **gap** | `error()` always adds hints, `aimeat/src/middleware/envelope.ts:138-150` | The middleware errors named under HTTP-01 carry hints now (read 2026-11-15); nobody has read every middleware's refusals, so the row stays a gap until that read is made. |
| HTTP-03 | met | String codes at each call site | No central list; validation uses three codes (`INVALID_INPUT` 816 uses, `VALIDATION_ERROR` 73, `BAD_REQUEST` 45). Core names `INVALID_INPUT`. |
| HTTP-04 | met | `aimeat/src/middleware/envelope.ts:70-75` | |
| HTTP-05 | met (SHOULD) | `aimeat/src/middleware/idempotency.ts:49-50,77-80,101,131-177` | The body of a reused key is not compared; the cache is in-process (10 000 entries, 24 hours). |
| HTTP-06 | met | `aimeat/src/middleware/rate-limit.ts:105-110` (`Retry-After`, `X-RateLimit-*`) | |
| HTTP-07 | met | `noteDeprecatedUse` in `aimeat/src/services/deprecation.ts` sets `Deprecation: true`, `X-AIMEAT-Removed-In` and the successor `Link` on the response through the request context (`aimeat/src/middleware/request-id.ts`), counts the use (`deprecated_use_by_type` in `GET /v1/stats`) and logs it once a day; called by the owner-key sign-in, the legacy AI settings routes, an unclaimed relay, an unproven federation message, the static TURN pair, `costCapMorsels`, a consent reach alias and a plain-http peer address; the WebSocket upgrade adds the headers to its 101 answer; the 410 of the legacy AI settings routes names the successor | The MCP OAuth flow without PKCE (`aimeat/src/mcp/oauth-binding.ts`) keeps its own counter and log and sends no header on the OAuth answers. |
| HTTP-08 | met (4.0.0) | Every 4.0.0 removal has its own `*_REMOVED_IN` constant and is refused from that release whatever the configuration says: `aimeat/src/config/security.ts`, `aimeat/src/config/federation.ts`, `aimeat/src/config/pacing.ts`, `aimeat/src/config-ai-models.ts`, `aimeat/src/config/turn.ts`, `aimeat/src/services/workflow/store.ts`, `aimeat/src/mcp/oauth-binding.ts`; the environment defaults read off and the Config page refuses the value that would keep one on (`aimeat/src/services/config/schema-validators.ts`); test `aimeat/test/unit/removals-4-0-0.test.ts` | |
| MCP-01 | met | `aimeat/src/mcp/index.ts:477-516,539-558` | |
| MCP-02 | met | `aimeat/src/tool-catalog/surfaces.ts:119`; `aimeat/src/mcp/index.ts:524-553`; listed in the bootstrap document `aimeat/src/routes/bootstrap.ts:644-650` | Eight surfaces: appdev, agent, service, admin, commerce, primitives, chat, full. |
| MCP-03 | met | `aimeat/src/mcp/legacy-sessions.ts` (`servePost`, the session-to-principal check); `aimeat/src/mcp/modern-endpoint.ts` (`serve`) | Since 2026-10-20 (erratum E1): a 2025-era session is bound to the principal that opened it; a 2026-07-28 request has no session and is authenticated on its own (`authenticate()` in `aimeat/src/mcp/index.ts`, then the agent admission in `aimeat/src/services/mcp-agent-admission.ts`), proven by `aimeat/test/e2e-mcp-modern.ts`. |
| MCP-04 | met | `aimeat/src/mcp/unauthenticated-answer.ts:36-62` | |
| MCP-05 | met | `aimeat/src/mcp/oauth-metadata.ts:30-78`; `aimeat/src/services/protected-resource.ts:104-116` | |
| MCP-06 | met | `aimeat/src/mcp/oauth-binding.ts` | Closed: S256 PKCE is required from 4.0.0. |
| MCP-07 | met (4.0.0) | Binding: every MCP OAuth access token names the MCP endpoint as `aud`, a `resource` that is not this node's MCP endpoint is refused from 4.0.0 (`aimeat/src/mcp/oauth-binding.ts` `resourceRefusal`, `mcpResourceOf`). Refusal at the MCP endpoint: a token whose `aud` names another resource is refused in every release (`mcpAudienceRefusal`, called from `aimeat/src/mcp/index.ts` `authenticate`). Refusal on REST: a token bound to the MCP endpoint is refused from 4.0.0 with 401 `invalid_token` (`aimeat/src/auth/mcp-token-on-rest.ts`, asked by `optionalAuth` and `requireAuth` in `aimeat/src/auth/middleware.ts`); the node's own MCP tools that reach REST routes for the session send the request in process, on a connection marked for the token (`aimeat/src/services/request-injector.ts`, `aimeat/src/auth/injected-request.ts`). Tests: `aimeat/test/unit/mcp-oauth-binding.test.ts`, `aimeat/test/unit/mcp-token-on-rest.test.ts` (4.0.0 and 3.26.1), `aimeat/test/e2e-mcp-token-rest.ts` | Before 4.0.0 an MCP OAuth token on a REST route is accepted with the Deprecation headers and counted (`mcp_token_on_rest`). A token without `aud` is not judged on REST, because the node's chat and the commerce fulfilment mint MCP-client tokens without one for REST use. The WebSocket upgrades and the connector tunnel attach verify tokens on their own and do not ask the audience. |
| MCP-08 | met (SHOULD) | `aimeat/src/mcp/oauth.ts:143-247` | |
| MCP-09 | partial | `aimeat/src/tool-catalog/definitions/types.ts:82-85`; `aimeat/src/tool-catalog/scopes.ts:202-259`; `aimeat/src/mcp/index.ts:331-368` | A tool's scope equals its route's by declaration, and no check compares them. `AIMEAT_MCP_ENFORCE_SCOPES=false` switches scope checks off on MCP (`aimeat/src/config.ts:647`). |
| MCP-10 | met | All 430 catalog names begin `aimeat_` | No check enforces it. |
| MCP-11 | met | `aimeat/src/tool-dispatch/index.ts:165` (`withDeclaredInputOnly`); `pnpm check:mcp-schemas` | |
| MCP-12 | partial (SHOULD) | `aimeat/src/mcp/tool-error.ts` | 333 older failures keep three text shapes. |
| MCP-13 | met | `aimeat/src/services/ai/provenance-result.ts`; `aimeat/src/services/ai/provenance-marks.ts:246,263-267` | |
| MCP-14 | met | `aimeat/src/services/mcp-client/hops.ts:42-88`; `aimeat/src/mcp/index.ts:463-472` | Answers a JSON-RPC error, not HTTP 508. |
| DISC-01 | met (4.0.0) | `coreDiscoveryFields` in `aimeat/src/services/core-discovery.ts` (`CORE_PROTOCOL_FROM` 4.0.0), spread into `/.well-known/aimeat` (`aimeat/src/routes/wellknown.ts`) and `GET /` `this_node` (`aimeat/src/routes/bootstrap.ts`); `endpoints.mcp` names the MCP endpoint, `endpoints.auth` stays a string and names the owner sign-in `/v1/ghii/login`, and the additive `endpoints.sign_in` object names each current way to get a token (changes inside v1 are additive, §0.2); `CORE_PROTOCOL_VERSION` in `aimeat/src/utils/protocol-version.ts`, held to `x-aimeat-protocol` in `openapi.yaml` by `aimeat/security/protocol-versions.json` (`aimeat-core`); test `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts` | From 4.0.0 both documents state `protocol_version: "2026-11"` and the claimed profiles; before it both fields are left out, because a 3.x node does not keep the edition's removals. |
| DISC-02 | met (4.0.0) | `aimeat/src/services/core-discovery.ts` (header) | No earlier edition has a dated name and a 3.x peer states no protocol version, so a 4.0.0 node accepts no earlier edition it could name, and `protocol_versions_accepted` is left out until it does. |
| DISC-03 | **gap** | `aimeat/src/services/did-document.ts:30-56`; `aimeat/src/server-bootstrap/routes-loader.ts:678-686` | The default id is `did:web:${nodeId}.aimeat.example` (`aimeat/src/services/vc-issuer.ts:46`), which does not match the host unless the operator sets it. |
| DISC-04 | met | `aimeat/src/routes/wellknown.ts` (the MCP server card) | Since 2026-10-20 the card declares MCP `2026-07-28`, the highest revision the node serves, and lists every served revision in `supportedProtocolVersions` (`aimeat/src/mcp/protocol-version.ts`, held to `server/discover` and `initialize` by `aimeat/test/unit/mcp-protocol-version.test.ts`). It said `2025-06-18` until 2026-10-19 and `2025-11-25` until 2026-10-20. |
| DISC-05 | met | Same as PACE-21 | |

## 12. Security invariants

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| SEC-01 | met | `aimeat/src/utils/gaii.ts:416-447` | |
| SEC-02 | met | `aimeat/src/utils/reserved-keys.ts:185,555-613`; `aimeat/src/utils/scope-coverage.ts:114` | |
| SEC-03 | **met (4.0.0)** | Same as AUTHZ-01: every authenticated route that changes data asks a scope word (`requireScope`, `requireRestScope`), admits only the person (`requireOwnerPrincipal`, the owner or operator role), or carries a recorded reason in `aimeat/security/route-scope-exemptions.json`; `pnpm check:route-scopes` holds it. | |
| SEC-04 | met | `aimeat/src/utils/url-validator.ts`, `aimeat/src/utils/outbound-connect-guard.ts`, `aimeat/src/utils/blocked-ip.ts` | Every validated hop connects through a dispatcher whose lookup checks the address the socket opens to, so DNS rebinding is refused at connect time; the loopback exception is decided on an address, never on host text (QA audit S4-01, S4-02, 2026-10-16). |
| SEC-05 | met | `aimeat/src/services/signed-node-request.ts:122-163`; `aimeat/src/routes/federation-auth.ts:89-112` (the `federation-peer` credential strategy) | |
| SEC-06 | met | `aimeat/src/services/owner-session.ts:184-197`; `aimeat/src/middleware/oauth-round-cookie.ts:119-127`; `aimeat/src/services/external-login.ts:228-237` | No check script enforces it. |
| SEC-07 | met | TOTP secret AES-256-GCM (`aimeat/src/services/totp.ts`); provider keys decrypted at call time only (`aimeat/src/services/ai/call-guards.ts:75-92`) | |
| SEC-08 | met | `aimeat/src/config.ts:219-232`; `aimeat/src/config/private-host.ts:18-29` | |

## The 31 gaps in one list, with their wishes

The list was written as the work for node 4.0.0; a gap still open in the released node stays open under its wish. The wish column names the record in the Lifecycle Central wish bucket that carries the fix. Items 1 to 9, 12 to 14, 16, 17, 20 to 23, 25 and 28 to 30 are closed in code (see the updates under "Answer first"); they stay in the list so the numbering holds. The open ones are listed here: ID-11, AUTH-06, DATA-06, PACE-05, PACE-11, FED-16, HTTP-01, HTTP-02, DISC-03.

| # | ID | What is missing | Kind | Wish |
|---|---|---|---|---|
| 1 | AUTH-05 | Owner-key sign-in still on by default; removal not coded | 4.0.0 removal | `wish-4-0-0-n-poistot-koodiin-versioporttina-ei-kommenttina` |
| 2 | AUTH-24 | `?token=` still accepted by default; removal not coded | 4.0.0 removal | `wish-4-0-0-n-poistot-koodiin-versioporttina-ei-kommenttina` |
| 3 | FED-09 | Unproven peer format still accepted when the setting says so, also at 4.0.0 | 4.0.0 removal | `wish-4-0-0-n-poistot-koodiin-versioporttina-ei-kommenttina` |
| 4 | FED-10 | `optional` relay claim still read at 4.0.0 | 4.0.0 removal | `wish-4-0-0-n-poistot-koodiin-versioporttina-ei-kommenttina` |
| 5 | HTTP-08 | A setting keeps a removed feature alive; only the morsel price fields are gated by version | 4.0.0 removal | `wish-4-0-0-n-poistot-koodiin-versioporttina-ei-kommenttina` |
| 6 | DISC-01 | No `protocol_version`, `profiles` or MCP address in discovery or in the bootstrap document; `endpoints.auth` names the owner-key sign-in | 4.0.0 new field | `wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery`; `endpoints.auth`: `wish-discovery-ei-mainosta-vanhaa-kirjautumista-well-known-aimeat` |
| 7 | DISC-02 | No `protocol_versions_accepted` | 4.0.0 new field | `wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery` |
| 8 | AUTHZ-18 | Consent reach has no `local`; `private` and `dmz` are stored as sent; the default is `federation` | 4.0.0 default change | `wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery` |
| 9 | ID-10 | Tokens from e-mail and link verification survive agent deletion | defect | `wish-s-hk-postivahvistuksen-agenttitokenit-kuolevat-agentin-mukan` |
| 10 | ID-11 | Erasure misses memberships keyed by bare name | defect | `wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-` |
| 11 | AUTH-06 | `NO_PASSWORD` reveals that an account exists | defect | `wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-` |
| 12 | AUTH-11 | Agent renewal signature not spent | defect | `wish-agentin-tokenin-uusimisallekirjoitus-kertak-ytt-iseksi` |
| 13 | AUTHZ-01 | REST routes without a scope gate | defect | `wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen` |
| 14 | SEC-03 | Same as 13 | defect | `wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen` |
| 15 | DATA-06 | Visibility values not accepted uniformly on records and files | defect | `wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-` |
| 16 | DATA-26 | Memory copy answers 429 for a quota | defect | `wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery` |
| 17 | PACE-04 | Daily allowance writes no ledger row | defect | `wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-` |
| 18 | PACE-05 | Listing rows carry morsels in a price field | pacing cleanup | `wish-morselhinnan-sql-nimet-ja-kuolleet-sqlite-taulut-pois-4-0-0-` (was `wish-4-0-0-morselhinnan-j-nteet-pois-tallennuksesta-ja-muistikirj`, done 2026-10-13) |
| 19 | PACE-11 | `cost.morsels` (renamed `cost.toll_morsels` in 4.0.0), `basePrice`, "post cost" | pacing cleanup | `wish-morselhinnan-sql-nimet-ja-kuolleet-sqlite-taulut-pois-4-0-0-` (was `wish-4-0-0-morselhinnan-j-nteet-pois-tallennuksesta-ja-muistikirj`, done 2026-10-13) |
| 20 | PACE-21 | Payment bindings not in discovery | new field | `wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery` |
| 21 | DISC-05 | Same as 20 | new field | `wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery` |
| 22 | FED-06 | Link invitation single use not atomic | defect | `wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-` |
| 23 | FED-13 | No HTTPS requirement for peers on a public node | defect | `wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-` |
| 24 | FED-16 | Federated sign-in checks the tier ceiling, not the peer's word | defect | `wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery` |
| 25 | PROV-07 | A public node can switch provenance recording off | defect | `wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-` |
| 26 | HTTP-01 | Middleware errors skip envelope fields | defect | `wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-` |
| 27 | HTTP-02 | Middleware errors carry no hints | defect | `wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-` |
| 28 | HTTP-07 | Owner-key sign-in sends no `Deprecation` header | defect | `wish-4-0-0-n-poistot-koodiin-versioporttina-ei-kommenttina` |
| 29 | MCP-06 | PKCE optional on MCP OAuth | defect | `wish-mcp-oauth-vaatii-pkce-n-ja-sitoo-tokenin-mcp-osoitteeseen` |
| 30 | MCP-07 | MCP tokens not bound to a resource | defect | `wish-mcp-oauth-vaatii-pkce-n-ja-sitoo-tokenin-mcp-osoitteeseen` |
| 31 | DISC-03 | Default DID id does not match the host | defect | `wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery` |

**Partial rows that a wish also covers:** DATA-19 (the expiry job walked agents only until 2026-10-16; the list and search paths on PostgreSQL are still not verified) is item 4 of `wish-data-ownership-code-defects-leave-over-mcp-keeps-access-app-`.

## Found on the way, outside the numbered requirements

| Finding | Evidence |
|---|---|
| The anonymous token was minted without the `anonymous` claim, although the route asks for it. Fixed: the token carries `anonymous: true` | `aimeat/src/routes/auth.ts:152-171`; `aimeat/src/auth/jwt.ts:182-206` |
| The owner-key challenge is issued and never read. Since 2026-10-15 its answer says that `POST /v1/auth/token` does not read it, and on 2026-11-04 the store it was written to was removed | `aimeat/src/routes/auth.ts:184-213` |
| Records written in bulk with visibility `workspace` were bound to no workspace. Fixed 2026-10-16: a bulk entry takes only the visibilities the single write takes, so such an entry fails | `aimeat/src/routes/memory/bulk.ts:239-242` |
| The connectivity-key agent connect route still existed, although v4.0 said the flow was removed. Fixed 2026-10-14: `POST /v1/auth/connectivity-key` and `POST /v1/agents/connect` are removed | `aimeat/src/routes/agents/registration.ts` |
| The peer key cache has no periodic refresh; keys refresh on introduce, activate and recovery | `aimeat/src/services/federation-helpers.ts:151-156`; `aimeat/src/server-bootstrap/service-init.ts:650-669` |
| `openapi.yaml` lists three record specifications; the node serves five | `openapi.yaml` `/v1/specs/{name}`; `aimeat/src/services/contract-docs.ts:30` |
| MCP `serverInfo.version` was `1.2.0`, a fourth version number. Fixed 2026-10-12: it is the node's software version, as `openapi.yaml` `info.version` is | `aimeat/src/mcp/index.ts` |
