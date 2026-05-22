# Changelog

All notable changes to AIMEAT are documented in this file.

## [1.7.0] - 2026-05-22

### Added -- Agent Dashboard (3 phases, 7 features, ~15,000 lines across 113 files)

Complete per-agent management dashboard with task queues, directives, sharing groups, capabilities, activity monitoring, offered services, and messaging -- all accessible from the profile Agents tab.

#### Agent Tasks (Phase 1)
- **Task queue per agent** -- create, assign, start, complete, fail tasks with full lifecycle management. Each task tracks status (`queued`/`active`/`completed`/`failed`), priority, deadline, and event log.
- **Task creation builder** -- frontend form with title, description, priority, and deadline fields.
- **Task stall detection** -- background job flags active tasks with no events past a configurable threshold (`AIMEAT_TASK_STALL_THRESHOLD_MINUTES`).
- **Work-to-task bridge** -- automatically creates an `AgentTask` when an agent accepts a work exchange item, linking the two systems.
- **Task event logging** -- every lifecycle transition (start, complete, fail, stall) is recorded as a timestamped event with optional metadata.
- **7 MCP tools** -- `agent_task_create`, `agent_task_list`, `agent_task_get`, `agent_task_start`, `agent_task_complete`, `agent_task_fail`, `agent_task_event`.
- **Admin agent tasks tab** -- operator view of all tasks across all agents with status badges.

#### Agent Directives (Phase 1)
- **Three-layer directive inheritance** -- System (operator-set via admin dashboard), Owner (user-set via access tab), and Agent (per-agent in detail view). Merged view shows effective directives with source labels.
- **System configuration fields** -- `agentSystemPrinciples`, `agentMaxTokensPerTask`, `agentMandatoryLogging`, `agentAimeatFirstEnabled` configurable via admin dashboard and `.env`.
- **Tier1 prompt extended** -- downloaded agent instructions now include directives and task handling sections.

#### Sharing Groups (Phase 1)
- **Group-based memory visibility** -- new `group` visibility level extends `private|owner|public`. Memory entries with `visibility: 'group'` are readable only by group members.
- **Group CRUD** -- create, update, delete groups with per-member GAII/GHII read/write permissions.
- **Consent integration** -- `checkConsentForRead()` extended with group visibility branch.
- **Memory tab group picker** -- visibility cycle extended to 4 states; popup for selecting target group.
- **Access tab sections** -- sharing groups management and agent directive defaults in the access tab.
- **Admin sharing groups tab** -- operator view of all groups across all owners.
- **5 MCP tools** -- `sharing_group_create`, `sharing_group_list`, `sharing_group_get`, `sharing_group_update`, `sharing_group_delete`.

#### Agent Capabilities (Phase 2)
- **Technical + domain capabilities** -- agents report their technical capabilities (languages, frameworks, APIs) and domain skills via `PUT /v1/agents/:name/capabilities`.
- **MCP-type verification** -- capabilities reported by agent sessions are verified against actual MCP tool availability.
- **Capabilities sub-tab** -- displays technical skills, domain skills, and action queue in the agent detail view.
- **2 MCP tools** -- `capabilities_report`, `agent_activity`.

#### Activity Monitoring (Phase 2)
- **Embedded activity counters** -- `tasksCompleted`, `tasksFailed`, `messagesProcessed`, `lastActiveAt` on AgentRecord, updated on every task lifecycle event.
- **Time-series activity table** -- `agent_activity` stores metric/value/timestamp rows for historical charts.
- **Activity recorder service** -- records task events to the time-series table automatically.
- **Activity sub-tab** -- stats cards, CSS bar chart (no external charting library), scheduled jobs list, and scrollable event log.
- **REST endpoints** -- `GET /v1/agents/:name/activity/stats`, `/activity/history`, `/activity/log`.

#### Offered Services (Phase 3)
- **Services sub-tab** -- displays published actions (services) offered by the agent on the work exchange, with name, description, cost, visibility, call count, success rate, and average response time.
- **Unpublish button** -- remove a service from the exchange directly from the dashboard.

#### Agent Messages (Phase 3)
- **Message CRUD with thread support** -- `POST/GET /v1/agents/:name/messages` with optional `threadId` for conversation threading.
- **Chat UI** -- message bubbles (inbound/outbound), auto-scroll, textarea with Enter-to-send.
- **Proposed task handling** -- inbound messages with `metadata.proposedTask` render inline with "Create Task" and "Adjust" buttons.
- **Status bar** -- online/offline indicator, inbox/delivered/error counters.
- **Thread selector** -- horizontal thread navigation buttons.
- **Inbox integration** -- pending messages included in the agent integration kit inbox endpoint.
- **2 MCP tools** -- `message_inbox`, `message_send`.
- **Tier1 prompt extended** -- message handling instructions added to downloadable agent specs.

