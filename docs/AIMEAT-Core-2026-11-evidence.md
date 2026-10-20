# AIMEAT Core 2026-11: conformance evidence for the reference node

**For:** [AIMEAT Core 2026-11](AIMEAT-Core-2026-11.md), which is normative since node 4.0.0 (released 2026-10-13).
**Checked against:** `origin/main` at `9902b6287` (node 3.26.1), 2026-10-12, with the updates below for what closed after that. Paths are relative to the repository root. A line number is where the behaviour is, read from the file; a few rows say "not verified" where nobody read every code path.
**Gaps and the wish bucket:** every gap names the wish in the Lifecycle Central wish bucket (organism AIMEAT CODING CENTRAL, workspace `ws-mtemu9rieuk`) that carries the fix. The list is at the end.

## Answer first

- **209 numbered requirements**: 205 carry a MUST or MUST NOT, 4 are SHOULD only.
- **The reference node meets 155 of them.** 18 more are met with a shortfall or are not verified on every path ("partial" below), and 5 are rules for readers or editors with no node behaviour to check ("n/a").
- **31 are gaps**: the node does not meet them today. Each one is work for node 4.0.0, and each names its wish.
  - **8 are the planned 4.0.0 changes**: the four removals (owner-key sign-in AUTH-05, `?token=` AUTH-24, the unproven federation format FED-09, the `optional` relay claim FED-10) and the rule that a removal holds whatever the configuration says (HTTP-08) are named in code but not enforced by version; discovery lacks `protocol_version` and `profiles` (DISC-01, DISC-02); and the consent reach default changes to `local` (AUTHZ-18).
  - **23 are defects or missing pieces**, listed in the table at the end with what is missing.

**Update 2026-10-12 (session cc-joumii-gates-4-0).** 14 of the 31 gaps are closed in code: the 8 planned 4.0.0 changes (AUTH-05, AUTH-24, FED-09, FED-10, HTTP-08, DISC-01, DISC-02, AUTHZ-18) and HTTP-07, FED-13, PROV-07, PACE-21, DISC-05 and DATA-26. Each removal and each 4.0.0 change is a version gate: its own constant, compared with the running version, refused or changed from 4.0.0 whatever the configuration says, and before 4.0.0 answered with the Deprecation headers (`aimeat/src/services/deprecation.ts`). Their rows below say **met (4.0.0)**. The tests run the node as 4.0.0 and as 3.26.1: `aimeat/test/unit/removals-4-0-0.test.ts`, `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts`. MCP-06, MCP-07, AUTH-11 and ID-10 were fixed earlier the same day (commits `a3194232c`, `9c7324cbe`) and are not re-read here, so their rows and the counts above still show the state of `9902b6287`.

**Update 2026-10-12 (session cc-joumii-rest-scopes).** AUTHZ-01 and SEC-03 are closed in code as **met (4.0.0)**: the 70 authenticated REST routes that asked no scope word ask one through `requireRestScope` (`aimeat/src/auth/rest-scope-gate.ts`), refused from 4.0.0 and allowed before it with the Deprecation headers, and every other authenticated route asks a word or carries its reason in `aimeat/security/route-scope-exemptions.json`, held by `pnpm check:route-scopes`. Ruling Q21. The counts above are not recomputed.

**Update 2026-10-12 (session cc-joumii-mcp-token-rest).** MCP-07 is closed in code as **met (4.0.0)**: besides the binding and the MCP endpoint's refusal, a REST route refuses a token bound to the MCP endpoint from 4.0.0 and counts it before (`aimeat/src/auth/mcp-token-on-rest.ts`). Ruling `decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan` item 8. The counts above are not recomputed.

**Update 2026-10-13 (node 4.0.0 released, session cc-joumii-release-4-0-0).** The reference node runs as 4.0.0, so every **met (4.0.0)** row is met by the released node. PACE-11 is closer: a capability's pacing amount is `cost.toll_morsels`, and a knowledge package's is `sharing.toll_morsels`. The old names `cost.morsels` and `sharing.morsel_price` are accepted with the Deprecation headers and refused from node 5.0.0 (ruling `decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll`; `aimeat/src/services/toll-morsels-names.ts`). The board's "post cost" wording is still open, so PACE-11 stays a gap. The counts above are not recomputed.

**Update 2026-10-16 (QA audit, node 4.0.3).** The list at the end is recomputed for the released node: **10 requirements are open**, ID-11, AUTH-06, DATA-06, HTTP-01, HTTP-02 and DISC-03 (Base), PACE-05 and PACE-11 (Pacing), FED-06 and FED-16 (Federation). ID-10, AUTH-11 and MCP-06 are met (their rows below now say so), and PACE-04 is met since 2026-10-15: the daily allowance credits each person once and writes a ledger row (`aimeat/src/services/daily-allowance.ts`). The node claims its profiles with these open requirements, as Core §0.3 allows: discovery lists them in `profile_gaps` (`aimeat/src/services/core-discovery.ts`, `CORE_OPEN_REQUIREMENTS`), and `aimeat/test/unit/core-open-requirements.test.ts` fails when that list and the open rows of this file differ. The per-status counts at the top of this section still describe `9902b6287`; the open list is the current one.

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
| The node states `version: 'v1'` and `software_version`, and no protocol version | `aimeat/src/routes/wellknown.ts:104-125`; `aimeat/src/routes/bootstrap.ts:291-303` |
| A peer that states no protocol version reads as `v1` | `aimeat/src/routes/federation-peer/promotion.ts:35`; `aimeat/src/utils/protocol-version.ts:25-26` |
| Protocol versions are compared as versions (`vN`, RFC numbers and dated names), not strings | `aimeat/src/utils/protocol-version.ts:28-71`; used at `aimeat/src/services/network-policy.ts:189,213` |
| Every 4.0.0 removal is gated by the running version (since 2026-10-12; before that only the morsel price fields were) | `*_REMOVED_IN` constants in `aimeat/src/config-security.ts`, `aimeat/src/config-federation.ts`, `aimeat/src/config-pacing.ts`, `aimeat/src/config-ai-models.ts`, `aimeat/src/config-turn.ts`, `aimeat/src/services/workflow/store.ts`, `aimeat/src/mcp/oauth-binding.ts`; `removedFrom` in `aimeat/src/services/deprecation.ts` |
| Discovery states the protocol version from node 4.0.0, and the API description and the MCP server state the node's software version | `aimeat/src/services/core-discovery.ts`; `openapi.yaml` `info.version` (held by `pnpm check:openapi`) and `x-aimeat-protocol`; `aimeat/src/mcp/index.ts` (`serverInfo.version`) |
| v4.0's own versioning rule ("within a version only backward-compatible additions") | `docs/AIMEAT-RFC-v4.0-Core-full.md:227` |

