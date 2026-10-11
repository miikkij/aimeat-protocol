# Service Extensions Manual

How an operator installs, reviews, runs and removes service extensions on an AIMEAT node.

**Writing an extension** (the manifest, the action scripts, the `ctx` rules, instances, schedules,
secrets, the money price and the pacing amount) is in the built-in skill
**`aimeat-extension-builder`**, which every node serves: `aimeat_skill_get { name: "aimeat-extension-builder" }`
over MCP, or `GET /v1/skills/aimeat-extension-builder?scope=node`. The full `ctx` table and manifest
reference is the node's own build guide, `GET /v1/prompts/build-extension`. Both are read by the AI
that builds the extension, so they live on the node and not in this repository. This manual keeps
what the operator does.

## What is a Service Extension?

A Service Extension is a JavaScript module that runs inside a QuickJS-WASM sandbox on an AIMEAT node, one script per action, reachable as `POST /v1/ext/{name}/{action}`. It adds domain-specific behavior, such as a listing workflow, membership management or matching logic, on top of the core platform.

Extensions do NOT replace core functionality. They orchestrate it. The core platform provides storage (Memory API), access control (Consent API), reputation (Trust API), identity (Auth), content moderation (Flags), discovery (Catalogue), and the checkout and pacing for anything sold. An extension provides the business rules that tie these together for a specific use case.

### Why a sandbox?

Extensions are shared as plain JavaScript files — via GitHub, packages or direct transfer. When you install code written by someone else, it is untrusted by definition. The sandbox is **QuickJS compiled to WASM** (`quickjs-emscripten`), which replaced the earlier V8 `isolated-vm` runtime on 29 April 2026 so that installing a node needs no C++ build tools. It ensures that extension code:

- Cannot access Node.js globals (`process`, `require`, `fs`) or the host's own `fetch`; outside calls go through `ctx.fetch` only, and only when the manifest declares `network`
- Cannot use timers (`setTimeout`, `setInterval`)
- Cannot use `eval()` or dynamic code execution
- Is constrained by memory limits, CPU timeouts, and API call caps
- Can only interact with the node through a controlled `ctx` API proxy

The node operator decides which extensions to install and activate. The sandbox ensures those extensions cannot compromise the node even if the code contains bugs or malicious intent.

## Architecture

```
+-----------------------------------------------------+
|                    AIMEAT Node                        |
|                                                      |
|  Core APIs (always available):                       |
|  +--------+ +---------+ +-------+ +----------+      |
|  | Memory | | Consent | | Trust | | Checkout |      |
|  +--------+ +---------+ +-------+ +----------+      |
|  +--------+ +--------+ +-----------+ +------+       |
|  |  Auth  | | Flags  | | Catalogue | | Work |       |
|  +--------+ +--------+ +-----------+ +------+       |
|                                                      |
|  Service Extensions (installed):                      |
|  +--------------------+  +---------------------+    |
|  | marketplace-behaviors |  | membership-behaviors |    |
|  | Instance: "Flea Mkt" |  | Group: "Club A"      |    |
|  | Instance: "Co. Exch" |  | Group: "Club B"      |    |
|  +--------------------+  +---------------------+    |
|                                                      |
|  QuickJS-WASM Sandbox Runtime                        |
|  - Isolated memory (64 MB default)                   |
|  - CPU timeout (5000 ms default)                     |
|  - API call limit (500 per action default)           |
+-----------------------------------------------------+
```

### What the Extension Does vs What Core Does

| Concern | Handled by | Mechanism |
|---------|-----------|-----------|
| Data storage | Core | Memory API — namespaced per extension (and per instance) |
| Money price and pacing | Core | The node charges an action's pacing amount and its money price before the script runs; the script never charges anyone |
| Access control | Core | Consent API — check/require consent scopes |
| Reputation | Core | Trust API — read trust scores |
| Identity | Core | Auth middleware — caller GAII, owner, roles, scopes |
| Content moderation | Core | Flags API — users flag content, operators review |
| Action discovery | Core | Catalogue — lists all available actions |
| **Action definitions** | **Extension** | Declares what actions exist with input/output schemas |
| **Validation rules** | **Extension** | "Is this listing available?", "Does the user have access?" |
| **State transitions** | **Extension** | Change status fields in memory records |
| **Instance config** | **Extension** | Per-instance settings (categories, visibility, currency) |

## Reviewing a manifest before you install it

Every extension is an `extension.yaml` manifest plus its scripts. Before installing someone else's, read these parts of the manifest, because they are what the extension can reach and what it costs the people who use it:

| Field | What it means for your node |
|-------|------------------------------|
| `capabilities` | `[network, ai, email, payments]`: what the scripts may do beyond their own memory. The sandbox gives nothing that is not listed. Absent, the node infers the list from the scripts' text. |
| `network.hosts` | The only hosts `ctx.fetch` may reach. Without it, any public host. |
| `network.host_fields` | Hosts the installer supplies per install (a customer's own server). |
| `workspace` | `{ read, write }`: the extension acts on the caller's organism workspace as the caller. |
| `config` with `type: secret` | A credential you set after installing; encrypted at rest, never returned in plain text. |
| `schedules` | Jobs the node runs on a clock once the extension is active. `cron: "@activate"` runs at every activation. |
| `actions[].tollMorsels` | The pacing amount in morsels per call, which the node charges the caller (capped by `AIMEAT_EXT_MAX_DEBIT`, default 100). Part burns and the rest is credited to the installer. |
| `actions[].commercial.payMoney` | A money price per call, paid through the node's checkout. |
| `actions[].commercial.payMorsels` | The 3.x name of the pacing amount. Read as pacing until node 4.0.0 and refused from 4.0.0. A morsel is never a price. |
| `limits` | The extension's own resource limits; the node caps each at its maximum. |
| `instances` | Whether one installation can serve several independent copies. |
| `federation` | `advertise` and `capabilities`: stored with the extension. Nothing on the node reads them yet. |

## Multi-Instance Model

Some extensions (like marketplace or matching) support multiple instances — each with its own configuration, data, and users.

### How It Works

1. The extension is installed once
2. The installer or the operator creates instances with different configurations
3. Each instance gets its own memory namespace: `ext:{extensionName}.{instanceId}`
4. Actions are called with the instance ID in the URL: `POST /v1/ext/{extName}/{instanceId}/{actionId}`
5. The same action code runs for all instances — only the config and data namespace differ

### Instance Lifecycle

```
Install extension
  POST /v1/extensions
  Body: { manifest: "...", scripts: { ... } }

Activate extension
  POST /v1/extensions/{name}/activate

Create instance
  POST /v1/extensions/{name}/instances
  Body: { id: "city-flea-market", config: { name: "City Flea Market", visibility: "public", categories: ["electronics", "furniture"] } }

Execute action on instance
  POST /v1/ext/{name}/{instanceId}/{actionId}
  Body: { ... action input ... }

List instances
  GET /v1/extensions/{name}/instances

Update instance config
  PATCH /v1/extensions/{name}/instances/{instanceId}
  Body: { config: { categories: ["books"] } }

Delete instance
  DELETE /v1/extensions/{name}/instances/{instanceId}
```

A schedule in the manifest runs for the extension, not per instance. An instance's own schedule is created with `POST /v1/schedules` (`kind: "extension"`, `extension_name`, `action_id`, `instance_id`) or `aimeat_schedule_create`.

### Memory Namespace Convention

All data for an instance lives under a predictable memory prefix:

```
ext:marketplace-behaviors.city-flea-market  listing.abc123
ext:marketplace-behaviors.company-exchange  listing.def456
```

This means:
- Instances are fully isolated from each other
- Data can be queried with `ctx.memory.search('listing.')` within an instance (the runtime adds the namespace automatically)
- A key the extension wrote public can be read by anyone at `GET /v1/memory/ext:{name}.{instanceId}/{key}`; a key written private cannot

## Extensions the node ships

Most extensions arrive because somebody uploaded them. A few arrive with the build, because a
feature depends on them and asking a person to find the Extensions page first would mean the
feature does not exist for the people it was written for.

The list is `BUILTIN_EXTENSIONS` in `src/data/builtin-extensions/index.ts`, and
`services/builtin-extension-seeder.ts` runs at boot. It is source in that directory rather than
files on disk because `tsc` emits TypeScript and copies nothing: a `.js` sitting beside a `.ts`
would be there in development and missing from `dist`.

Three rules:

1. **Missing** → install it and switch it on.
2. **Installed at the same version or newer** → leave it alone. An operator who deployed their own
   copy keeps it.
3. **Installed at an older version** → swap the code, **keep the config**. Every value an owner set
   survives; only the `__`-prefixed keys the node writes from validated manifest sections come from
   the new manifest. The status is theirs too: a builtin somebody switched off stays off.

A builtin goes through the same manifest validator and the same write path an upload does, so there
is no side door: a mistake in the shipped YAML is a refusal at boot naming the field, logged, and
the node boots without it rather than failing to boot. `installedBy` is `system`, which is not an
account anyone signs in as, so only an operator can manage one.

### living-hooks

The one builtin today: the two doors a living document uses to talk to the world.

- `POST /v1/ext/living-hooks/send` — `{ url, method?, headers?, body }` → `{ ok, status, ms }`.
  Sends the whole state of a document to an address its owner allowed. Needs `memory:write`.
- `POST /v1/ext/living-hooks/read` — `{ url, path?, raw?, headers? }` →
  `{ value, fetchedAt, contentType, cached }`. Reads one value back, raw or through a JSON path
  written in dots and brackets (`prices[0].price`). Needs `memory:read`. The same address is
  fetched at most once every ten seconds per owner.

A refusal is a normal answer carrying `{ error: { code, message } }`, not a thrown error, so the
browser half can show the words: `ALLOWLIST_REFUSED`, `RATE_LIMITED` (60 sends and 120 reads a
minute per owner), `PAYLOAD_TOO_LARGE` (256 kB), `TOO_LARGE` (a read over 1 MB, or any answer
over the 4 MB the node reads, on send as well), `UPSTREAM_FAILED` (with
the far end's status), `BAD_PATH`, plus `NOT_AUTHORIZED`, `SCOPE_DENIED`, `HEADER_REFUSED`,
`SECRET_UNKNOWN` and `INVALID_INPUT`.

**Where a person says which addresses may be called.** One record in their own memory:

```json
// key: living-hooks.settings   visibility: public
{ "allow_hosts": ["api.example.com", ".porssisahko.net"] }
```

An entry is a whole host, or a leading dot for that host and everything under it. The node's own
`allow_hosts` in the extension config is added to it, and is empty by default — so a fresh install
calls nowhere until somebody says where. Loopback and private ranges are refused by `safeFetch`
regardless of the list, except on a node running with `AIMEAT_ALLOW_PRIVATE_EGRESS`.

**A key that should not be written into a document.** Store it in the extension's `secrets` config
(one encrypted string holding JSON, `{"NAME": "value"}`) and name it in a header:

```json
{ "headers": { "Authorization": "Bearer {{secret:HOOK_TOKEN}}" } }
```

It is resolved on the way out and appears in no answer the caller receives. Only these header names
may be sent at all: `Authorization`, `Content-Type`, `Accept`, `X-Api-Key`, `X-Requested-With`, and
anything beginning `X-Living-`.

`secrets` is node-level, because extension config is: there is no per-owner config for a plain
extension, so on a shared node the operator sets what everyone's documents may use. `allow_hosts`
is per owner because it lives in the owner's own record, and a list of hostnames is not a secret.

### The four bundled examples

Four more ship as files in `docs/extensions/` (`dist/docs/extensions` in a package), installed only
when the operator chooses: `marketplace-behaviors`, `matching-behaviors`, `membership-behaviors` and
`rest-connector`. `GET /v1/admin/extensions/available` lists them, and one call installs and
activates one:

```
POST /v1/admin/extensions/available/{name}/install
Authorization: Bearer <operator-token>
```

`POST /v1/admin/extensions/available/{name}/reinstall` deploys the files on disk over an installed
copy. An operator edit through `PUT /v1/admin/extensions/available/{name}/scripts/{actionId}` writes
into those files, so in a development checkout it changes the repository. Each folder's README says
what the extension does.

## Installation and Management

### Who may install

`POST /v1/extensions` needs the role in `AIMEAT_EXT_INSTALL_ROLE` (default `owner`; set `operator`
to keep installs to operators), or a principal holding `ext:write`. An app under an app grant can
never hold `ext:write`. The installing owner, their agents with `ext:write`, and the operator may
then manage the extension.

### Installing an Extension

Extensions are installed by sending the YAML manifest and JavaScript action scripts to the node:

```
POST /v1/extensions
Authorization: Bearer <token>
Content-Type: application/json

{
  "manifest": "extension: \"1.0\"\nmetadata:\n  name: my-extension\n  ...",
  "scripts": {
    "actions/create.js": "export default async function(ctx, input) { ... }",
    "actions/list.js": "export default async function(ctx, input) { ... }"
  }
}
```

The `scripts` object keys must match the `script` fields in the manifest's action definitions. Over
MCP the same is `aimeat_extension_install` (inline, or omit `manifest` and `scripts` to get an
`upload_url` for a ZIP).

### Activating

An uploaded extension is inactive. Activate it to make its actions callable; this also registers its
schedules and runs the `@activate` ones:

```
POST /v1/extensions/my-extension/activate
Authorization: Bearer <token>
```

### Updating

Redeploy in place:

```
PUT /v1/extensions/my-extension
Authorization: Bearer <token>
Content-Type: application/json

{ "manifest": "...", "scripts": { ... } }
```

The manifest and scripts are swapped in one write, so the next call runs the new code and the action
never disappears mid-redeploy. The `ext:{name}` memory, the instances and the activation are kept;
for an active extension the schedules are re-registered from the new manifest and the `@activate`
jobs run again. Identical bytes are a no-op. Over MCP: `aimeat_extension_install` with `update: true`.

Do not update by uninstalling and installing again: uninstalling deletes the extension's data.

### Deactivating

Deactivating an extension stops all action execution and its schedules, and keeps the installation and all its data:

```
POST /v1/extensions/my-extension/deactivate
Authorization: Bearer <token>
```

### Uninstalling

```
DELETE /v1/extensions/my-extension
Authorization: Bearer <token>
```

Uninstalling removes the extension, its scheduled jobs, its `ext:{name}` namespace and every
instance's namespace. Export what you want to keep first.

### Resource Limits

Each extension declares resource limits in its manifest. The node enforces these limits and caps them at node-level maximums:

| Limit | Manifest field | Default | Node max config |
|-------|---------------|---------|-----------------|
| Memory | `limits.memory_mb` | 64 MB | `AIMEAT_EXT_MAX_MEMORY_MB` |
| CPU timeout | `limits.timeout_ms` | 5000 ms | `AIMEAT_EXT_TIMEOUT_MS` |
| API calls per action | `limits.max_api_calls` | 500 on the node, and what a manifest asks for is capped by it | `AIMEAT_EXT_MAX_API_CALLS` |
| Script size | N/A | 256 KB per script | `AIMEAT_EXT_MAX_CODE_SIZE_KB` |
| Max extensions | N/A | 20 | `AIMEAT_EXT_MAX_INSTALLED` |
| Pacing per call | `actions[].tollMorsels` | node default | `AIMEAT_EXT_MAX_DEBIT` (100) |
| One answer read by `ctx.fetch` | `limits.fetch_max_mb` | 4 MB | 32 MB at most |

If an action exceeds its timeout, the sandbox is terminated and an `EXTENSION_TIMEOUT` error is returned. If an action exceeds its API call limit, further API calls return errors. An answer longer than the read limit makes `ctx.fetch` throw `RESPONSE_TOO_LARGE: …`: the node stops reading and the script gets none of the answer. The message names the host the script called, and no other part of the address.

## Federation

A manifest may carry `federation: { advertise, capabilities }`. The node stores both with the
extension. No route lists extension capabilities to peers, and nothing on the node reads the block
yet, so it is a declaration for the future and not a way to be found.

## Example: Marketplace Extension

`marketplace-behaviors` (in `docs/extensions/`) is a listing workflow: a seller lists an item with a
money price, a buyer agrees to buy it, the seller confirms delivery and the buyer rates it. It takes
no payment: the buyer pays the seller outside the extension, or through the node's checkout when the
seller sells the item as an offer or app tool with a money price.

### Actions

| Action | Purpose | Pacing per call |
|--------|---------|-----------------|
| `create-listing` | A listing with a money price and a currency | 2 morsels |
| `browse` | Listings by category and price range | none |
| `purchase` | Agree to buy at the listing's price; the listing is reserved | 1 morsel |
| `deliver` | The seller confirms delivery | none |
| `rate` | The buyer rates a delivered purchase (1-5 stars) | none |
| `update-listing`, `delist` | The seller (or an operator) changes or removes a listing | none |

The node charges the pacing before the script runs and credits it, less the burn rate's share, to
whoever installed the extension; the installer's own calls are free. The purchase record says who
bought what, so it is written private.

### Instance Configuration

Each marketplace instance can have different settings:

```json
{
  "id": "city-flea-market",
  "config": {
    "visibility": "public",
    "categories": ["electronics", "furniture", "clothing", "sports", "other"],
    "currency": "EUR"
  }
}
```

```json
{
  "id": "company-exchange",
  "config": {
    "visibility": "password",
    "password": "company-secret-2026",
    "categories": ["office-supplies", "equipment", "furniture"]
  }
}
```

```json
{
  "id": "premium-vendors",
  "config": {
    "visibility": "invite",
    "allowed_users": ["vendor-alice@your-node", "vendor-bob@your-node"],
    "categories": ["luxury", "art", "collectibles"]
  }
}
```

## Example: Matching Extension

`matching-behaviors` connects people in a matching pool by shared interests, location and activity.

| Action | Purpose |
|--------|---------|
| `create-profile` | Register a matching profile; needs the person's consent with purpose `matching` |
| `update-profile` | Change a profile |
| `run-matching` | Run a matching round (also every six hours on its schedule) |
| `get-suggestions` | The caller's current suggestions |
| `respond` | Accept or dismiss a suggestion |

```json
{
  "id": "helsinki-hobbies",
  "config": {
    "name": "Helsinki Hobbies",
    "visibility": "public",
    "max_distance_km": 50,
    "match_threshold": 0.5,
    "max_suggestions": 5
  }
}
```

## Distributing Extensions

An extension is a bundle of:

1. `extension.yaml` — the manifest
2. `actions/*.js` — the action scripts
3. `README.md` — documentation

It can be shared as files, or inside a package (`aimeat_package_install`). Read the manifest and the
scripts before you install one on your node; the table under "Reviewing a manifest" lists what to
look for.