#### Agent Detail View (cross-phase)
- **6 sub-tabs** -- Tasks, Directives, Capabilities, Activity, Services, Messages. Tab navigation within agent detail.
- **Shortened connection prompt** -- buildAgentPrompt() reduced to 10 lines (Telegram-safe). Full instructions available via Download/Copy buttons.
- **Agent Integration Kit** -- consolidated inbox endpoint (`GET /v1/agents/:name/inbox`) returns pending tasks, messages, and directives in one call. Long-poll support for real-time agents.
- **Live updates** -- all sub-tabs listen for SSE `aimeat-live-update` events and refresh automatically.

#### Admin Integration
- **Peer management in admin monitoring** -- admin monitoring tab extended with peer status tracking and routing controls.

### Storage
- **7 new SQLite tables** -- `agent_tasks`, `agent_task_events`, `agent_directives`, `owner_agent_defaults`, `sharing_groups`, `agent_activity`, `agent_messages`.
- **7 new Prisma models** -- matching MongoDB implementations for all tables.
- **6 new repository interfaces** -- `AgentTaskRepository`, `AgentDirectivesRepository`, `SharingGroupRepository`, `AgentActivityRepository`, `AgentMessageRepository`, plus capability extensions on `AgentRepository`.
- **Storage interface extended** -- `AgentTaskRecord`, `AgentDirectivesRecord`, `SharingGroupRecord`, `AgentMessageRecord`, `AgentActivityRecord`, `AgentActivityStats`, `AgentTechnicalCapability` types added.

### Tests
- **8 new E2E test suites, 109+ tests** covering all features on both SQLite and MongoDB:
  - `e2e-agent-tasks.ts` (19 tests) -- task CRUD, lifecycle, stall detection, events
  - `e2e-agent-directives.ts` (12 tests) -- three-layer inheritance, merge view
  - `e2e-sharing-groups.ts` (23 tests) -- group CRUD, member permissions, memory visibility
  - `e2e-integration-kit.ts` (15 tests) -- inbox, task lifecycle, kit endpoint, long-poll
  - `e2e-agent-capabilities.ts` (8 tests) -- capability reporting, MCP verification
  - `e2e-agent-activity.ts` (10 tests) -- stats, history, log, recorder
  - `e2e-agent-messages.ts` (14 tests) -- message CRUD, threads, inbox integration
  - `e2e-agent-services.ts` (22 tests) -- service listing, stats, unpublish

### i18n
- **228 new translation keys** in both `en.json` and `fi.json` covering all 7 features, admin tabs, status badges, form labels, and empty states.

### OpenAPI
- **~1,700 lines added to `openapi.yaml`** -- all new endpoints documented with request/response schemas, including agent tasks, directives, sharing groups, capabilities, activity, messages, and integration kit.

## [1.6.1] - 2026-05-21

### Security

Full security audit covering authentication, authorization, input validation, dependencies, storage, GDPR, extensions, federation, and infrastructure. 33 findings addressed across 7 phases.

#### Critical & High Fixes
- **Extension SSRF protection** -- `ctx.fetch()` in extension sandbox now validates URLs via `validateOutboundUrl()`, blocking private/reserved IPs and cloud metadata endpoints (169.254.169.254). Applied to both QuickJS runtime and route-level fetch.
- **GDPR cascade delete completion** -- `DELETE /v1/owners/:name` now deletes all data categories: GHII-level memory, consents, organism memberships, matches (by GHII), sessions, capabilities, scheduled jobs, device auth records, apps, extension instances, knowledge links, and knowledge reviews. Previously only agents, their memories, actions, and transactions were deleted.
- **Admin password removed from logs** -- no longer logged via `logger.info()`. Auto-generated secrets written to stderr only.
- **Login brute-force protection** -- per-route rate limit + per-account progressive lockout after configurable N failed attempts (default: 5 failures, 15-minute lockout).
- **Extension script content gated** -- `GET /v1/extensions/:name?full=true` now requires authenticated owner/operator. Unauthenticated callers get metadata only. Does not affect cortex-to-extension calls (which use action invocation, not script reading).
- **Extension email authorization** -- three-tier model: Tier 0 (default) allows emailing only the caller's own verified email. Tier 1 allows consented recipients via `purpose: 'extension_email'`. Tier 2 (operator-granted `emailPolicy: 'unrestricted'`) allows arbitrary recipients.
- **Token refresh role revalidation** -- `POST /v1/auth/refresh` now re-reads roles from storage instead of copying from the old token, preventing stale privilege persistence after role changes.
- **Unauthenticated federation auth refresh deleted** -- `POST /v1/federation/auth/refresh` removed entirely (no consumers existed; client library explicitly refuses federated refresh).

