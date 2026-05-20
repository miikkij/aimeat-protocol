# Changelog

All notable changes to AIMEAT are documented in this file.

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