## 3. Principals and identity

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| ID-01 | met | `aimeat/src/utils/gaii.ts:383-414` (`resolveIdentity`, three cases); `aimeat/src/utils/gaii.ts:279-283` (`isOwnerInPerson`) | |
| ID-02 | met | The node creates agents automatically: a default agent at e-mail verification `aimeat/src/routes/ghii/web-verify.ts:372-398` and at sign-in link verification `:517-543`, at setup `aimeat/src/routes/setup.ts:210-225`, and the built-in chat agent under the owner `aimeat/src/services/chat-agent.ts:120-136`. A connectivity key is a one-time key the owner issued for one agent `aimeat/src/routes/agents/registration.ts:51-60`. The anonymous `shared` agent is the node's own `aimeat/src/server-bootstrap/service-init.ts:677`. The owner lists every agent of the account `aimeat/src/routes/agents/profile-metadata.ts:162-183` and deletes any of them `aimeat/src/routes/agents/management.ts:558-600`. Same-owner approval: see AUTH-09 | Met under the ruling of 2026-10-12 (Q3). The ruling's examples are hosted services and fleet management; the default agent at sign-up is read here as an automatic creation for the node's own chat and onboarding. |
| ID-03 | met | `aimeat/src/storage/providers/sqlite/repos/ghii-resolve.ts:20-36`; `aimeat/src/storage/providers/postgres-kysely/ghii-resolve.ts:21-34`; `aimeat/src/routes/wallet.ts:105` | |
| ID-04 | partial | `aimeat/src/utils/gaii.ts:450-459` (`callerPrincipal` gives `eco:{app}#owner@node` for role `app`) | The attribution function exists; not verified that every write path stores it. |
| ID-05 | met | Grammar `aimeat/src/utils/gaii.ts:82-89`; reserved list `:98-108`; refusal 400 `INVALID_INPUT` at `aimeat/src/routes/agents/device-auth.ts:391-394`, `aimeat/src/routes/ghii/register-login.ts:129-131`, `aimeat/src/routes/owners.ts:77-79` | v4.0's `RESERVED_NAME` code is not used; Core specifies 400 only. |
| ID-06 | met | `aimeat/src/utils/gaii.ts:118,192` | |
| ID-07 | met | `aimeat/src/services/db/owner-identity.ts:61-73`; `aimeat/src/services/db/memory-db-service.ts:192-245`; `aimeat/src/services/access-guard.ts:104-116` | |
| ID-08 | met | Writes go to the resolved identity (`aimeat/src/utils/gaii.ts:383-414`); the owner's write for an agent is the `agent` field `aimeat/src/models/schemas.ts:133-135` | |
| ID-09 | met | `aimeat/src/services/owner-lifecycle.ts:74-135` (one transaction: disable, sessions, PATs, app grants, device auths, enrolment grants, MCP refresh tokens, then tunnels); `aimeat/src/auth/jwt.ts:140-143`; `aimeat/src/auth/middleware.ts:273-278`; SCIM `aimeat/src/services/scim-users.ts:129,242-247` | |
| ID-10 | met | `aimeat/src/routes/ghii/web-verify.ts` (the verification tokens carry a session row) | Closed 2026-10-12: deleting the agent revokes these tokens with its other sessions. |
| ID-11 | **gap** | `aimeat/src/services/owner-erasure.ts:90-273`; `aimeat/src/storage/providers/sqlite/methods/identity.ts:88-185`; Postgres cascade `aimeat/src/storage/providers/postgres-kysely/methods/owner-cascade.ts:191-283` | Erasure looks memberships up by GHII (`owner-erasure.ts:124`) while memberships are keyed by the bare owner name (`aimeat/src/services/organism-namespace-access.ts:53-54`), so organism memberships may survive. Not verified that organism content written by the deleted owner loses the name. |
| ID-12 | met | `aimeat/src/routes/owners/export.ts:97` | Files are exported as metadata, without bytes. |