#### Federation Auth Scope Configuration (new feature)
- **Node-level federation auth policy** -- `federationAuthPolicy` config: `disabled` (default), `all_peers`, or `specific_peers`. Controls whether users from other nodes can log in.
- **Per-peer auth settings** -- `allowFederatedAuth` and `federationAuthScopes` fields on each peer record, configurable from admin dashboard.
- **Receiving node determines scopes** -- home node attestation no longer dictates scopes. The receiving node applies its own per-peer or default scope policy.
- **Attestation signature verification** -- federated login now verifies the home node's Ed25519 signature on the attestation against the peer's known public key.
- **Admin dashboard UI** -- federation tab gains auth policy dropdown (disabled/all_peers/specific_peers), default scopes checkboxes, and per-peer "Allow Federated Login" toggle.

#### Medium Fixes
- **Registration rate limiting** -- `POST /v1/ghii` and `/v1/ghii/register-web` rate-limited (default: 5/min).
- **Admin setup rate limiting** -- `/v1/admin/setup/auth`, `/setup/register`, `/setup/token`, `/setup/initial-otk` all rate-limited (default: 5/min).
- **Timing-safe admin password** -- all admin password comparisons use `crypto.timingSafeEqual()`.
- **Strong admin passwords** -- setup wizard now enforces same password strength rules as regular registration (8+ chars, uppercase, lowercase, number, no common passwords).
- **Extension limits capped** -- `Math.min()` instead of `Math.max()` ensures extensions cannot exceed admin-configured memory/timeout/API-call limits.
- **Extension wallet spending cap** -- configurable per-call debit limit (default: 100 morsels, env: `AIMEAT_EXT_MAX_DEBIT`).
- **Consent expiry sweep** -- `expireConsents()` now performs actual bulk expiration query instead of being a no-op.
- **Unhandled rejection handler** -- `process.on('unhandledRejection')` prevents silent crashes from background services.
- **scrypt v2 parameters** -- new password hashes use N=32768 (up from 16384). Versioned hash format (`v2:salt:key`) with transparent upgrade on login. Old hashes work forever.
- **Relaxed CSP for test pages** -- generator/foundry test pages use `script-src 'unsafe-eval' 'unsafe-inline' https:` instead of removing CSP entirely.
- **Zod schema validation** -- added to `POST /v1/ghii`, `/v1/ghii/register-web`, `/v1/ghii/login`, `/v1/consent`, `/v1/flags`, `/v1/extensions` with field type/size constraints.

#### Low Fixes
- **Content-Disposition sanitization** -- filename quotes/backslashes escaped in download headers.
- **Interest storage identity** -- registration interests stored under owner GHII (was fabricated non-existent agent GAII). Directory service uses GHII-first lookup with agent GAII fallback for backward compatibility.
- **Extension notification identity** -- `notify()` uses `resolveIdentity()` instead of raw `req.auth!.sub`.
- **TOTP backup code entropy** -- increased from 4 bytes (8 hex chars) to 6 bytes (12 hex chars).
- **Transaction IDs** -- all 23 sites migrated from `Math.random()` to `crypto.randomUUID()`.
- **Rate limiter fallback** -- added `req.socket.remoteAddress` to key chain + stats counter for unknown key fallback.
- **Security headers on all responses** -- X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS applied globally (was only when public directory existed).
- **Generic upload error** -- internal error details no longer leaked to clients.
- **JSON body limit** -- reduced default from 15MB to 5MB. Apps/extensions/cortex routes keep 15MB.
- **Startup warnings** -- TOTP encryption key missing, dev mode on non-local config, Windows node key unencrypted.

#### Configurable Security Settings (all via .env + admin dashboard)
All security limits are runtime-configurable via environment variables and the admin dashboard Config tab under the "Security" group:
- `AIMEAT_LOGIN_RATE_LIMIT_MAX` / `_WINDOW_MS` (default: 15 / 60000)
- `AIMEAT_REGISTRATION_RATE_LIMIT_MAX` / `_WINDOW_MS` (default: 5 / 60000)
- `AIMEAT_ADMIN_AUTH_RATE_LIMIT_MAX` / `_WINDOW_MS` (default: 5 / 60000)
- `AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS` / `_MINUTES` (default: 5 / 15)
- `AIMEAT_JSON_BODY_LIMIT_MB` / `_LARGE_MB` (default: 5 / 15)
- `AIMEAT_EXT_MAX_DEBIT` (default: 100)
- `AIMEAT_FEDERATION_AUTH_POLICY` (default: disabled)
- `AIMEAT_FEDERATION_DEFAULT_SCOPES` (default: memory:read,catalogue:read)

