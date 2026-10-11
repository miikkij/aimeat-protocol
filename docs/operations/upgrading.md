# Upgrading a node

How a node moves from one version to the next, what runs by itself, what to check afterwards, and what
version 4.0.0 removes and what an operator or a client changes before it arrives.

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

Each item below is deprecated in 3.x and still works there, so a node and its clients can move off it
before 4.0.0. Most of them have a setting that turns the old way off now: turn it off on a test node
first, watch the refusals, and fix the clients that hit them.

| What goes | Setting today | After it goes, a client gets | What to change first |
|---|---|---|---|
| **Owner-key sign-in**: `POST /v1/auth/token` with an owner name and a signature made with the account's private key | `AIMEAT_OWNER_KEY_LOGIN` (on by default in 3.x) | 410 `OWNER_KEY_LOGIN_OFF`, naming `POST /v1/ghii/login` | people sign in with a password or a passkey; scripts use a personal access token or device authorization. A client that registers people without a password must give them one |
| **A session token in a WebSocket address** (`?token=` on `/v1/realtime/ws`, `/v1/connect/tunnel`, `/v1/personal/tunnel`). A proxy writes addresses to its access log, so that log held live tokens | `AIMEAT_WS_QUERY_TOKEN` (on by default in 3.x) | 401 `WS_QUERY_TOKEN_DISABLED` | clients take a single-use ticket from `POST /v1/ws/ticket` and connect with `?ticket=`, or send an `Authorization` header |
| **Federation messages without a delivery proof** (no audience) | `AIMEAT_FEDERATION_AUDIENCE_REQUIRED` (required by default from 3.27.0; a peer that once sent a proof is always held to it) | 401 `AUDIENCE_REQUIRED` | every peer runs a version that sends the proof. `aimeat_admin_federation` names peers that are versions behind |
| **An optional relay claim**: `AIMEAT_FEDERATION_RELAY_CLAIM=optional`, and a peer's own `relay_claim: optional` | `AIMEAT_FEDERATION_RELAY_CLAIM` (required by default since 3.20.0) | 403 `RELAY_CLAIM_REQUIRED` for a relayed request without a signed claim | relaying peers send `x-relay-claim` and `x-relay-signature`. The federation overview lists peers that are not ready; set each with `aimeat_admin_federation_relay_claim_set` once it signs |
| **The old morsel price fields**: `price.morsels`, `price_morsels`, `base_morsels`, `payMorsels`, `priceMorsels`, `budget_unit: morsels`, `clear_morsels`, `pricing.base_morsels`, `commercial.payMorsels`. A morsel paces use; it is not a price | none: the node refuses them by itself when it runs 4.0.0 | 400 `MORSEL_PRICE_REMOVED`, naming `toll_morsels` | write the pacing amount as `toll_morsels` (`tollMorsels`, `clear_toll`, `pricing.toll_morsels`) and a money price as a money price. Responses in 3.x carry the old field as a mirror marked `deprecated`; stop reading it |
| **`costCapMorsels` in a workflow definition** (accepted and ignored in 3.x, with a warning) | none | the field is gone | set `maxCostUsd` |
| **The AI settings routes from before providers**: `/v1/openrouter/settings`, `/v1/openrouter/models`, `/v1/openrouter/test`, `/v1/ai/settings` | `AIMEAT_AI_LEGACY_SETTINGS_ROUTES` (on by default in 3.x) | 410, naming `/v1/ai/providers` | use `/v1/ai/providers` |
| **A fixed TURN user name and password** for voice and video relay | `AIMEAT_TURN_USERNAME`, `AIMEAT_TURN_CREDENTIAL` (used only when `AIMEAT_TURN_SECRET` is not set) | the fixed pair is no longer served | set `AIMEAT_TURN_SECRET` (the coturn shared secret); the node then gives each client a credential that expires (`AIMEAT_TURN_TTL_SECONDS`) |

Three of these are named in the code as constants, and the version that removes each is read from
there: `UNPROVEN_FORMAT_REMOVED_IN` (`aimeat/src/config-federation.ts`),
`MORSEL_PRICE_FIELDS_REMOVED_IN` (`aimeat/src/config-pacing.ts`) and
`RELAY_CLAIM_OPTIONAL_REMOVED_IN` (`aimeat/src/services/relay-claim-policy.ts`). The others name 4.0.0
in their setting's description.

Already removed before 4.0.0, and listed here because old guides still mention them: micro-memory
routes, the one-time-key write routes, the Ed25519 owner key returned by registration as the way to
sign in (see the first row), MongoDB and Prisma storage. The
[feature list](../AIMEAT-Feature-List.md) has a section on what was removed and what replaced it.

## Protocol versions

The versions of outside protocols the node declares (MCP, A2A, OAuth metadata and others) are kept in
`aimeat/security/protocol-versions.json`. A new node version can raise a declared version; a client
that pins an older one should read that file in the release it upgrades to.
