# AIMEAT RFC v4.0: known errata and pending changes

**Applies to:** [AIMEAT-RFC-v4.0-Core-full.md](AIMEAT-RFC-v4.0-Core-full.md) and [AIMEAT-RFC-v4.0-Platform-full.md](AIMEAT-RFC-v4.0-Platform-full.md)
**Checked against:** node 3.26.1, 2026-10-11

The two v4.0 documents no longer match the reference implementation in the places listed below. Read this list before you build against either document. Where a document and the code disagree, the code and [openapi.yaml](../openapi.yaml) win.

## What comes next

- **AIMEAT Core 2026-11** is the next version of the Core specification. It is released together with node 4.0.0, because that release removes the deprecated formats listed in the first table. It is named by its date, so that its name does not collide with the node's version number or with the API path version `v1`.
- **The Platform RFC will be replaced by a Platform reference** that is versioned with the node. It is made from the feature list (`docs/AIMEAT-Feature-List.md`), `openapi.yaml`, the MCP tool catalog and a short architecture note.
- Until then, the v4.0 documents stay as published, and this file records where they are wrong.

## Breaking changes pending in Core

A node built from the v4.0 text alone will be refused by a current node in these places.

| # | RFC v4.0 says | Where | Code now | Evidence |
|---|---|---|---|---|
| A3 | `operator > owner > agent`; the owner bypasses scopes; a catalog of 19 Core and 5 Platform scope words | Core §7.1-7.2 | The wildcard `*` does not cover every scope. `operator:admin`, `account:security`, `mcp:manage`, the secrets, compliance, theme and layout words, and the owner's own tick words are granted only by name. Some routes require the account holder in person, and no agent token passes them. About 60 distinct scope words are enforced. | `aimeat/src/utils/scope-coverage.ts` (`SCOPES_OUTSIDE_WILDCARD`); `aimeat/src/auth/middleware.ts` (`requireOwnerPrincipal`) |
| A4 | A peer "MUST verify an Ed25519 signature unconditionally" | Core §33-34 | A signed node message also names its audience, carries its send time, and is accepted within five minutes and only once. A relayed request carries a signed relay claim, `required` by default from node 3.20.0. `federation.audience_required` is on by default from node 3.27.0, and the format without this proof is removed in node 4.0.0. | `aimeat/src/config-federation.ts` (`AUDIENCE_REQUIRED_BY_DEFAULT_IN`, `UNPROVEN_FORMAT_REMOVED_IN`); `aimeat/src/services/signed-node-request.ts` |
| B1 | The legacy Ed25519 owner-key login is deprecated and "still mounted" | Core §9; Platform §9 | It can be switched off (`AIMEAT_OWNER_KEY_LOGIN`), it refuses an account with two-step sign-in, and it is **removed in node 4.0.0**. Password sign-in at `POST /v1/ghii/login` replaces it. | `aimeat/src/config-security.ts` (`ownerKeyLogin`); `aimeat/src/routes/auth.ts` |
| B2 | The connector tunnel "reuses the client's upgrade JWT" | Core §35 | `?token=` on a WebSocket upgrade (`/v1/realtime/ws`, `/v1/personal/tunnel`, `/v1/connect/tunnel`) is deprecated and **removed in node 4.0.0**. A client sends an `Authorization` header, or a single-use ticket from `POST /v1/ws/ticket` as `?ticket=`. | `aimeat/src/auth/ws-upgrade.ts`; `aimeat/src/config-security.ts` (`wsQueryToken`) |

## Errata

The RFC was wrong, or the code changed after it, with no new capability involved.