### Changed
- **Password validation** extracted to shared `src/utils/password-validation.ts` (was private in ghii.ts).
- **ConsentCreateSchema** scope enum now includes `'auth'` (was missing, needed for federation auth consents).
- **Federation auth verify** rate limit increased from 10/min to configurable (default: 15/min).

## [1.6.0] - 2026-05-21

### Added
- **Notification Statistics** -- email, push, and mailbox notification counters with type-level breakdown for operational visibility and abuse detection.
  - **Email counters** -- `email_sent`, `email_failed`, `email_retried` tracked per type (verification, magic_link, notification, match_suggestion, group_send).
  - **Push counters** -- `push_sent`, `push_failed`, `push_expired_subs` tracked per type.
  - **Mailbox notification counters** -- `mailbox_notif_sent`, `mailbox_notif_failed` per channel (push, email), `mailbox_notif_blocked` per reason (cooldown, quiet_hours, disabled).
  - **`incrementTyped(name, type)` API** -- new `StatsCollector` method stores typed counters as `name:type`, with automatic grouping in `snapshot()` into `{base}` totals and `{base}_by_type` breakdowns.
- **Stats Persistence** -- all counters survive server restarts via periodic flush (every 60s) to storage.
  - **`StatsRepository` interface** -- `flushStats`, `loadStats`, `flushDailyHistory`, `loadDailyHistory` methods added to the storage layer.
  - **SQLite backend** -- `stats_counters` and `stats_daily_history` tables with upsert and 90-day pruning.
  - **MongoDB backend** -- `StatsCounter` and `StatsDailyHistory` Prisma models with composite unique constraints.
  - **Graceful shutdown** -- `stats.shutdown()` flushes final counter state on SIGTERM/SIGINT.
- **Time-Range Filtered Stats API** -- `GET /v1/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` returns summed counters and per-day breakdown for the selected range. Backward compatible (no params = lifetime totals).
  - **Gauges** -- `tunnel_connections_active`, `mailbox_items_total`, `mailbox_bytes_total`, `mailbox_oldest_item_age_seconds` always return current values regardless of time range.
- **Stats Tab UI** -- admin dashboard Stats tab gains three new sections and a time range selector.
  - **Time range selector** -- preset buttons (Today, This Week, 7 Days, 30 Days, All) plus custom date range. Default: 7 Days. Re-fetches data on change.
  - **Email Delivery section** -- 4 stat cards (Sent, Failed, Retried, Success Rate), breakdown table by type, per-day bar chart.
  - **Push Notification section** -- 4 stat cards (Sent, Failed, Expired Subs, Success Rate), breakdown table by type, per-day bar chart.
  - **Mailbox Notifications section** -- 3 stat cards (Sent, Failed, Blocked), inline breakdowns by blocked reason and channel.
  - **Live badge** -- gauge values show a "live" indicator badge.
- **i18n** -- 51 new translation keys added to both `en.json` and `fi.json` (section headers, stat cards, type labels, time range presets, weekday abbreviations).

### Tests
- **12 new unit tests** -- typed counter grouping (5 tests), persistence init/flush/shutdown (7 tests) including prefixed counter deserialization, error recovery, and timer cleanup.
- **5 new Playwright tests** -- admin stats tab: time range selector rendering, button switching, email/push/mailbox section rendering with stat card verification.
- **E2E stats tests** -- time-range-filtered `GET /v1/stats` with `totals`, `daily`, `gauges` key verification, empty range handling.

## [1.5.0] - 2026-05-21

### Added
- **Federation Mesh Network** -- complete mesh networking across AIMEAT nodes with 4 layers of functionality:

#### Per-Peer Policy + Federate Flags (Phase 1)
- **Per-peer policy controls** -- each federation peer connection has configurable `shareCatalogue`, `replicateMemory`, `allowRouting` flags and a `peerMode` (federation/private). Private P2P peers are excluded from the public federation directory.
- **Federate flag on all catalogue types** -- `ActionRecord`, `AgentRecord`, `BoardRecord`, `StorageFileRecord` each have a `federate` boolean. Only items explicitly marked for federation are shared across the network. `CsmRecord` and `MsmRecord` already had this.
- **Policy enforcement** -- catalogue sync, memory replication, and multi-hop routing check peer policies before proceeding. Returns 403 `POLICY_DENIED` when blocked.
- **Admin UI peer policy toggles** -- Live Peers table in the federation tab has per-peer checkboxes and mode selector.
- **Profile UI federate badges** -- agents, boards, and knowledge tabs show interactive federate toggle badges.

