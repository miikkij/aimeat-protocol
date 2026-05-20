# Changelog

All notable changes to AIMEAT are documented in this file.

## [1.4.3] - 2026-05-20

### Fixed
- **Setup wizard broken by CSP** -- inline `onclick` event handlers in `wizard.html` were blocked by the Content Security Policy (`script-src` requires nonce or `unsafe-inline`). Replaced all 17 inline handlers with `addEventListener` calls inside the nonce-protected `<script>` block. New users could not complete initial node setup because no buttons worked.

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