## 4. Authentication

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| AUTH-01 | met | Password `aimeat/src/routes/ghii/register-login.ts:343`; OIDC `aimeat/src/routes/oauth-login.ts:67,95,161`; SAML `aimeat/src/routes/saml-login.ts:99,128,211`; passkeys `aimeat/src/routes/passkeys.ts:166,175`; sign-in link `aimeat/src/routes/ghii/web-verify.ts:445`, `aimeat/src/routes/ghii/login-link-open.ts:42` | |
| AUTH-02 | met | scrypt N=32768 r=8 p=1, `aimeat/src/services/password.ts:15` | |
| AUTH-03 | met | Password `aimeat/src/routes/ghii/register-login.ts:612`; sign-in link gives a second-factor ticket `aimeat/src/routes/ghii/login-link-open.ts:58`; passkey is its own method `aimeat/src/routes/passkeys.ts:5-8` | OIDC and SAML sign-ins do not ask the node's second factor (`aimeat/src/services/external-login.ts`); Core allows that. |
| AUTH-04 | met | `aimeat/src/services/owner-session.ts:34-71,117-158,189-195,234,242,263-283`; access token 900 s `aimeat/src/config.ts:309` | |
| AUTH-05 | met (4.0.0) | `OWNER_KEY_LOGIN_REMOVED_IN` and `ownerKeyLoginAllowed` in `aimeat/src/config-security.ts`; the owner branch of `POST /v1/auth/token` in `aimeat/src/routes/auth.ts` answers 410 `OWNER_KEY_LOGIN_OFF` from 4.0.0 whatever `AIMEAT_OWNER_KEY_LOGIN` says, and spends its signature on first use; test `aimeat/test/unit/removals-4-0-0.test.ts` | Before 4.0.0 it is still on by default, with the Deprecation headers. The challenge from `GET /v1/auth/challenge` is still issued and never read. |
| AUTH-06 | **gap** | Unknown account and wrong password both answer 401 `AUTH_REQUIRED` (`aimeat/src/routes/ghii/register-login.ts:587`; `aimeat/src/services/password-check.ts:45`); tarpit `aimeat/src/middleware/login-tarpit.ts:149,159` | An account without a password answers 400 `NO_PASSWORD` (`aimeat/src/services/password-check.ts:53`), which tells a caller the account exists. |
| AUTH-07 | met | `aimeat/src/auth/middleware.ts:311-321` (`credentialRevoked`: token, session, app grant, ecosystem app, account) | |
| AUTH-08 | met | `aimeat/src/auth/effective-scopes.ts:57-113` | |
| AUTH-09 | met | Owner approval `aimeat/src/routes/agents/device-auth.ts:695-714,762-763`. Same-owner approval `device-auth.ts:337-353` (the approver must be an agent of the same owner and hold `agent:write`; applications and ecosystem principals never approve), `:470-497` (a scope beyond the approving agent's own leaves the request pending for the owner; `approvedBy` names the approver) | Met under the ruling of 2026-10-12 (Q4). The operator can switch same-owner approval off (`sameOwnerAutoApprove`, default on). |
| AUTH-10 | met | `aimeat/src/routes/agents/constants.ts:25`; `aimeat/src/routes/agents/device-auth.ts:359,533,608` | |
| AUTH-11 | met | `aimeat/src/routes/auth.ts` (`spendSignature`) | Closed 2026-10-12: a renewal signature works once. |
| AUTH-12 | met | `aimeat/src/services/ecosystem-refresh.ts:32,70-93`; `aimeat/src/routes/auth.ts:480-506`; pin `aimeat/src/routes/ecosystem-apps.ts:359-397` | |
| AUTH-13 | met | `ECO_REAPPROVAL_SECONDS` 365 days, `aimeat/src/services/ecosystem-refresh.ts:32` | |
| AUTH-14 | met | `aimeat/src/auth/middleware.ts:665-667` | |
| AUTH-15 | met | `aimeat/src/routes/agents-v2/enrolment.ts:83-278` | |
| AUTH-16 | met | `aimeat/src/routes/agents-v2/token.ts:48-199` (EdDSA JWS, `aud` = node id, `jti`, at most 300 s, `spendAssertion`) | |
| AUTH-17 | met | `aimeat/src/routes/agents-v2/card.ts:114-128,158-221,223,247-255` | |
| AUTH-18 | met | `aimeat/src/routes/agents-v2/migrate.ts:135,164`; `aimeat/src/routes/agents-v2/enrolment.ts:173-180,260` | |
| AUTH-19 | met | `aimeat/src/routes/app-grants.ts:375-405,706-720` | PKCE accepts `plain` as well as S256 (`:389-390`). |
| AUTH-20 | met | `aimeat/src/routes/app-grants.ts:745-779` | The refresh token has no expiry and no reuse detection; Core does not require them. |
| AUTH-21 | met | `aimeat/src/routes/app-grants.ts:544-553`; `aimeat/src/auth/account-security.ts:94-98`; `aimeat/src/auth/middleware.ts:253-258` | |
| AUTH-22 | met | `aimeat/src/routes/access-tokens.ts:56-173`; `aimeat/src/services/access-token.ts:25,40-69` | |
| AUTH-23 | met | `aimeat/src/auth/ws-upgrade.ts:44,52,116-139`; `aimeat/src/routes/sse.ts:100-116` | |
| AUTH-24 | met (4.0.0) | `WS_QUERY_TOKEN_REMOVED_IN` in `aimeat/src/config-security.ts`; `authenticateUpgrade` in `aimeat/src/auth/ws-upgrade.ts` refuses `?token=` with `WS_QUERY_TOKEN_DISABLED` from 4.0.0 whatever the setting says; test `aimeat/test/unit/removals-4-0-0.test.ts` | Before 4.0.0 still accepted by default; the 101 answer carries the Deprecation headers (`upgradeDeprecationHeaderLines`). |
| AUTH-25 | met | `aimeat/src/utils/scope-coverage.ts:329-346`; `aimeat/src/routes/agents/device-auth.ts:337` | |
| AUTH-26 | met | `aimeat/src/routes/agents/management.ts:381,395-441`; app grant revoke `aimeat/src/routes/app-grants-manage.ts:216` | |

## 5. Authorization

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| AUTHZ-01 | **met (4.0.0)** | Refusal `aimeat/src/auth/deny.ts:139-165` (403 `SCOPE_DENIED`, `WWW-Authenticate`). The 70 authenticated routes that asked no word carry `requireRestScope` (`aimeat/src/auth/rest-scope-gate.ts`): refused from 4.0.0 (`REST_SCOPE_GATES_ENFORCED_IN`), allowed before it with the Deprecation headers and counted per word in `GET /v1/stats`. Their MCP twins name the same word (catalog `scopeEnforcedFrom`, `aimeat/src/tool-catalog/scopes.ts`). The other authenticated routes either ask a word in the handler or carry a recorded reason why none applies (the caller's own record, the owner in person, no owner data) in `aimeat/security/route-scope-exemptions.json`, and `pnpm check:route-scopes` refuses a new route with neither. The new words `packages:read` and `agent:read` (the owner's agent list, `GET /v1/agents` and its two previews) were given once to every existing agent (`aimeat/src/services/rest-scope-gates-migration.ts`). On a node's first start as 4.0.x, every agent and approved ecosystem app that existed before it gets every word the gates check and it lacks, the existing words included, and its owner is told on the activity feed (`aimeat/src/services/rest-scope-keep-working-migration.ts`). Tests: `aimeat/test/unit/rest-scope-gates.test.ts`, `aimeat/test/unit/rest-scope-gates-migration.test.ts`, `aimeat/test/unit/agent-read-scope.test.ts`, `aimeat/test/unit/rest-scope-keep-working.test.ts`, `aimeat/test/e2e-rest-scope-keep-working.ts`. | An app published before that start whose code calls a gated route its `aimeat-scopes` does not name keeps the word as declared (`aimeat/src/services/app-scope-allowance.ts`, read by `aimeat/src/services/app-scope-needs.ts`; `aimeat/test/e2e-app-scope-allowance.ts`). An app published after it keeps nothing: its publish answer warns, and the call is refused until its author declares the word. |
| AUTHZ-02 | met | `aimeat/src/auth/middleware.ts:469-479,665-669`; app role `aimeat/src/routes/app-grants.ts:549`; ecosystem role `aimeat/src/routes/ecosystem-apps.ts:405` | `requireAnyScope`'s owner bypass lacks the foreign check (`middleware.ts:714`); a federated token no longer carries `owner`, so it does not open. |
| AUTHZ-03 | met | `aimeat/src/utils/scope-coverage.ts:317-323` | |
| AUTHZ-04 | partial | `aimeat/src/utils/scope-coverage.ts:79-304` (19 words, a superset of the minimum in Core) | The list is published in the web app's scope model, not in `openapi.yaml` or discovery. |
| AUTHZ-05 | partial | Per-operation scopes in `openapi.yaml`; tool scopes in `aimeat/src/tool-catalog/definitions/` | No single vocabulary document. Five words exist on MCP only (`commerce:psp`, `commerce:beneficiary-verify`, `consent:groups`, `social:members`, `messages:read-as-owner`). |
| AUTHZ-06 | met | Password `aimeat/src/routes/ghii/recovery.ts:376`; TOTP `aimeat/src/routes/totp.ts:57`; sessions `aimeat/src/routes/auth.ts:592-671`; agent approval `aimeat/src/routes/agents-v2/agent-proposals.ts:159,370`; delete `aimeat/src/routes/owners.ts:287`; export `aimeat/src/routes/owners/export.ts:97`; AI keys `aimeat/src/routes/ai-providers.ts:88-117` | 64 code uses of `requireOwnerPrincipal` in routes. The same-owner agent approval of AUTH-09 is the exception the requirement names. |
| AUTHZ-07 | met | `aimeat/src/auth/account-security.ts:82-99,144-162` | |
| AUTHZ-08 | met | `aimeat/src/routes/setup.ts:183-189`; `aimeat/src/routes/ghii/register-login.ts:235-243`; `aimeat/src/routes/ghii/owner-session.ts:96-104` | |
| AUTHZ-09 | met | `aimeat/src/auth/operator-gate.ts:52-93`; `aimeat/src/services/operator-principal.ts:14-19` | |
| AUTHZ-10 | met | `aimeat/src/services/operator-override.ts:1-27` (used in 25 files, for example `aimeat/src/routes/consent.ts:185`) | Not verified that every operator act on another owner's data goes through it. |
| AUTHZ-11 | met | `aimeat/src/services/consent-write.ts:185`; operator path `aimeat/src/routes/consent.ts:185` | |
| AUTHZ-12 | met | `aimeat/src/storage/providers/sqlite/methods/consent.ts:105-126` | |
| AUTHZ-13 | met | `aimeat/src/routes/consent.ts:128-171`; `aimeat/src/services/consent.ts:158-160`; retention 365 days `aimeat/src/config-data-access.ts:46` | |
| AUTHZ-14 | met | `aimeat/src/routes/consent.ts:38,90,97,128,174,209`; `aimeat/src/services/consent-write.ts:88-103` | `consent:manage` is inside the wildcard. |
| AUTHZ-18 | met (4.0.0) | `aimeat/src/utils/consent-reach.ts` (`CONSENT_REACH_LOCAL_DEFAULT_IN`, `consentReachOf`); `grantConsent` in `aimeat/src/services/consent-write.ts` takes `local`, `federation`, `auth`, stores `private` and `dmz` as `local` (with the Deprecation headers) and gives an absent reach `local` from 4.0.0; both providers read a stored `private` or `dmz` as `local`; test `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts` | Before 4.0.0 an absent reach is still `federation`. The compliance roll-up (`consentFacets`) groups by the stored value. |
| AUTHZ-15 | met | `aimeat/src/services/access-guard.ts:88-175`; `aimeat/src/services/consent.ts:48-151` | Boards and the organism key gate run their own consent checks (`aimeat/src/routes/boards.ts:452`, `aimeat/src/services/organism-namespace-access.ts:148-172`); both are stricter, not looser. |
| AUTHZ-16 | partial | Provenance answers one 404 (`aimeat/src/routes/ai-provenance.ts:230-287`); memory read 404 | Not verified on every route. |
| AUTHZ-17 | partial (SHOULD) | `aimeat/src/middleware/refusal-recorder.ts`; `aimeat/src/auth/deny.ts`; `aimeat/src/services/auth-audit.ts` | Every HTTP 401 and 403 reaches the refusal log since 2026-10-16, including the 403s written directly in route handlers. A refusal inside an MCP tool is a tool result, not an HTTP status: it is noted on the agent's card, not in this log. |
| CLS-01 | met | `aimeat/src/services/classification/reader.ts` (show, useForAi, leave); gate `aimeat/security/classification-reach.json` | |
| CLS-02 | met | `aimeat/src/services/classification/exceptions.ts:9-38` (a person's exception with a reason; an application's automatic exception with the application and the act as its reason, on the same list; each making, use and withdrawal writes an audit row); `aimeat/src/services/classification/egress.ts`; `aimeat/src/services/classification/reader.ts:105-111` | Met under the ruling of 2026-10-12 (Q9). |
| CLS-03 | met | `aimeat/src/services/classification/reader.ts` (`useForAi`) | |
| CLS-04 | met | `aimeat/src/middleware/refusals.ts:123-141` | |
| CLS-05 | met | `aimeat/src/services/classification/levels.ts:7-21` (`POLICY_DILUTES`) | |
| CLS-06 | met | `aimeat/src/services/classification/switch.ts:9-21` (`PERSON_REQUIRED`); `aimeat/src/services/classification/policy-admin.ts:13-17`; owner in audience `aimeat/src/services/classification/audience.ts:16-29` | |
| CLS-07 | met | `aimeat/src/services/classification/audit.ts:5-38` | |
| CLS-08 | met | `aimeat/src/services/classification/labels.ts:235-236` | |
| Classification default off | fact | `aimeat/src/config-data-access.ts:24-40,50` (`off`, `owner`, `all`) | |
| Built-in levels | fact | `aimeat/src/services/classification/defaults.ts:129-153` (`julkinen` 0, `sisainen` 10 default, `luottamuksellinen` 20, `erittain-luottamuksellinen` 30) | |
| IAM not enforcing | fact | `aimeat/src/services/iam/model.ts:6-10` | |

## 6. Data

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| DATA-01 | met | `aimeat/src/storage/providers/sqlite/methods/memory.ts:201` (key per `ownerGaii`) | |
| DATA-02 | met | `aimeat/src/routes/memory/key.ts:418-421` | |
| DATA-03 | met | `aimeat/src/services/memory-write.ts:485`; `aimeat/src/routes/memory/key.ts:516` | |
| DATA-04 | met | `aimeat/src/models/schemas.ts:152`; `aimeat/src/routes/memory/key.ts:424-429`; `aimeat/src/services/memory-write.ts:418-427` | |
| DATA-05 | met | `aimeat/src/routes/memory/key.ts:524-532` (`setMemoryIfVersion`) | |
| DATA-06 | **gap** | Type allows six `aimeat/src/storage/types/commerce.ts:30,266` | Record writes accept five values, without `workspace` (`aimeat/src/models/schemas.ts:127,148`); bulk accepts `workspace` with no reference (`aimeat/src/routes/memory/bulk.ts:156`); chunked upload lacks `members` (`schemas.ts:349`); changing a file's visibility allows only three (`aimeat/src/routes/storage-files.ts:381`); `group` is stored without a group id (`aimeat/src/services/memory-write.ts:481`). Ruling of 2026-10-12 (Q10): one vocabulary of six on records and files in 4.0.0. |
| DATA-07 | met | `aimeat/src/routes/memory/shared.ts:63-73`; `aimeat/src/services/memory-replication.ts:229-230` | |
| DATA-08 | met | `aimeat/src/routes/organisms/workspace-rows.ts:133` | |
| DATA-09 | met | `aimeat/src/routes/organisms/workspace-rows.ts:190-212` | |
| DATA-10 | met | `aimeat/src/services/workspace-rows/row-service.ts:378-399` | Retention runs after an append only; no timer calls the sweep (`row-service.ts:341`). |
| DATA-11 | met | `aimeat/src/routes/storage-files-chunked.ts:69,135,186,267`; `aimeat/src/services/storage-file-write.ts:305-308` | |
| DATA-12 | met | `aimeat/src/utils/http-range.ts:344` | |
| DATA-13 | partial | `aimeat/src/routes/storage-files.ts:415,456,529` | With the consent layer off, a non-public file answers 404 even to a member who could read it. |
| DATA-14 | met | `aimeat/src/routes/memory/key.ts:461-470`; `aimeat/src/services/memory-write.ts:341` | |
| DATA-15 | met | `aimeat/src/routes/schemas.ts:37,119,144` (`SCHEMA_LOCKED_BY_OTHER`) | |
| DATA-16 | met | `aimeat/src/routes/spec.ts:57-77`; `aimeat/src/services/contract-docs.ts:30`; `openapi.yaml` `/v1/specs/{name}` | `openapi.yaml` lists three names, the code serves five. |
| DATA-17 | n/a | Where the node reads its own records it checks `spec`: `aimeat/src/services/data-map/data-map-access.ts:108`, `aimeat/src/services/agent-ties.ts:95` | |
| DATA-18 | n/a | Editorial rule | |
| DATA-19 | partial | Read time `aimeat/src/routes/memory/key.ts:174-181`, `aimeat/src/storage/providers/sqlite/methods/memory.ts:190-194,615-623`; job `aimeat/src/services/core-jobs.ts:262-280` | The job walks agents only (`listAgents()`), so expiry of an owner's own records rests on the read path; not verified for list and search on Postgres. |
| DATA-20 | met | `aimeat/src/storage/providers/sqlite/methods/memory.ts:197-207` (`deletedAt IS NULL`) | |
| DATA-21 | met | `aimeat/src/routes/memory/key.ts:105-118,297-321`; `aimeat/src/config.ts:323` | |
| DATA-22 | met | `aimeat/src/services/memory-bin-sweep.ts`; started at `aimeat/src/server-bootstrap/service-init.ts:517-521` | |
| DATA-23 | met | `aimeat/src/services/memory-bin.ts:145-154` | |
| DATA-24 | met | `aimeat/src/storage/types/commerce.ts:55-63`; `aimeat/src/routes/memory/crud.ts:325` | |
| DATA-25 | met | `aimeat/src/services/archive.ts:107,129` (`archivedRoot`) | |
| DATA-26 | met | 413 `QUOTA_EXCEEDED` at `aimeat/src/services/memory-ceilings.ts:81,103,114`, and at memory copy (`aimeat/src/routes/memory/bulk.ts`) since 2026-10-12 | Memory copy answered 429 until 2026-10-12. Not covered by a test that fills a quota. |
| DATA-27 | partial | Deleted list uses the classification reader (`aimeat/src/routes/memory/key.ts:108-109`) | Not verified that search applies classification to every result. |
| DATA-28 | met | `aimeat/src/services/event-bus.ts:47-81`; `aimeat/src/routes/sse.ts:83,119,189` | |

## 7. Collaboration

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| COL-01 | met | `aimeat/src/services/organism-namespace-access.ts:53-54`; `aimeat/src/services/workspace-roles.ts:5-16` | |
| COL-02 | partial | Roles `aimeat/src/storage/types/organisms-federation.ts:126-137`; join `aimeat/src/routes/organisms/crud.ts:356`; invitations `aimeat/src/routes/organisms/membership.ts:477` | Not verified that the last admin cannot leave; an operator repair word exists for organisms nobody can reach (`aimeat/src/utils/scope-coverage.ts:116`). |
| COL-03 | met | `aimeat/src/services/organism-agent-access.ts:13-52`; `aimeat/src/routes/organisms.ts:127-145` | |
| COL-04 | met | `aimeat/src/services/organism-namespace-access.ts` (content owned by the writer's identity) | |
| COL-05 | met | `aimeat/src/services/organism-export.ts` (header); `aimeat/src/routes/organisms/workspace-transfer.ts:108,135` | |
| COL-06 | met | `aimeat/src/routes/organisms/shared.ts` (publish, about 255-265); `aimeat/src/config.ts:326` (20 versions) | |
| COL-07 | met | `aimeat/src/services/write-guards.ts:166-186` | |
| COL-08 | met | `aimeat/src/services/write-guards.ts:160-164`; `aimeat/src/routes/organisms/gates.ts:248-252`; `aimeat/src/services/memory-bin.ts:145-154` | |
| COL-09 | partial | `aimeat/src/routes/organisms/workspace-access.ts:389-410` (`organism:invite`); `aimeat/src/services/workspace-roles.ts:46,86` | Not verified that an owner who is a plain member is refused. |
| COL-10 | partial | `aimeat/src/routes/organisms/workspace-read.ts:523-641` | Read-gate inheritance not verified. |
| COL-11 | met | `aimeat/src/routes/organisms/gates.ts` (schema failure 422) | |
| COL-12 | met | `aimeat/src/routes/boards.ts:370,432-442,509` | |
| COL-13 | met | `aimeat/src/services/board-post.ts:89,223,364-374`; sweep `aimeat/src/services/job-seeding.ts:54` | |
| COL-14 | met | `aimeat/src/services/board-write.ts:388-398` | |
| COL-15 | met | `aimeat/src/services/board-moderation.ts:25-38`; threshold `aimeat/src/config.ts:593` | |
| COL-16 | met | `aimeat/src/services/board-subscribers.ts:34-58` | The SHOULD is not met: the push carries no signature. |
| COL-17 | met | `aimeat/src/services/board-post.ts:124-129,193-197` | The code calls it a post cost and an anti-flood price; see PACE-11. |
| COL-18 | met | `aimeat/src/services/message-send.ts:261-269,327-335`; `aimeat/src/routes/messages.ts:688,714,740` | |
| COL-19 | met | `aimeat/src/services/message-delivery.ts:95-123,194-221`; `aimeat/src/routes/federation-sync/messaging.ts:243` | |
| COL-20 | met | `aimeat/src/services/conversation-group.ts`; `aimeat/src/storage/types/direct-messages.ts:180-215` | Group threads are node-local, with one remote party allowed. |

## 8. Pacing and metering

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| PACE-01 | met | `aimeat/src/storage/providers/sqlite/repos/ghii-resolve.ts:20-36`; `aimeat/src/utils/gaii.ts:508-513` | |
| PACE-02 | met | Job `aimeat/src/services/core-jobs.ts:60,218-224`; 50 a day, cap 500 `aimeat/src/config.ts:315-316` | The job credits once per agent, so an owner with several agents gets several credits up to the cap. |
| PACE-03 | met | `aimeat/src/storage/providers/sqlite/methods/wallet.ts:21-61`; `aimeat/src/storage/providers/postgres-kysely/methods/wallet.ts:75-117` | |
| PACE-04 | met | `aimeat/src/services/daily-allowance.ts` | Closed 2026-10-15: the allowance credits each person once and writes a ledger row. |
| PACE-05 | **gap** | `isMoneyCurrency` `aimeat/src/commerce/money.ts:49-54`; ACP and UCP refuse a non-money session `aimeat/src/commerce/protocol-money.ts:34-74`; morsel handler removed `aimeat/src/commerce/payment-handlers.ts:19-21,57` | Marketplace listing rows still carry `{ unit: 'morsels', basePrice: n }` (`aimeat/src/services/exchange-source-terms.ts:89-90`). |
| PACE-06 | met | `aimeat/src/commerce/pacing-pack.ts:1-107` (inside the daily mint cap, `:95-102`) | Off by default. |
| PACE-07 | met | `aimeat/src/models/offer-schemas.ts:167-189`; `aimeat/src/models/app-tool-schemas.ts:107-139`; `aimeat/src/storage/types/organisms-federation.ts:380-398` | |
| PACE-08 | met | `aimeat/src/services/metered-settlement.ts:80-86` (`resolvePacingToll`: the provider's amount, the node default when none, clamped to the ceiling); ceiling `aimeat/src/config.ts:631`; `aimeat/src/models/offer-schemas.ts:225` | Node default 0 (`aimeat/src/config.ts:641`). |
| PACE-09 | met | `aimeat/src/services/metered-settlement.ts:122-185` (`chargePacing`: one transaction; debit, burn at `burnRate`, an existing operator share `:133-136`, the rest to the provider, every ledger row; `reverse` gives it all back); burn rate 10 % by default `aimeat/src/config.ts:317`; chokepoint `aimeat/src/services/metered-access.ts:335-347`; own use free `aimeat/src/routes/extensions/pacing.ts:69` | The operator share applies only to flows that had a marketplace fee before the pacing ruling; with no operator account it burns. |
| PACE-10 | met | `aimeat/src/commerce/pacing-pack.ts:43-49` (`insufficientMorselsMessage`: the daily allowance and, when the operator sells one, the pacing pack); used by checkout `aimeat/src/commerce/session-service.ts:594` and by the metered refusal `aimeat/src/routes/extensions/metered-response.ts`; `aimeat/src/routes/extensions/pacing.ts:76-79` | |
| PACE-11 | **gap** | | Capabilities exposed the pacing amount as `cost.morsels`; since 4.0.0 it is `cost.toll_morsels`, and the old name is deprecated until 5.0.0 (`aimeat/src/services/toll-morsels-names.ts`). Listing rows call it `basePrice` (PACE-05); board code calls it a price (`aimeat/src/services/board-post.ts`). |
| PACE-12 | met | `aimeat/src/services/usage-metering.ts:79,226-250`; `aimeat/src/services/ai-usage-record.ts:185-212`; `aimeat/src/routes/ledger.ts:170-345` | |
| PACE-13 | met | No conversion path found | |
| PACE-14 | met | `requireScope('ai:use')` in 14 places | |
| PACE-15 | met | `aimeat/src/services/ai/call-guards.ts:98-120`; `aimeat/src/services/ai-daily-budget.ts:20`; `aimeat/src/services/ai/completion.ts:478-480` | |
| PACE-16 | met | `aimeat/src/services/ai/call-guards.ts:47-56,75-92`; `aimeat/src/services/ai/route-plan.ts:326` | |
| PACE-17 | n/a | A rule about profile claims | |
| PACE-18 | met | `aimeat/src/models/offer-schemas.ts:174-189` | |
| PACE-19 | met | `aimeat/src/routes/commerce.ts:337`; `PaymentHandler` with collect, payout, refund `aimeat/src/commerce/types.ts:243` | |
| PACE-20 | met | `aimeat/src/commerce/agent-purchase-limit.ts:43-151` | |
| PACE-21 | met | `payment_bindings` in `/.well-known/aimeat` and in `GET /` `this_node`, from `paymentBindings` in `aimeat/src/services/core-discovery.ts` (`stripe`, `invoice`, `ucp`, `acp`, and `x402` when it is on; none while commerce is off). Binding documents: `/.well-known/x402.json` `aimeat/src/routes/agent-conventions.ts:250`; `/.well-known/acp.json` `aimeat/src/routes/commerce-acp.ts:157`; UCP profile in `aimeat/src/routes/wellknown.ts` | Listed in every release, not only from 4.0.0. |
| Bindings | fact | Stripe `aimeat/src/commerce/stripe-handler.ts:5-12`; UCP `aimeat/src/routes/ucp-checkout.ts:129-184`; ACP `aimeat/src/routes/commerce-acp.ts:293-313`; x402 `aimeat/src/commerce/x402.ts:48-109`; registry `aimeat/src/commerce/payment-handlers.ts:29-39`, `aimeat/src/server-bootstrap/routes-loader.ts:420-440` | A `test.money` handler exists for end-to-end tests and for testing the money path in production. It is registered whenever its flag is set; on a node whose base URL is not loopback, the start log and the Security page report it as critical (`aimeat/src/utils/test-money-guard.ts:41-49`). It is not a binding of Core §8.6. |

## 9. Federation

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| FED-01 | met | `aimeat/src/services/federation-peer-gate.ts:104-136` (403 `POLICY_DENIED`) | |
| FED-02 | met | `aimeat/src/services/federation-tiers.ts:164-194`; `aimeat/src/routes/federation-peer/peers.ts:491` | |
| FED-03 | met | `aimeat/src/routes/federation-sync/catalogue-trust.ts:178` | |
| FED-04 | met | `aimeat/src/services/federation-peer-gate.ts:146-148`; `aimeat/src/services/memory-replication.ts:140`; `aimeat/src/routes/federation-sync/routing.ts:182,253,415` | |
| FED-05 | met | `aimeat/src/routes/federation-peer/link-invites.ts:31-42`; `aimeat/src/routes/federation-peer/introduce.ts:238-277` | |
| FED-06 | **gap** | Hash and expiry `aimeat/src/services/link-invites.ts:51,65-66,83` | Single use is a read then a write, not an atomic step (`aimeat/src/services/link-invites.ts:133-163`); two concurrent introductions can both pass. |
| FED-07 | met | `aimeat/src/routes/federation-peer/introduce.ts:315-333` | |
| FED-08 | partial | `aimeat/src/services/signed-node-request.ts` (`checkNodeRequest`, `audienceRefusal`, `deliveryRefusal`, `signedMessageRefusal`, `signedGetRefusal`); window `aimeat/src/services/request-nonce.ts:24`. The template listing (`aimeat/src/routes/federation-sync/templates.ts`) and the service summary (`aimeat/src/routes/federation-peer/introduce.ts`) check signature, audience, window and single use since 2026-10-16; the settlement (`aimeat/src/routes/federation-settlements.ts`) checks its audience (`to_node`), its window and its tracking code once. Tests `aimeat/test/e2e-federation-settlements-sync.ts`, `aimeat/test/e2e-federation-contact-link.ts` | The replay cache is an in-process map (`request-nonce.ts:27-49`); it holds for a single-process node only. The key exchange and the trust advisory are outside FED-08 as section 9.3 says. The emergency de-peering notice (`aimeat/src/services/federation-peer-remove.ts`) is sent unsigned to the receiving node's trust-advisory route, which asks for an operator credential, so no node acts on it. |
| FED-09 | met (4.0.0) | `UNPROVEN_FORMAT_REMOVED_IN` and `unprovenFormatLive` in `aimeat/src/config-federation.ts`; `audienceRefusal` and `deliveryRefusal` in `aimeat/src/services/signed-node-request.ts` refuse a message without the proof from 4.0.0 whatever `required` says, and the environment cannot turn `federation.audience_required` off from then; test `aimeat/test/unit/removals-4-0-0.test.ts` | Before 4.0.0 `AIMEAT_FEDERATION_AUDIENCE_REQUIRED=false` still lets one in, counted (`deprecated_use: federation_unproven_format`) and with the Deprecation headers. |
| FED-10 | met (4.0.0) | `RELAY_CLAIM_OPTIONAL_REMOVED_IN` in `aimeat/src/config-federation.ts` (re-exported by `aimeat/src/services/relay-claim-policy.ts`); `effectiveRelayClaim` answers `required` from 4.0.0 whatever the node or the peer says, `parsePeerRelayClaim` refuses `optional`, the environment's `optional` reads as `required`; `aimeat/src/middleware/relay-gate.ts`; test `aimeat/test/unit/removals-4-0-0.test.ts` | Before 4.0.0 an unclaimed relay let through on `optional` carries the Deprecation headers. |
| FED-11 | met | `aimeat/src/services/signed-node-request.ts:296-341` (`pinnedRefusal`) | |
| FED-12 | partial | `aimeat/src/utils/protocol-version.ts:28-71` | The introduction never passes the stated version to the check (`aimeat/src/routes/federation-peer/introduce.ts:244`), so every peer reads as `v1`. |
| FED-13 | met (4.0.0) | `PEER_HTTPS_REQUIRED_IN` and `peerUrlRefusal` in `aimeat/src/services/peer-url-policy.ts`, asked by the introduction, the peering request, the readiness test, adding and editing a peer, a re-admission, a genesis peering and the key exchange (`aimeat/src/services/federation-helpers.ts`); test `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts` | A public node refuses a plain-http peer address from 4.0.0 (400 `PEER_HTTPS_REQUIRED`); a local node keeps plain http (ruling Q16). A peer row stored with an http address before 4.0.0 is not rewritten; the key exchange refuses it, and other outbound calls to such a row are not checked one by one. |
| FED-14 | met | `aimeat/src/routes/federation-peer/peers.ts:159-228` (`KEY_ROTATION_DENIED`) | |
| FED-15 | met | `aimeat/src/services/federation-peer-remove.ts:55-118` | |
| FED-16 | **gap** | `aimeat/src/routes/federation-auth.ts:63-200` | The home node checks the tier ceiling for federated sign-in, not the peer's own permission word (`federation-auth.ts:101`). |
| FED-17 | met | `aimeat/src/auth/account-security.ts:86-92`; `aimeat/src/auth/jwt.ts:217-221` | |
| FED-18 | met | Same read decision path (`aimeat/src/services/access-guard.ts:88-175`) | |
| FED-19 | met | `aimeat/src/services/a2a-foreign.ts:5-35` | |
| FED-20 | met | `aimeat/src/services/memory-replication.ts:63-86,131,140`; `aimeat/src/services/classification-exits.ts:61-71` | |
| FED-21 | met | `aimeat/src/routes/memory/shared.ts:63-73`; `aimeat/src/services/memory-replication.ts:229-230` | |
| FED-22 | met | `aimeat/src/services/memory-replication.ts:158` | The SHOULD is not met: the reference is outside the signed payload (`:166-174`) and the receiver does not check it (`aimeat/src/routes/federation-sync/messaging.ts:132-217`). |
| FED-23 | met | `aimeat/src/services/personal-tunnel.ts:131-132,278-315` | `sendRequest` (`:317`) has no caller: no live forwarding, as Core says. |
| FED-24 | met | `aimeat/src/auth/ws-upgrade.ts:44` (personal and connect tunnels) | Accepts `?token=` before node 4.0.0 (AUTH-24). |
| FED-25 | met | `aimeat/src/services/connect-tunnel.ts:4-17,126`; `aimeat/src/services/connect-tunnel-forward.ts:6-13` | Opt-in, `aimeat/src/config.ts:427`. |
| Heartbeat states | fact | `aimeat/src/services/federation.ts:256,410-434` (active, degraded after 3 misses, offline after 10) | v4.0 said `unreachable`; the code writes `offline`. |
| Relay shares unpaid | fact | `docs/known_gaps.md:32-42` (GAP-001); `aimeat/src/services/morsel.ts:175-201` | |
| Package repository uses signed node requests | fact | `aimeat/src/services/packages/peer/package-pull.ts:278,440,510`; `aimeat/src/services/packages/peer/package-node-auth.ts:81` | A request with no node headers returns null rather than a refusal. |

## 10. Provenance

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| PROV-01 | met | `aimeat/src/routes/ai-provenance.ts:190-195`; `aimeat/src/models/ai-provenance-schemas.ts:296-363` | |
| PROV-02 | n/a | Reader rule | |
| PROV-03 | partial | Stated at `aimeat/src/services/ai-provenance.ts:597`, `aimeat/src/models/ai-provenance-schemas.ts:143` | Not verified that no publish path raises the value. |
| PROV-04 | met | `aimeat/src/models/ai-provenance-schemas.ts` (camelCase record) | The MCP wrapper says `record_url`, the envelope wrapper `recordUrl`; both are wrappers, as Core allows. |
| PROV-05 | n/a | Editorial rule | |
| PROV-06 | met | `aimeat/src/storage/repositories/ai-provenance.repository.ts:5-8,41-116` (no update, no delete) | |
| PROV-07 | met (4.0.0) | `PROVENANCE_SWITCH_LOCAL_ONLY_IN` and `aiProvenanceFromEnv` in `aimeat/src/config-ai-label.ts`, read by `aimeat/src/config.ts`; the start-up check says the setting was refused (`aimeat/src/config-posture.ts`); test `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts` | From 4.0.0 a public node records whatever `AIMEAT_AI_PROVENANCE` says; a local node keeps the switch (ruling Q17). Before 4.0.0 the switch still works on a public node, and the start-up check says it stops working in 4.0.0. |
| PROV-08 | met | `aimeat/src/services/app-serve-marks-strip.ts:173`; `aimeat/src/services/app-publish.ts:284-293`; `aimeat/src/services/app-serve-marks.ts:240` | HTML only. |
| PROV-09 | met | `aimeat/src/services/ai-provenance-marks.ts:618-647` | |
| PROV-10 | met | `aimeat/src/routes/ai-provenance.ts:152,201-227` (60 a minute per address) | |
| PROV-11 | met | `aimeat/src/routes/ai-provenance.ts:240` | |
| PROV-12 | partial | `aimeat/src/services/ai-provenance-marks.ts:282-287` | Not verified on every re-serialising route. |
| PROV-13 | met | `disclosure` computed in `aimeat/src/models/ai-provenance-schemas.ts` | |
| PROV-14 | met (SHOULD) | Served labels, `aimeat/src/config-ai-label.ts` | |
| PROV-15 | met | `aimeat/src/config-ai-label.ts:20-26` (`off` becomes `strict` on a public node) | |
| PROV-16 | partial | `aimeat/src/routes/ai-transparency.ts:335,353` | Not verified that an unset authority reads as unstated. |

## 11. Bindings

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| HTTP-01 | **gap** | `aimeat/src/middleware/envelope.ts:36-47,66-78,118-139` | Idempotency errors are `{ok, error}` only (`aimeat/src/middleware/idempotency.ts:112-155`); the 429 lacks `node` and `request_id` (`aimeat/src/middleware/rate-limit.ts:102-116`); the JSON 404 and the global error handler lack `request_id` (`aimeat/src/server.ts:326-351`). |
| HTTP-02 | **gap** | `error()` always adds hints, `aimeat/src/middleware/envelope.ts:127-139` | The same middleware errors carry no hints. |
| HTTP-03 | met | String codes at each call site | No central list; validation uses three codes (`INVALID_INPUT` 816 uses, `VALIDATION_ERROR` 73, `BAD_REQUEST` 45). Core names `INVALID_INPUT`. |
| HTTP-04 | met | `aimeat/src/middleware/envelope.ts:59-64` | |
| HTTP-05 | met (SHOULD) | `aimeat/src/middleware/idempotency.ts:40-41,68-71,91,131-177` | The body of a reused key is not compared; the cache is in-process (10 000 entries, 24 hours). |
| HTTP-06 | met | `aimeat/src/middleware/rate-limit.ts:96-101` (`Retry-After`, `X-RateLimit-*`) | |
| HTTP-07 | met | `noteDeprecatedUse` in `aimeat/src/services/deprecation.ts` sets `Deprecation: true`, `X-AIMEAT-Removed-In` and the successor `Link` on the response through the request context (`aimeat/src/middleware/request-id.ts`), counts the use (`deprecated_use_by_type` in `GET /v1/stats`) and logs it once a day; called by the owner-key sign-in, the legacy AI settings routes, an unclaimed relay, an unproven federation message, the static TURN pair, `costCapMorsels`, a consent reach alias and a plain-http peer address; the WebSocket upgrade adds the headers to its 101 answer; the 410 of the legacy AI settings routes names the successor | The MCP OAuth flow without PKCE (`aimeat/src/mcp/oauth-binding.ts`) keeps its own counter and log and sends no header on the OAuth answers. |
| HTTP-08 | met (4.0.0) | Every 4.0.0 removal has its own `*_REMOVED_IN` constant and is refused from that release whatever the configuration says: `aimeat/src/config-security.ts`, `aimeat/src/config-federation.ts`, `aimeat/src/config-pacing.ts`, `aimeat/src/config-ai-models.ts`, `aimeat/src/config-turn.ts`, `aimeat/src/services/workflow/store.ts`, `aimeat/src/mcp/oauth-binding.ts`; the environment defaults read off and the Config page refuses the value that would keep one on (`aimeat/src/services/config-schema-validators.ts`); test `aimeat/test/unit/removals-4-0-0.test.ts` | |
| MCP-01 | met | `aimeat/src/mcp/index.ts:613-697` | |
| MCP-02 | met | `aimeat/src/tool-catalog/surfaces.ts:118`; `aimeat/src/mcp/index.ts:680-709`; listed in the bootstrap document `aimeat/src/routes/bootstrap.ts:553-559` | Eight surfaces: appdev, agent, service, admin, commerce, primitives, chat, full. |
| MCP-03 | met | `aimeat/src/mcp/legacy-sessions.ts` (`servePost`, the session-to-principal check); `aimeat/src/mcp/modern-endpoint.ts` (`serve`) | Since 2026-10-20 (erratum E1): a 2025-era session is bound to the principal that opened it; a 2026-07-28 request has no session and is authenticated on its own (`authenticate()` in `aimeat/src/mcp/index.ts`, then the agent admission in `aimeat/src/services/mcp-agent-admission.ts`), proven by `aimeat/test/e2e-mcp-modern.ts`. |
| MCP-04 | met | `aimeat/src/mcp/index.ts:498-517` | |
| MCP-05 | met | `aimeat/src/mcp/oauth.ts:633-675`; `aimeat/src/services/protected-resource.ts:104-116` | |
| MCP-06 | met | `aimeat/src/mcp/oauth-binding.ts` | Closed: S256 PKCE is required from 4.0.0. |
| MCP-07 | met (4.0.0) | Binding: every MCP OAuth access token names the MCP endpoint as `aud`, a `resource` that is not this node's MCP endpoint is refused from 4.0.0 (`aimeat/src/mcp/oauth-binding.ts` `resourceRefusal`, `mcpResourceOf`). Refusal at the MCP endpoint: a token whose `aud` names another resource is refused in every release (`mcpAudienceRefusal`, called from `aimeat/src/mcp/index.ts` `authenticate`). Refusal on REST: a token bound to the MCP endpoint is refused from 4.0.0 with 401 `invalid_token` (`aimeat/src/auth/mcp-token-on-rest.ts`, asked by `optionalAuth` and `requireAuth` in `aimeat/src/auth/middleware.ts`); the node's own MCP tools that reach REST routes for the session carry an in-process pass bound to the token (`aimeat/src/auth/loopback-pass.ts`). Tests: `aimeat/test/unit/mcp-oauth-binding.test.ts`, `aimeat/test/unit/mcp-token-on-rest.test.ts` (4.0.0 and 3.26.1), `aimeat/test/e2e-mcp-token-rest.ts` | Before 4.0.0 an MCP OAuth token on a REST route is accepted with the Deprecation headers and counted (`mcp_token_on_rest`). A token without `aud` is not judged on REST, because the node's chat and the commerce fulfilment mint MCP-client tokens without one for REST use. The WebSocket upgrades and the connector tunnel attach verify tokens on their own and do not ask the audience. |
| MCP-08 | met (SHOULD) | `aimeat/src/mcp/oauth.ts:78-160` | |
| MCP-09 | partial | `aimeat/src/tool-catalog/definitions/types.ts:71-74`; `aimeat/src/tool-catalog/scopes.ts:191-215`; `aimeat/src/mcp/index.ts:288-315` | A tool's scope equals its route's by declaration, and no check compares them. `AIMEAT_MCP_ENFORCE_SCOPES=false` switches scope checks off on MCP (`aimeat/src/config.ts:614`). |
| MCP-10 | met | All 430 catalog names begin `aimeat_` | No check enforces it. |
| MCP-11 | met | `aimeat/src/tool-dispatch/index.ts:82` (`withDeclaredInputOnly`); `pnpm check:mcp-schemas` | |
| MCP-12 | partial (SHOULD) | `aimeat/src/mcp/tool-error.ts` | 333 older failures keep three text shapes. |
| MCP-13 | met | `aimeat/src/mcp/ai-provenance-result.ts`; `aimeat/src/services/ai-provenance-marks.ts:245,262-266` | |
| MCP-14 | met | `aimeat/src/services/mcp-client/hops.ts:39-85`; `aimeat/src/mcp/index.ts:392-401` | Answers a JSON-RPC error, not HTTP 508. |
| DISC-01 | met (4.0.0) | `coreDiscoveryFields` in `aimeat/src/services/core-discovery.ts` (`CORE_PROTOCOL_FROM` 4.0.0), spread into `/.well-known/aimeat` (`aimeat/src/routes/wellknown.ts`) and `GET /` `this_node` (`aimeat/src/routes/bootstrap.ts`); `endpoints.mcp` names the MCP endpoint, `endpoints.auth` stays a string and names the owner sign-in `/v1/ghii/login`, and the additive `endpoints.sign_in` object names each current way to get a token (changes inside v1 are additive, §0.2); `CORE_PROTOCOL_VERSION` in `aimeat/src/utils/protocol-version.ts`, held to `x-aimeat-protocol` in `openapi.yaml` by `aimeat/security/protocol-versions.json` (`aimeat-core`); test `aimeat/test/unit/core-2026-11-from-4-0-0.test.ts` | From 4.0.0 both documents state `protocol_version: "2026-11"` and the claimed profiles; before it both fields are left out, because a 3.x node does not keep the edition's removals. |
| DISC-02 | met (4.0.0) | `aimeat/src/services/core-discovery.ts` (header) | No earlier edition has a dated name and a 3.x peer states no protocol version, so a 4.0.0 node accepts no earlier edition it could name, and `protocol_versions_accepted` is left out until it does. |
| DISC-03 | **gap** | `aimeat/src/services/did-document.ts:30-56`; `aimeat/src/server-bootstrap/routes-loader.ts:680-688` | The default id is `did:web:${nodeId}.aimeat.example` (`aimeat/src/services/vc-issuer.ts:46`), which does not match the host unless the operator sets it. |
| DISC-04 | met | `aimeat/src/routes/wellknown.ts` (the MCP server card) | Since 2026-10-20 the card declares MCP `2026-07-28`, the highest revision the node serves, and lists every served revision in `supportedProtocolVersions` (`aimeat/src/mcp/protocol-version.ts`, held to `server/discover` and `initialize` by `aimeat/test/unit/mcp-protocol-version.test.ts`). It said `2025-06-18` until 2026-10-19 and `2025-11-25` until 2026-10-20. |
| DISC-05 | met | Same as PACE-21 | |

## 12. Security invariants

| ID | Status | Evidence | What is missing |
|---|---|---|---|
| SEC-01 | met | `aimeat/src/utils/gaii.ts:383-414` | |
| SEC-02 | met | `aimeat/src/utils/reserved-keys.ts:123,333-393`; `aimeat/src/utils/scope-coverage.ts:86` | |
| SEC-03 | **met (4.0.0)** | Same as AUTHZ-01: every authenticated route that changes data asks a scope word (`requireScope`, `requireRestScope`), admits only the person (`requireOwnerPrincipal`, the owner or operator role), or carries a recorded reason in `aimeat/security/route-scope-exemptions.json`; `pnpm check:route-scopes` holds it. | |
| SEC-04 | met | `aimeat/src/utils/url-validator.ts`, `aimeat/src/utils/outbound-connect-guard.ts`, `aimeat/src/utils/blocked-ip.ts` | Every validated hop connects through a dispatcher whose lookup checks the address the socket opens to, so DNS rebinding is refused at connect time; the loopback exception is decided on an address, never on host text (QA audit S4-01, S4-02, 2026-10-16). |
| SEC-05 | met | `aimeat/src/services/signed-node-request.ts:99-136`; `aimeat/src/routes/federation-auth.ts:104-108` | |
| SEC-06 | met | `aimeat/src/services/owner-session.ts:63-70`; `aimeat/src/middleware/oauth-round-cookie.ts:72-74`; `aimeat/src/services/external-login.ts:159-168` | No check script enforces it. |
| SEC-07 | met | TOTP secret AES-256-GCM (`aimeat/src/services/totp.ts`); provider keys decrypted at call time only (`aimeat/src/services/ai/call-guards.ts:75-92`) | |
| SEC-08 | met | `aimeat/src/config.ts:217-230`; `aimeat/src/config-private-host.ts:18-29` | |

## The 31 gaps in one list, with their wishes

The list was written as the work for node 4.0.0; a gap still open in the released node stays open under its wish. The wish column names the record in the Lifecycle Central wish bucket that carries the fix. Items 1 to 9, 12 to 14, 16, 17, 20, 21, 23, 25 and 28 to 30 are closed in code (see the updates under "Answer first"); they stay in the list so the numbering holds. The open ones are listed here: ID-11, AUTH-06, DATA-06, PACE-05, PACE-11, FED-06, FED-16, HTTP-01, HTTP-02, DISC-03.

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

**Partial rows that a wish also covers:** DATA-19 (the expiry job walks agents only) is item 4 of `wish-data-ownership-code-defects-leave-over-mcp-keeps-access-app-`.

## Found on the way, outside the numbered requirements

| Finding | Evidence |
|---|---|
| The anonymous token is minted without the `anonymous` claim, although the route asks for it | `aimeat/src/routes/auth.ts:130`; `aimeat/src/auth/jwt.ts:159-177` |
| The owner-key challenge is issued and never read | `aimeat/src/routes/auth.ts:144-170,305,693` |
| Records written in bulk with visibility `workspace` are bound to no workspace | `aimeat/src/routes/memory/bulk.ts:156` |
| The connectivity-key agent connect route still existed, although v4.0 said the flow was removed. Fixed 2026-10-14: `POST /v1/auth/connectivity-key` and `POST /v1/agents/connect` are removed | `aimeat/src/routes/agents/registration.ts` |
| The peer key cache has no periodic refresh; keys refresh on introduce, activate and recovery | `aimeat/src/services/federation-helpers.ts:138-151`; `aimeat/src/server-bootstrap/service-init.ts:571-590` |
| `openapi.yaml` lists three record specifications; the node serves five | `openapi.yaml` `/v1/specs/{name}`; `aimeat/src/services/contract-docs.ts:30` |
| MCP `serverInfo.version` was `1.2.0`, a fourth version number. Fixed 2026-10-12: it is the node's software version, as `openapi.yaml` `info.version` is | `aimeat/src/mcp/index.ts` |