#### Network Directory (Phase 2)
- **Service summary endpoint** -- `GET /v1/federation/service-summary` returns a compact catalogue of all federated items on a node, with a SHA-256 hash for change detection.
- **Heartbeat-driven discovery** -- hub nodes detect service summary hash changes during heartbeat and automatically fetch updated summaries from peers. Summaries stored in-memory, cleaned up when peers go offline.
- **Cross-catalogue network source** -- `GET /v1/federation/cross-catalogue` extended with `source_type: 'network'` entries aggregated from all peer summaries.
- **Admin UI network directory browser** -- searchable table in the federation tab showing all services/data available across the federation.

#### Federated Login (Phase 3)
- **`POST /v1/federation/auth/verify`** -- home node verifies credentials for a remote node. Checks password (scrypt) and requires an active auth consent (`scope: 'auth'`) for the requesting node. Returns a signed Ed25519 attestation.
- **`POST /v1/federation/auth/refresh`** -- re-verify a federated session without password. Checks user exists and auth consent still active.
- **Auth consent isolation** -- `scope: 'auth'` is distinct from `scope: 'federation'`. Sharing data with a node does NOT grant login access. New `ConsentRecord.scope` value added to the type.
- **Federated JWT claims** -- JWT extended with `federated`, `homeNode`, `homeUrl` claims. Short TTL (max 1 hour).
- **Restricted federated sessions** -- federated users cannot perform operator actions, create agents, or manage consents. `requireLocalSession()` middleware added.
- **Server-side federated login flow** -- `POST /v1/ghii/login` detects `@remote-node` in username, routes verification to the home node, and issues a local federated JWT on success.
- **Client-side federated login** -- login modal sends full `user@node` to server. Shows "Connecting to home node..." during federation. "Federated" badge on logged-in state. Session stores federation info.
- **Access tab Federation Access section** -- manage which nodes can authenticate you. Add/remove per-node auth consents. "Allow all federation nodes" wildcard toggle with warning.

#### Cross-Node Data Access (Phase 4)
- **`POST /v1/memory/pull`** -- copy a memory entry from the home node to the current (remote) node. Stores locally with `visibility: private` and `pulled-from:` tag.
- **`POST /v1/memory/push-home`** -- save a local memory entry back to the home node via the federation replication protocol.
- **Federation proxy utility** -- `middleware/federation-proxy.ts` routes requests from federated sessions to the home node with SSRF protection.
- **Memory tab pull/push UI** -- federated sessions see a banner and per-entry "Copy from home" / "Save to home" buttons.

#### Additional UI Enhancements
- **Knowledge tab** -- interactive federate toggle creates/revokes federation consent per package.
- **Data Wallet tab** -- distinct badges for federation (blue) and auth/login (purple) consent scopes. Scope filter buttons (All / Federation / Login Access).
- **Memory tab** -- "Synced" badge on entries with active federation consent. Share/Unshare buttons for all sessions.
- **Profile card** -- federation status indicator shows "Connected to X nodes" or "Standalone".

### Fixed
- **Multi-hop relay didn't forward auth headers** -- `POST /v1/federation/route` now includes the `Authorization` header when relaying through intermediate nodes, enabling B->A->C routing.
- **Private peers visible in public directory** -- `GET /v1/federation/directory` now excludes peers with `peerMode: 'private'`.
- **Federation sidebar count inflated by history** -- sidebar showed peering request history count when no live peers existed. Now shows only live peer count.
- **Peering request history not deletable** -- added `DELETE /v1/admin/peering/requests/:id` endpoint and delete buttons in the admin federation tab.

### Tests
- **129 federation tests** -- 44 single-node E2E (peer policies, federate flags, service summary, auth verify, data access), 45 multi-node integration (3 nodes: hub + 2 contributors), 40 original federation tests.
- **Multi-node integration suite** -- `test/federation-multinode.ts` boots 3 AIMEAT servers and tests service discovery through hub, cross-node routing (direct + multi-hop), federated login with consent isolation, private peer filtering, and routing fee verification.

## [1.4.8] - 2026-05-20