| # | RFC v4.0 says | Where | Code now | Evidence |
|---|---|---|---|---|
| B5 | "Anti-abuse: wash-trading detection over a reciprocal window with economic penalty" | Core §21 | Not implemented. | No such code in `aimeat/src`; feature list §23 lists it as not in the code |
| B6 | "`broadcastTrustAdvisory` is defined but not yet invoked" | Core §36 | The function does not exist. | No `broadcastTrustAdvisory` in `aimeat/src` |
| B7 | Direct messages are "Human↔human"; "cross-node delivery is deferred" | Core §28 | Messages are delivered between nodes (since 2026-06-16), between people and agents, in threads with several participants. | `aimeat/src/services/message-delivery.ts` |
| B8 | Single upload default 50 MB | Core §11 | 10 MB (`AIMEAT_STORAGE_MAX_FILE_SIZE_MB`). | `aimeat/src/config.ts` (`storageMaxFileSizeMb`) |
| B9 | `AIMEAT_JWT_TTL_SECONDS` | Core §6.4 | The variable is `AIMEAT_JWT_TTL`, as Core Appendix B already says. | `aimeat/src/config.ts` (`jwtTtlSeconds`) |
| B10 | Envelope `{ok, node, data\|error, hints, meta:{timestamp, request_id, pagination?}}` | Core §37 | `protocol`, `version` (`'v1'`), `timestamp` and `request_id` are top-level fields. `meta` holds `page`, `per_page`, `total` and `provenance`. | `aimeat/src/middleware/envelope.ts` (`AimeatResponse`, `EnvelopeMeta`) |
| B11 | `/.well-known/aimeat` carries the "protocol version" | Core §41 | It returns `protocol: 'aimeat'`, `version: 'v1'` (the API path version) and `software_version`. No field carries the RFC version. | `aimeat/src/routes/wellknown.ts` |
| B12 | `/v1/organisms/{id}/invite` and `/invite-email`; `/v1/organisms/{id}/workspaces/{ws}`; `POST /v1/federation/personal-nodes`; `PATCH /v1/agents/{gaii}/scopes`; `/upload/init` | Core §18, §19, §35, §7.2, §11 | `/v1/organisms/{id}/invitations` and `/invitations/email`; `/v1/organisms/{id}/workspace/*`; `POST /v1/personal/anchor`; `PATCH /v1/agents/{name}/scopes`; `/v1/storage/upload/init` | `openapi.yaml` |
| B13 | Appendix A lists micro-memory twice, as removed and as deprecated | Core Appendix A | Micro-memory was removed on 2026-08-23. | Core §9 and §10 say so |
| B14 | Wrong cross-references: "Consent (§17)", "(§1.5)", "(§30 provenance)", board posting "§25", "workspace comment (§16)", "EXCHANGE (§22)" | Core §0, §1.4, §27 | Consent is §14; there is no §1.5 (the sections are 1.4 and 1.6); provenance is Platform §3.6; the morsel debit is §21; §16 is the IAM model; EXCHANGE is not specified in either document. | The RFC's own headings |
| B15 | aimeat-agency: a Tauri appliance with 40+ templates, "distributed as the signed aimeat-desktop installer (Authenticode)" | Platform §2.3 | The aimeat-desktop app attaches AI tools on the computer to an AIMEAT and can run a local node. Its installers are not code-signed. | `aimeat-desktop/README.md`; `.github/workflows/release-desktop.yml` |
| B16 | The admin plane has "~17 routes" and a "Generator-Debug" tab | Platform §7.2 | 25 `admin*` route files; the Generator was removed on 2026-07-18 and no such tab exists. | `aimeat/src/routes/admin*.ts` |
| B17 | Platform scopes: `ai:use`, `cortex:write`, `ext:write`, `workflow:*`, `events:emit` | Platform Appendix A | About 60 scope words are enforced, among them `exchange:*`, `finance:*`, `commerce:*`, `connections:*`, `mcp:*`, `packages:write`, `provenance:write` and `memory:purge`. The appendix says it is not exhaustive. | `requireScope(...)` calls in `aimeat/src` |
| B18 | (`openapi.yaml`, the API contract) "Tier 0.5: One-time keys in URL parameters"; "Tier 1: JWT Bearer token via Ed25519 keypair signing" | `openapi.yaml` `info.description` | Tier 0.5 was removed on 2026-08-23. The preface was corrected on 2026-10-11 and now lists owner sessions, device authorization, agent tokens, personal access tokens and OAuth for MCP. | `openapi.yaml` |
| B19 | "multi-hop manifest construction is not" implemented | Core §36 | `POST /v1/federation/route` relays a query over several hops with a signed route manifest. The relay shares of a multi-hop settlement are computed and paid to nobody (known gap GAP-001). | `aimeat/src/routes/federation-sync/routing.ts`; `docs/known_gaps.md` |

## Found while checking this list

| # | RFC v4.0 says | Where | Code now | Evidence |
|---|---|---|---|---|
| E1 | Consent `scope` is `local`/`federation` | Core §14 | The scope is one of `private`, `dmz`, `federation` or `auth`, and defaults to `federation`. `auth` lets another node sign the person in with their password. | `aimeat/src/models/schemas.ts` (`ConsentCreateSchema`); `aimeat/src/routes/federation-auth.ts` |
| E2 | The parent of a personal node "proxies federated traffic" | Core §35 | The parent keeps a mailbox and delivers it when the tunnel connects. The `request` and `response` tunnel frames exist, but node 3.26.1 does not forward live requests through the tunnel. | `aimeat/src/services/personal-tunnel.ts` (`sendRequest` has no caller); `docs/personal-node-setup-guide.md` |
