# Upgrading a node

How a node moves from one version to the next, what runs by itself, what to check afterwards, what
version 4.0.0 removed and what an operator or a client changes before a 3.x node moves to it, and what
4.0.0 deprecates for the next major release.

## Find out what is available

- An operator sees a notice in the page header when a newer version is published. An operator's AI
  reads the same with
  `aimeat_admin_node_update` (`GET /v1/admin/node-update`): the running version, the newest one, what
  is new, how this node seems to be installed, and a ready prompt with the steps for that install.
- The check asks the npm registry. `AIMEAT_UPDATE_CHECK` turns it off and
  `AIMEAT_UPDATE_CHECK_SOURCE` points it elsewhere.
- What changed is in [CHANGELOG.md](../../CHANGELOG.md) and on the node's own changelog page.

## The update

An update is a stop, an install and a start. Every database change the version brings runs by itself
at start, in order, each once, and the node always starts; nobody runs a script by hand.

1. **Back up** the database, `.env` and the node's key file ([backup and restore](backup-and-restore.md)).
2. **Tell the people who use the node** when it will be down, if it matters to them.
3. **Install the new version the same way the node was installed:**
   - npm: `npm install -g aimeat@<version>`, or `npx aimeat@<version> start`;
   - from source: `git pull`, `pnpm install`, `pnpm build` in `aimeat/`;
   - Docker: `git pull`, then `docker compose up --build -d` with the same compose file as before;
   - the desktop app updates itself.
4. **Start it the same way as before**, with the same `.env`. `aimeat init` is for a new node only;
   running it on an existing one writes a new configuration. `aimeat update` copies a newer package's
   asset files into the working folder and skips any file you changed; the node also does this at
   start.
5. **Check:**
   - `curl -s https://<your node>/v1/build` shows the new version and a fresh start time;
   - `GET /v1/health` reads `status: healthy`;
   - the admin Security page (or `aimeat_admin_security_overview`) lists no new incident. A database
     change that cannot place some data on evidence leaves that data as it was and opens one incident
     there, with a decision per case (`aimeat_admin_incident_resolve`).

**Going back.** Restore the backup you took in step 1 and start the old version. An older version
does not undo the database changes a newer one made, so going back without that backup is not
supported.

## What 4.0.0 removes

Each item below was deprecated in 3.x and still works on a 3.x node, so a node and its clients can
move off it before the upgrade. Most of them have a setting that turns the old way off on 3.x: turn it
off on a test node first, watch the refusals, and fix the clients that hit them.

From 4.0.0 each one is refused whatever the configuration says: a setting that kept it on has no
effect, and the Config page refuses the value that would keep it on. On a 3.x node, every use answers
with `Deprecation: true`, `X-AIMEAT-Removed-In: 4.0.0` and, where there is one, a `Link` to the way
that replaces it (`rel="successor-version"`). `GET /v1/stats` counts each use under
`deprecated_use_by_type` (`ws_query_token` and `mcp_oauth_legacy` keep their own counters), and the
node log names each kind once a day. When a count stays at zero, nothing on that node still uses it.