### Fixed
- **Owners tab showed wrong list and counts** -- the admin dashboard built the owners list by extracting unique names from agents, so owners with zero agents were invisible. Sidebar count (from `listOwners()`) didn't match the tab data. Added `GET /v1/admin/owners` endpoint that returns all owners directly from storage with roles and agent counts. Sidebar count now updates from the same source.
- **Owner roles missing from API response** -- `GET /v1/owners/:name` did not include the `roles` field, so the admin owners tab always showed "--" for roles and the "Grant Operator" button appeared even for existing operators.
- **Federation login showed "wrong password" instead of proper error** -- entering `user@remote-node` in the login form stripped the `@node-id` client-side before the server could check, so the server tried local auth and failed with a misleading error. Now checks the node-id client-side and shows "Federated login is not yet supported" with both node IDs.
- **Federation peers lost on server restart** -- the `peers` Map was in-memory only. Added `federation_peers` table (SQLite) and `FederationPeer` Prisma model (MongoDB). Peers are persisted on every mutation (add, activate, update, remove, heartbeat status change) and loaded on startup.
- **Federation peering was one-directional** -- when genesis node A approved peering with node B, only A recorded B as a peer. B never added A back. Fixed by: (1) including `node_url` in key exchange payload, (2) auto-adding the sender as a peer during key exchange if they match our genesis config or an approved peering request, (3) storing a local peering request when joining a genesis network so the returning key exchange is recognized.
- **MongoDB replication queue lost on restart** -- the MongoDB storage used an in-memory `Map` for the replication queue instead of persisting to the database (SQLite already used a proper table). Replaced with Prisma-backed `ReplicationQueue` model. Federation sync state now survives restarts on both backends.

## [1.4.7] - 2026-05-20

### Added
- **Edit Profile modal** -- "edit profile" link in the profile card now opens a modal to update display name, bio, avatar, and language. Calls `PUT /v1/ghii` and updates the session immediately.
- **Change Password modal** -- "change password" link next to edit profile opens a separate modal with current/new/confirm password fields. New `POST /v1/ghii/password/change` endpoint validates the current password and enforces strength requirements.
- **`displayName` in session** -- the login and register flows now include `displayName` in the session object and localStorage, so the profile card shows the real name instead of falling back to the username.
- **Profile API service functions** -- `getProfile()`, `updateProfile()`, `changePassword()` added to the frontend auth service (`public/js/services/auth.js`).
- **`GET /v1/ghii/me` endpoint** -- authenticated endpoint that returns the user's own profile including private fields (`notification_email`, `email_verified_at`). Used by edit profile modal and email tab.
- **Email shown in profile** -- email-tab now displays the verified email address (was only showing "Email verified" without the address). Edit profile modal shows email as read-only with a hint to change it in the Email tab.

### Fixed
- **Login with full GHII corrupted session** -- entering `user@node-id` in the login form leaked the full GHII into JWT claims (`sub`, `owner`), the session `owner` field, and all downstream operations (owner lookup, key update, token refresh). Root cause: `POST /v1/ghii/login` stripped `@node-id` into `loginName` for the GHII lookup but used the raw `username` from req.body for JWT issuance, storage updates, and the API response. Now all 8 occurrences use `loginName`. Registration endpoints also strip `@node-id` from both `username` and `display_name`. Frontend strips `@node-id` and skips the register-first flow when a GHII is detected.
- **Password reset never sent email (MongoDB)** -- `notificationEmail` field was missing from the Prisma schema and MongoDB storage mapping. The email verification flow set `emailVerifiedAt` but silently failed to store the email address, so password reset always skipped sending because `notificationEmail` was null. Added the field to `schema.prisma`, `createGHII`, and `toGHIIRecord`. Users who previously verified their email on MongoDB need to re-verify once for the address to be stored.

### Improved
- **Password reset logging** -- `POST /v1/ghii/password/reset-request` now logs whether the email was sent, failed, or skipped (and why), making it possible to diagnose "forgot password" issues from server logs.

## [1.4.4] - 2026-05-20

### Fixed
- **Setup wizard still broken after 1.4.3** -- the root cause was in `middleware-guards.ts`: the first-run guard served `wizard.html` directly without injecting the CSP nonce into `<script>`/`<style>` tags. The 1.4.3 onclick fix was necessary but insufficient because the nonce was never reaching the HTML. Now uses the same `res.locals.cspNonce` injection pattern as all other HTML-serving routes.
- **`aimeat --version` showed hardcoded `v1.2.0`** -- now reads version from `package.json` at runtime.
- **Crash on Mac ARM (Apple Silicon) with memory backend** -- `better-sqlite3` native bindings may not have prebuilts for newer Node.js versions on `darwin/arm64`. Previously crashed with an opaque bindings error. Now catches the failure and shows clear fix instructions (rebuild, use MongoDB, or reinstall).
- **Login rejects full GHII identity** -- entering `username@node-id` in the sign-in form failed because the `@` character was rejected by registration validation, and the backend constructed a double-suffixed key. Both frontend and backend now parse the `@node-id` suffix: the username portion is extracted for login, and if the node-id doesn't match the local node, a clear "federated login not yet supported" error is returned. Full GHII input also skips the register-first flow and goes straight to login.

## [1.4.3] - 2026-05-20

