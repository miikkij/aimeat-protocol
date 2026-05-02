# Changelog

All notable changes to AIMEAT are documented in this file.

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