| What goes | Setting on 3.x | From 4.0.0, a client gets | What to change first |
|---|---|---|---|
| **Owner-key sign-in**: `POST /v1/auth/token` with an owner name and a signature made with the account's private key | `AIMEAT_OWNER_KEY_LOGIN` (on by default in 3.x) | 410 `OWNER_KEY_LOGIN_OFF`, naming `POST /v1/ghii/login` | people sign in with a password or a passkey; scripts use a personal access token or device authorization. A client that registers people without a password must give them one |
| **A session token in a WebSocket address** (`?token=` on `/v1/realtime/ws`, `/v1/connect/tunnel`, `/v1/personal/tunnel`). A proxy writes addresses to its access log, so that log held live tokens | `AIMEAT_WS_QUERY_TOKEN` (on by default in 3.x) | 401 `WS_QUERY_TOKEN_DISABLED` | clients take a single-use ticket from `POST /v1/ws/ticket` and connect with `?ticket=`, or send an `Authorization` header |
| **Federation messages without a delivery proof** (no audience) | `AIMEAT_FEDERATION_AUDIENCE_REQUIRED` (required by default from 3.27.0; a peer that once sent a proof is always held to it) | 401 `AUDIENCE_REQUIRED` | every peer runs a version that sends the proof. `aimeat_admin_federation` names peers that are versions behind |
| **An optional relay claim**: `AIMEAT_FEDERATION_RELAY_CLAIM=optional`, and a peer's own `relay_claim: optional` | `AIMEAT_FEDERATION_RELAY_CLAIM` (required by default since 3.20.0) | 403 `RELAY_CLAIM_REQUIRED` for a relayed request without a signed claim | relaying peers send `x-relay-claim` and `x-relay-signature`. The federation overview lists peers that are not ready; set each with `aimeat_admin_federation_relay_claim_set` once it signs |
| **The old morsel price fields**: `price.morsels`, `price_morsels`, `base_morsels`, `payMorsels`, `priceMorsels`, `budget_unit: morsels`, `clear_morsels`, `pricing.base_morsels`, `commercial.payMorsels`. A morsel paces use; it is not a price | none: the node refuses them by itself when it runs 4.0.0 | 400 `MORSEL_PRICE_REMOVED`, naming `toll_morsels` | write the pacing amount as `toll_morsels` (`tollMorsels`, `clear_toll`, `pricing.toll_morsels`) and a money price as a money price. Responses in 3.x carry the old field as a mirror marked `deprecated`; stop reading it |
| **`costCapMorsels` in a workflow definition** (accepted and ignored in 3.x, with a warning) | none | 400 `WORKFLOW_INVALID` on a save that sets it (over MCP: "Validation failed") | set `maxCostUsd` |
| **The AI settings routes from before providers**: `/v1/openrouter/settings`, `/v1/openrouter/models`, `/v1/openrouter/test`. `/v1/ai/settings` stays: it holds the daily AI budget, the per-app caps and the app allowlist | `AIMEAT_AI_LEGACY_SETTINGS_ROUTES` (on by default in 3.x) | 410, naming `/v1/ai/providers` | the connection and its key: `/v1/ai/providers/{id}` and `/v1/ai/providers/{id}/key`; a test: `POST /v1/ai/providers/{id}/test`; models: `/v1/ai/models`; "is AI on": `/v1/ai/available`; the voice recorder's limit: `limits` in `GET /v1/ai/settings` |
| **A fixed TURN user name and password** for voice and video relay | `AIMEAT_TURN_USERNAME`, `AIMEAT_TURN_CREDENTIAL` (used only when `AIMEAT_TURN_SECRET` is not set) | the fixed pair is no longer served: the TURN entry carries the address alone | set `AIMEAT_TURN_SECRET` (the coturn shared secret); the node then gives each client a credential that expires (`AIMEAT_TURN_TTL_SECONDS`) |
| **The MCP OAuth flow without PKCE or a resource** | none | 400 `invalid_request` or `invalid_target` | the AI client sends PKCE (S256) and `resource` naming the node's MCP endpoint, as current clients do |
| **An MCP OAuth access token on a REST route.** The token an AI gets from `POST /v1/mcp/token` names the node's MCP endpoint as its audience, and RFC 8707 says it is for that endpoint only. Counted as `mcp_token_on_rest` | none: the node refuses it by itself when it runs 4.0.0 | 401 `INVALID_TOKEN` with `WWW-Authenticate: Bearer error="invalid_token"`. The MCP endpoints (`/v1/mcp`, `/mcp`, `/v2/mcp/<role>`) keep taking it, and so do the node's own MCP tools that reach REST routes for the session (`aimeat_invoke`, `aimeat_capabilities_invoke`, `aimeat_app_tool_invoke`) | a script or app that calls REST routes uses an agent token from device authorization or a personal access token, and keeps the MCP token for the MCP endpoint. The node log names the route and the agent once a day |