### Fixed
- **Setup wizard inline onclick handlers blocked by CSP** -- replaced all 17 inline `onclick` event handlers in `wizard.html` with `addEventListener` calls inside the nonce-protected `<script>` block. Inline event handlers require `unsafe-inline` regardless of nonce.

## [1.4.2] - 2026-05-16

### Fixed
- **Owner cannot modify agent-created knowledge packages** -- PATCH sharing/visibility endpoints used `resolve(req)` which returns GHII for owner sessions, but packages created by agents are stored under their GAII. Added `findOwnerScopeMemory()` helper that searches GHII + all same-owner agents. Also fixed GET /v1/knowledge/:id to search GHII namespaces for public packages.
- **Unknown content type shows raw i18n key** -- content type badge fell back to `KNOWLEDGE.CONTENTTYPES.GUIDE` for types not in the translation file. Badge now falls back to uppercase raw value for unknown types.

### Added
- **`guide` content type** for knowledge packages -- added to schema, English and Finnish locale files.

## [1.4.1] - 2026-05-16

### Fixed
- **Knowledge packages invisible to agents** -- catalogue endpoint only searched agent GAIIs, missing packages stored under owner GHII (web UI imports). Now searches both GHII and GAII namespaces.
- **MCP `aimeat_knowledge_list` returned empty** -- tool only queried the calling agent's own memory. Now aggregates owner scope (GHII + all same-owner agents), matching the REST API behavior.
- **Knowledge package import rejected `null` URLs** -- AI chats produce `"url": null` for offline references (books, local files). Schema kept strict (string required) as a prompt quality forcing function; the packager prompt now instructs LLMs to use descriptive prefixes (`offline:`, `local:`, `email:`) instead of null.
- **`KNOWLEDGE.VISIBILITY.SHARED` shown as raw i18n key** -- frontend preview rendered AI-generated `"visibility": "shared"` before server normalization. Preview now normalizes `shared` to `owner` before rendering. Added `shared` fallback key to both locale files.
- **Misleading "Shared/Jaettu" label for `owner` visibility** -- renamed to "My Agents/Omat agentit" across all locale files to clarify that `owner` means same-owner agent access, not cross-user sharing.

### Added
- **REST API mapping in bootstrap** (`GET /`) -- new `rest_api_without_mcp` section maps all 17 MCP tool names to their REST equivalents, with notes on `owner_scope`, catalogue vs memory endpoints, and the `/v1/packages` (app store) vs `/v1/catalogue/knowledge` distinction. Agents without MCP support now discover correct endpoints automatically.
- **Knowledge packager prompt improvements** -- visibility descriptions expanded (PUBLIC/OWNER/PRIVATE with scope explanations), `"shared"` explicitly forbidden, new rule #8 for offline reference URL format.

## [1.4.0] - 2026-05-06

### Added
- **"Create Package with AI" prompt** in the Packages tab -- copy-pasteable prompt for Claude Code, VS Code Copilot, or any AI chat that interviews the user, builds and tests components on a live node, and packages the result as a distributable ZIP
- **Package update flow** -- "Check Update" now shows a confirm dialog to apply updates, preserving user data (memory, settings) while replacing apps, extensions, and schemas
- **Packages tab intro section** with title and description (matching all other profile tabs)
- **i18n for package categories** and featured badge in template gallery
- **Auto-activation** of cortex and server extensions on package install (no manual activation needed)
- **Rotation settings** for digital signage -- toggle auto-rotation on/off, configurable speed in seconds

### Fixed
- **Broken `packages.gallery` translation** -- duplicate key in locale files caused "packages.gallery" to render as literal text
- **Instance status renamed** from "active" to "installed" -- avoids confusion with cortex/extension activation status (updated across types, storage, API, OpenAPI spec, CSS, tests, docs)
- **Instance removal now cleans up all components** -- apps, cortex (including lib files, prompts, seed data), CSM, memory, translations are deleted. Previously `removeComponents` was sent as query param but backend read from body; now supports both. Frontend defaults to `true`.
- **ownerGaii mismatch** in package install/delete/migration -- was using bare username instead of full GHII, causing component lookups to fail. Fixed across install, delete, status check, and migration flows.
- **App delete backward compat** -- DELETE/PATCH endpoints fall back to bare owner name for apps created before the GAII fix
- **Admin panel syntax error** in digital signage seed -- `\n` in template literal produced actual newlines breaking inline JS strings
- **App catalog shows empty on first visit** -- `aimeatUrl` defaulted to empty string, now defaults to `window.location.origin` so server apps load without localStorage
- **Upload ZIP button** didn't trigger file picker (HTM template literal handler binding issue)
- **ZIP import auto-publishes** -- uploaded packages now get status `published` instead of `draft`
- **Browse Packages** shows all user's packages, not just published
- **Prompt seeder** now syncs content for both `generator` and `builders` groups on restart