Each removal is named in the code by its own constant, beside the code it gates, and the version
that removes it is read from there:

| Constant | File |
|---|---|
| `OWNER_KEY_LOGIN_REMOVED_IN`, `WS_QUERY_TOKEN_REMOVED_IN` | `aimeat/src/config-security.ts` |
| `UNPROVEN_FORMAT_REMOVED_IN`, `RELAY_CLAIM_OPTIONAL_REMOVED_IN` | `aimeat/src/config-federation.ts` (the second re-exported by `services/relay-claim-policy.ts`) |
| `MORSEL_PRICE_FIELDS_REMOVED_IN` | `aimeat/src/config-pacing.ts` |
| `COST_CAP_MORSELS_REMOVED_IN` | `aimeat/src/services/workflow/store.ts` |
| `AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN` | `aimeat/src/config-ai-models.ts` |
| `TURN_STATIC_PAIR_REMOVED_IN` | `aimeat/src/config-turn.ts` |
| `MCP_OAUTH_LAX_REMOVED_IN` | `aimeat/src/mcp/oauth-binding.ts` |
| `MCP_TOKEN_ON_REST_REMOVED_IN` | `aimeat/src/auth/mcp-token-on-rest.ts` |

## What else changes in 4.0.0

These are not removals, but each takes effect when the node reports 4.0.0, and each has its own
constant.

| What changes | From 4.0.0 | Before 4.0.0 | Constant |
|---|---|---|---|
| **A consent made without a reach** | it is `local`: the recipient reads on this node, and nothing is replicated because of it | it is `federation`. `local` is accepted already, and `private` and `dmz` are stored and answered as `local` (with the Deprecation headers; they are accepted through 4.x) | `CONSENT_REACH_LOCAL_DEFAULT_IN` (`aimeat/src/utils/consent-reach.ts`) |
| **A plain-http peer address on a public node** | refused with 400 `PEER_HTTPS_REQUIRED`; a local node keeps plain http | taken, with the Deprecation headers | `PEER_HTTPS_REQUIRED_IN` (`aimeat/src/services/peer-url-policy.ts`) |
| **`AIMEAT_AI_PROVENANCE=false` on a public node** | has no effect; the start-up check says it was refused. A local node keeps the switch | switches recording off, and the start-up check says it stops working in 4.0.0 | `PROVENANCE_SWITCH_LOCAL_ONLY_IN` (`aimeat/src/config-ai-label.ts`) |
| **Discovery** (`/.well-known/aimeat`, `GET /` `this_node`) | states `protocol_version: "2026-11"` and the Core profiles the node claims | leaves both out | `CORE_PROTOCOL_FROM` (`aimeat/src/services/core-discovery.ts`) |
| **The REST routes that asked no scope word** (70 of them: organism membership and invitations, task creation for another agent and the v2 task roster, schedules, extension actions and instances, cortex reads, knowledge package writes, installs, appeals, checkout completion and a few more; `x-aimeat-scope` in `openapi.yaml` names each one's word) | an agent, an app or an ecosystem app without the word is refused with 403 `SCOPE_DENIED`. The owner in person needs no word, and an agent acting on its own record (its own tasks, offers and reports) needs none either | the call is allowed, answers with the Deprecation headers, and is counted per word in `GET /v1/stats` (`deprecated_use_by_type`, `rest_scope_missing:<word>`). The same holds for their MCP twins (`aimeat_workspace_list`, `aimeat_organism_invitations`, `aimeat_organism_invitation_respond`, `aimeat_skill_list`, `aimeat_package_instances`, `aimeat_v2_task_list`, `aimeat_v2_task_get`), and for `ext:invoke` on `aimeat_app_tool_invoke`, which runs the app tool's extension action and asks `exchange:write` on every release | `REST_SCOPE_GATES_ENFORCED_IN` (`aimeat/src/utils/rest-scope-release.ts`) |
| **The owner's agent list** (`GET /v1/agents`, `GET /v1/agents/v2/basic-agents`, `GET /v1/agents/v2/migrate`, and the MCP tools `aimeat_agents_list` and `aimeat_agent_basics_get`) | an agent, an app or an ecosystem app without `agent:read` is refused with 403 `SCOPE_DENIED` | allowed with the Deprecation headers and counted under `rest_scope_missing:agent:read` | `REST_SCOPE_GATES_ENFORCED_IN` |

**Agents need the new words before the node runs 4.0.0.** On its first start on a version with the gates, the node
gives the words that did not exist before, `packages:read` and `agent:read`, to every agent and
approved ecosystem app it has (`aimeat/src/services/rest-scope-gates-migration.ts`, once per node and
word; the start-up log names who got them). `agent:read` is also in the default agent scopes. It does not give the words that existed already (`task:write`, `organism:invite`,
`ext:invoke`, `memory:read` and the rest), because each of them also opens other routes and tools
that the agent's owner never granted. So before the upgrade: read `deprecated_use_by_type` in
`GET /v1/stats` for the `rest_scope_missing:` entries (and the node log, which names the caller and
the route once a day per word), and tick the missing word on each agent that needs it (Profile →
Agents, or `aimeat_operator_agent_configure`). An app declares the word in its
`aimeat-scopes` meta tag and its owner approves it on the consent screen. An agent or app holding `*`
is not affected.

A peer row stored with a plain-http address before 4.0.0 is not rewritten: on a public node the key
exchange refuses it from 4.0.0. Change its address to `https://` before the upgrade.

Already removed before 4.0.0, and listed here because old guides still mention them: micro-memory
routes, the one-time-key write routes, the Ed25519 owner key returned by registration as the way to
sign in (see the first row), MongoDB and Prisma storage. The
[feature list](../AIMEAT-Feature-List.md) has a section on what was removed and what replaced it.

## What 4.0.0 deprecates for 5.0.0

Two names made a morsel amount sound like a price. In 4.0.0 both are `toll_morsels`, the pacing
amount. The old names still work through the 4.x releases, and 5.0.0 refuses them.

| Old name | New name | In 4.x | From 5.0.0 |
|---|---|---|---|
| A knowledge package's `sharing.morsel_price` (`POST /v1/knowledge/import`, and a manifest written as memory under `packages/{id}/manifest`) | `sharing.toll_morsels` | accepted with `Deprecation: true` and `X-AIMEAT-Removed-In: 5.0.0`, counted in `GET /v1/stats` as `knowledge_morsel_price`, and stored as `toll_morsels` by the import | 400 `MORSEL_PRICE_REMOVED` |
| A capability's `cost.morsels` (`POST` and `PUT /v1/capabilities`) | `cost.toll_morsels` | the same headers, counted as `capability_cost_morsels`, stored as `toll_morsels` | 400 `MORSEL_PRICE_REMOVED` |

Both names in one request with different amounts are 400 `TOLL_MORSELS_MISMATCH`. A record stored with
the old name before 4.0.0 is read as `toll_morsels`; nothing needs to be rewritten. The constant is
`MORSEL_PRICE_NAMES_REMOVED_IN` in `aimeat/src/config-pacing.ts`.

## Protocol versions

The versions of outside protocols the node declares (MCP, A2A, OAuth metadata and others) are kept in
`aimeat/security/protocol-versions.json`. A new node version can raise a declared version; a client
that pins an older one should read that file in the release it upgrades to.

AIMEAT Core itself is the `aimeat-core` row there: the edition the node is written to (`2026-11`),
held to `x-aimeat-protocol` in `openapi.yaml`. The edition is normative since node 4.0.0, and a node
from that release states it in discovery as `protocol_version`. `openapi.yaml` `info.version` and the MCP `serverInfo.version` are the
node's own version.