### Improved
- **Digital signage cortex manifest** rewritten with proper `components:` array, `.js` lib filenames, tags, exports, and `api_surface` metadata -- "What's included" section now shows library details
- **Component registrar** preserves lib component fields (filename, exports, api_surface) in cortex registration; passes package metadata (category, tags, description) through to app manifests
- **Cortex component delete** now cleans up lib files, prompts, ontologies, and seed data (previously only deleted the record)

## [1.3.4] - 2026-05-03

### Fixed
- App REST handlers (POST, PATCH, DELETE) now use `resolveIdentity()` to convert bare owner username to full GHII -- fixes 404 on delete for MCP-published apps
- Extension GET endpoint supports `?full=true` for operator export (includes scriptContent)

## [1.3.3] - 2026-05-02

### Added
- **Presigned upload URLs for MCP tools** -- files transfer directly from agent's filesystem to server over HTTPS without passing through the AI context window
  - `aimeat_app_publish`: omit `content_base64` to get upload URL (PUT raw HTML)
  - `aimeat_storage_upload`: omit `data_base64` to get upload URL (PUT raw file)
  - `aimeat_extension_install`: omit manifest/scripts to get upload URL (PUT ZIP)
  - `aimeat_cortex_install`: omit manifest/libs to get upload URL (PUT ZIP)
  - Single-use tokens with 60-minute TTL, size-capped, Ed25519 signed
  - Inline fallback preserved for backward compatibility
- REST routes `POST /v1/apps` and `POST /v1/storage` support `mode: "presigned"` for same flow
- New endpoint: `PUT /v1/upload/:token` -- generic presigned upload receiver
- ZIP format for extension/cortex uploads (manifest.yaml + scripts/ or libs/)
- E2E test suite: 13 tests covering full presigned upload flow
- Developer guide: `docs/coding-guidelines/mcp-uploads.md`

## [1.3.2] - 2026-05-02

### Fixed
- App catalog delete used anonymous token instead of owner JWT -- DELETE always returned 404. Now uses logged-in user's session token for both PORTAL and MCP app removal.

## [1.3.1] - 2026-05-02

### Fixed
- App catalog Published Apps section now shows Remove button for MCP-published apps
- Renamed source badges: "local/server" -> "PORTAL/MCP" (clearer -- both are on server, badge shows where it was published from)
- App publish via MCP uses owner GHII for correct catalog visibility

## [1.3.0] - 2026-05-02

### Added
- **Capability Layer** -- unified abstraction over extensions, cortex, and actions
  - REST API: CRUD, discovery, invoke proxy, telemetry, vouch, test endpoints
  - Storage: SQLite + MongoDB with 38 E2E tests passing on both backends
  - Aggregator: auto-creates capabilities from active extensions/cortex (runs at startup + every 5 min)
  - SDK library: `aimeat-capabilities.js` for browser apps
  - 3 MCP tools: `aimeat_capabilities_list`, `aimeat_capabilities_get`, `aimeat_capabilities_invoke`
  - Admin dashboard tab with detail view, override panel, stats
  - Profile tab with node capabilities listing, source filter, policy display
  - 130+ capabilities auto-aggregated on aimeat.io from 21 extensions + 15 cortex modules

- **19 new MCP tools** (52 -> 72 total)
  - Extension lifecycle: `install`, `get`, `activate`, `deactivate`, `delete` (5)
  - Cortex lifecycle: `list`, `install`, `activate`, `deactivate`, `delete` (5)
  - Capability CRUD: `create`, `update`, `delete`, `vouch` (4)
  - App management: `publish`, `list`, `get`, `delete`, `versions` (5)

- **App catalog server integration** -- Published Apps section now fetches from server, shows apps published via MCP or other devices with source badges (local/server/both)

### Fixed
- `ctx.log` in extension sandbox now callable as function (was object-only, caused "not a function" for scripts using `ctx.log("msg")`)
- Stale closure in extensions-tab.js `onSrvManifestChange` (script code lost when manifest edited)
- YAML quote stripping for auto-extracted script filenames
- Capability aggregator errors now logged instead of silently swallowed
- Capability aggregation runs at startup, not just on cron schedule
- App publish via MCP uses owner GHII (not agent GAII) for correct catalog visibility

### Changed
- Capabilities tab redesigned: shows all node capabilities with source filter, policy settings, how-created explanation (was bare CRUD form)
- Capabilities MenuItem added to profile landing page (new + active/experienced tiers)
- GET /v1/capabilities response includes `policy` object (publishing, publishers, webhooks settings)

## [1.2.6] - 2026-04-30

Previous release.
