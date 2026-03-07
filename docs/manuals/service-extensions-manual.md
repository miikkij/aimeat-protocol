# Service Extensions Manual

How to create, install, and manage service extensions on an AIMEAT node.

## What is a Service Extension?

A Service Extension is a JavaScript module that runs inside a V8 sandbox on an AIMEAT node. It adds domain-specific behavior — such as purchase workflows, membership management, or matching logic — on top of the core AIMEAT platform.

Extensions do NOT replace core functionality. They orchestrate it. The core platform provides storage (Memory API), payments (Wallet API), access control (Consent API), reputation (Trust API), identity (Auth), content moderation (Flags), and discovery (Catalogue). An extension provides the business rules that tie these together for a specific use case.

### Why V8 Sandbox?

Extensions are shared as plain JavaScript files — via GitHub, package registries, or direct transfer. When you install code written by someone else, it is untrusted by definition. The V8 sandbox (powered by `isolated-vm`) ensures that extension code:

- Cannot access Node.js globals (`process`, `require`, `fs`, `fetch`)
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
|  +--------+ +--------+ +---------+ +-------+        |
|  | Memory | | Wallet | | Consent | | Trust |        |
|  +--------+ +--------+ +---------+ +-------+        |
|  +--------+ +--------+ +-----------+ +------+       |
|  |  Auth  | | Flags  | | Catalogue | | Work |       |
|  +--------+ +--------+ +-----------+ +------+       |
|                                                      |
|  Service Extensions (operator-installed):             |
|  +--------------------+  +---------------------+    |
|  | marketplace-behaviors |  | membership-behaviors |    |
|  | Instance: "Flea Mkt" |  | Instance: "Club A"   |    |
|  | Instance: "Co. Exch" |  | Instance: "Club B"   |    |
|  +--------------------+  +---------------------+    |
|                                                      |
|  V8 Sandbox Runtime                                  |
|  - Isolated memory (64 MB default)                   |
|  - CPU timeout (5000 ms default)                     |
|  - API call limit (50 per action default)            |
+-----------------------------------------------------+
```

### What the Extension Does vs What Core Does

| Concern | Handled by | Mechanism |
|---------|-----------|-----------|
| Data storage | Core | Memory API — namespaced per extension instance |
| Payments and escrow | Core | Wallet API — debit caller balance, track transactions |
| Access control | Core | Consent API — check/require consent scopes |
| Reputation | Core | Trust API — read trust scores |
| Identity | Core | Auth middleware — caller GAII, owner, roles |
| Content moderation | Core | Flags API — users flag content, operators review |
| Action discovery | Core | Catalogue — lists all available actions |
| Search and browse | Core | Memory search — prefix-based queries |
| **Action definitions** | **Extension** | Declares what actions exist with input/output schemas |
| **Validation rules** | **Extension** | "Is this listing available?", "Does the user have access?" |
| **State transitions** | **Extension** | Change status fields in memory records |
| **Business rules** | **Extension** | Fee calculation, category validation, instance-specific logic |
| **Instance config** | **Extension** | Per-instance settings (fee %, categories, visibility) |

The extension is a thin choreographer — typically 50-150 lines of JavaScript per action.

## Extension Manifest

Every extension is defined by an `extension.yaml` manifest file. This declares the extension's metadata, required APIs, actions, resource limits, configuration schema, and federation capabilities.

### Manifest Format

```yaml
extension: "1.0"

metadata:
  name: "my-extension"
  version: "1.0.0"
  description: "What this extension does"
  author: "your-name"
  license: "MIT"
  aimeat: ">=1.5"

required_apis:
  - memory
  - wallet
  - consent
  - trust

actions:
  - id: my-action
    description: "What this action does"
    method: POST
    path: "/v1/ext/my-extension/my-action"
    auth: required
    input:
      fieldName:
        type: string
        required: true
        description: "What this field is"
      optionalField:
        type: integer
        min: 1
        max: 100
    output:
      resultField:
        type: string
    script: "actions/my-action.js"

limits:
  memory_mb: 64
  timeout_ms: 5000
  max_api_calls: 50

config:
  my_setting:
    type: integer
    default: 10
    description: "What this setting controls"

instances:
  supported: true
  config_per_instance:
    name:
      type: string
      required: true
      description: "Display name for this instance"
    visibility:
      type: string
      enum: [public, password, invite]
      default: public
      description: "Who can access this instance"
    password:
      type: string
      description: "Password for password-protected instances"
    allowed_users:
      type: array
      items: string
      description: "List of owner names or GHIIs allowed to access this instance"

federation:
  advertise: true
  capabilities:
    - "my-capability"
```

### Manifest Fields Reference

| Field | Required | Description |
|-------|----------|-------------|
| `extension` | Yes | Manifest format version. Currently `"1.0"` |
| `metadata.name` | Yes | Unique extension identifier. Lowercase, hyphens allowed |
| `metadata.version` | Yes | Semantic version |
| `metadata.description` | Yes | Human-readable description |
| `metadata.author` | Yes | Author name or organization |
| `metadata.license` | No | License identifier (e.g., MIT, Apache-2.0) |
| `metadata.aimeat` | No | Minimum AIMEAT version required |
| `required_apis` | Yes | Core APIs this extension needs: `memory`, `wallet`, `consent`, `trust` |
| `actions` | Yes | Array of action definitions (at least one) |
| `limits` | No | Resource limits. Capped by node-level maximums |
| `config` | No | Extension-level configuration schema with defaults |
| `instances.supported` | No | Whether this extension supports multiple instances |
| `instances.config_per_instance` | No | Per-instance configuration schema |
| `federation` | No | Cross-node capability advertising |

## Writing Action Scripts

Each action in the manifest references a JavaScript file via the `script` field. This file exports a default async function that receives a `ctx` object and the action's `input`.

### Action Script Template

```javascript
export default async function(ctx, input) {
  // ctx.caller   — { gaii, owner, roles } — who is calling
  // ctx.config   — extension-level config values
  // ctx.instance — { id, config } — which instance (if multi-instance)
  // ctx.memory   — { get, set, search, delete }
  // ctx.wallet   — { consume, getBalance }
  // ctx.consent  — { check, require }
  // ctx.trust    — { getScore }
  // ctx.log      — { info, warn, error }

  // Your business logic here
  return { result: "value" };
}
```

### ctx API Reference

#### ctx.memory

All memory operations are scoped to the extension's namespace. For single-instance extensions, the namespace is `ext:{extensionName}`. For multi-instance extensions, the namespace is `ext:{extensionName}.{instanceId}`.

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `get(key: string): Promise<any \| null>` | Read a value from memory |
| `set` | `set(key: string, value: any): Promise<void>` | Write a value to memory |
| `search` | `search(prefix: string, opts?): Promise<Array<{key, value}>>` | Search by key prefix |
| `delete` | `delete(key: string): Promise<boolean>` | Delete a memory entry |

**Example — store and retrieve a listing:**
```javascript
// Store
await ctx.memory.set(`listing.${id}`, {
  title: input.title,
  price: input.price,
  seller: ctx.caller.owner,
  status: 'active',
  createdAt: new Date().toISOString(),
});

// Retrieve
const listing = await ctx.memory.get(`listing.${id}`);

// Search all active listings
const listings = await ctx.memory.search('listing.');
const active = listings.filter(l => l.value.status === 'active');
```

#### ctx.wallet

Extensions can only debit the calling agent's own balance. Extensions cannot move funds between agents — that is handled by the core Work Queue escrow system.

| Method | Signature | Description |
|--------|-----------|-------------|
| `consume` | `consume(amount: number, reason: string): Promise<{success, error?}>` | Debit caller's balance |
| `getBalance` | `getBalance(): Promise<number>` | Read caller's morsel balance |

**Example — charge a listing fee:**
```javascript
const fee = ctx.config.listing_fee_morsels || 2;
const result = await ctx.wallet.consume(fee, 'listing-creation-fee');
if (!result.success) {
  return { error: 'INSUFFICIENT_BALANCE', message: `Need ${fee} morsels to create a listing` };
}
```

#### ctx.consent

Check or enforce consent scopes on any GAII.

| Method | Signature | Description |
|--------|-----------|-------------|
| `check` | `check(gaii: string, scope: string): Promise<boolean>` | Check if consent is granted |
| `require` | `require(gaii: string, scope: string): Promise<void>` | Throw if consent not granted |

#### ctx.trust

Read trust scores. Trust scores are system-computed and cannot be modified by extensions.

| Method | Signature | Description |
|--------|-----------|-------------|
| `getScore` | `getScore(gaii: string): Promise<number>` | Read agent's trust score |

#### ctx.caller

Information about who is calling the action. Always available, not async.

| Field | Type | Description |
|-------|------|-------------|
| `gaii` | `string` | Caller's GAII (agent identifier) |
| `owner` | `string` | Caller's owner name |
| `roles` | `string[]` | Caller's roles (`['owner']`, `['agent']`, `['operator']`) |

#### ctx.config

Extension-level configuration values. Set by the operator when installing or updating the extension.

```javascript
const feePercent = ctx.config.transaction_fee_percent || 5;
```

#### ctx.instance (multi-instance extensions)

When the extension supports multiple instances, each action receives the instance context.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Instance identifier |
| `config` | `object` | Per-instance configuration (name, visibility, categories, etc.) |

```javascript
// Check instance access
if (ctx.instance.config.visibility === 'password') {
  if (input.password !== ctx.instance.config.password) {
    return { error: 'ACCESS_DENIED', message: 'Invalid marketplace password' };
  }
}

if (ctx.instance.config.visibility === 'invite') {
  const allowed = ctx.instance.config.allowed_users || [];
  if (!allowed.includes(ctx.caller.owner)) {
    return { error: 'ACCESS_DENIED', message: 'You are not invited to this marketplace' };
  }
}
```

#### ctx.log

Logging functions. Log output appears in the node's system log prefixed with `[ext:{name}]`. Log calls do NOT count toward the API call limit.

| Method | Signature |
|--------|-----------|
| `info` | `info(msg: string, data?: object): void` |
| `warn` | `warn(msg: string, data?: object): void` |
| `error` | `error(msg: string, data?: object): void` |

## Multi-Instance Model

Some extensions (like marketplace or matching) support multiple instances — each with its own configuration, data, and users.

### How It Works

1. Operator installs the extension (one time)
2. Operator creates instances with different configurations
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
  Body: { config: { fee_percent: 10 } }

Delete instance
  DELETE /v1/extensions/{name}/instances/{instanceId}
```

### Memory Namespace Convention

All data for an instance lives under a predictable memory prefix:

```
ext:marketplace-behaviors.city-flea-market.listing.abc123
ext:marketplace-behaviors.city-flea-market.categories
ext:marketplace-behaviors.city-flea-market.config
ext:marketplace-behaviors.company-exchange.listing.def456
```

This means:
- Instances are fully isolated from each other
- Data can be queried with `ctx.memory.search('listing.')` within an instance (the runtime adds the namespace prefix automatically)
- Operators can inspect extension data via the standard Memory API using the full namespaced key

## Installation and Management

### Installing an Extension

Extensions are installed by sending the YAML manifest and JavaScript action scripts to the node:

```
POST /v1/extensions
Authorization: Bearer <operator-token>
Content-Type: application/json

{
  "manifest": "extension: \"1.0\"\nmetadata:\n  name: marketplace-behaviors\n  ...",
  "scripts": {
    "actions/purchase.js": "export default async function(ctx, input) { ... }",
    "actions/deliver.js": "export default async function(ctx, input) { ... }",
    "actions/rate.js": "export default async function(ctx, input) { ... }"
  }
}
```

The `scripts` object keys must match the `script` fields in the manifest's action definitions.

### Activating

An installed extension is inactive by default. Activate it to make its actions callable:

```
POST /v1/extensions/marketplace-behaviors/activate
Authorization: Bearer <operator-token>
```

### Updating

To update an extension's JavaScript without reinstalling:

1. Uninstall the current version: `DELETE /v1/extensions/{name}`
2. Install the new version: `POST /v1/extensions`
3. Activate: `POST /v1/extensions/{name}/activate`

Instance data is stored in the Memory API under the extension's namespace and persists across reinstalls as long as the extension name remains the same.

### Deactivating

Deactivating an extension stops all action execution but preserves the installation and all instance data:

```
POST /v1/extensions/marketplace-behaviors/deactivate
Authorization: Bearer <operator-token>
```

### Uninstalling

Removes the extension code. Instance data in memory is NOT automatically deleted.

```
DELETE /v1/extensions/marketplace-behaviors
Authorization: Bearer <operator-token>
```

### Resource Limits

Each extension declares resource limits in its manifest. The node enforces these limits and caps them at node-level maximums:

| Limit | Manifest field | Default | Node max config |
|-------|---------------|---------|-----------------|
| Memory | `limits.memory_mb` | 64 MB | `AIMEAT_EXT_MAX_MEMORY_MB` |
| CPU timeout | `limits.timeout_ms` | 5000 ms | `AIMEAT_EXT_TIMEOUT_MS` |
| API calls per action | `limits.max_api_calls` | 50 | `AIMEAT_EXT_MAX_API_CALLS` |
| Script size | N/A | N/A | `AIMEAT_EXT_MAX_CODE_SIZE_KB` (256 KB) |
| Max extensions | N/A | N/A | `AIMEAT_EXT_MAX_INSTALLED` (20) |

If an action exceeds its timeout, the V8 isolate is terminated and an `EXTENSION_TIMEOUT` error is returned. If an action exceeds its API call limit, further API calls return errors.

## Federation

Extensions can advertise capabilities to federated peers. When `federation.advertise` is `true`, the node includes the extension's capabilities in federation heartbeats.

Other nodes can discover capable peers:

```
GET /v1/federation/capabilities?need=escrow
```

This enables cross-node service discovery — a user on node A can find that node B has a marketplace with escrow support.

## Example: Marketplace Extension

The marketplace-behaviors extension demonstrates a complete purchase workflow with escrow. See `docs/extensions/marketplace-behaviors/` for the full manifest and README.

### Actions

| Action | Purpose | Core APIs Used |
|--------|---------|---------------|
| `purchase` | Buy a listing with morsel escrow | Memory (read listing, write purchase), Wallet (debit buyer), Consent |
| `deliver` | Confirm delivery, release escrow | Memory (update status), Wallet (credit seller) |
| `rate` | Rate a completed purchase (1-5 stars) | Memory (store rating), Trust (read score) |

### Purchase Flow

```
Buyer calls POST /v1/ext/marketplace-behaviors/{instanceId}/purchase
  1. Extension reads listing from memory — verifies status is 'active'
  2. Extension checks buyer consent for 'marketplace-listing' scope
  3. Extension calculates total: price + transaction_fee_percent
  4. Extension debits buyer via ctx.wallet.consume()
  5. Extension writes purchase record to memory with status 'purchased'
  6. Extension updates listing status to 'reserved'
  7. Returns { purchaseId, status: 'purchased' }

Seller calls POST /v1/ext/marketplace-behaviors/{instanceId}/deliver
  1. Extension reads purchase — verifies caller is the seller
  2. Extension releases escrow to seller (via wallet)
  3. Extension updates purchase status to 'delivered'
  4. Returns { status: 'delivered' }

Buyer calls POST /v1/ext/marketplace-behaviors/{instanceId}/rate
  1. Extension reads purchase — verifies caller is buyer, status is 'delivered'
  2. Extension stores rating in memory
  3. Extension marks purchase as 'completed'
  4. Returns { rated: true }
```

### Instance Configuration

Each marketplace instance can have different settings:

```json
{
  "id": "city-flea-market",
  "config": {
    "name": "City Flea Market",
    "visibility": "public",
    "categories": ["electronics", "furniture", "clothing", "sports", "other"],
    "fee_percent": 5,
    "listing_fee_morsels": 2
  }
}
```

```json
{
  "id": "company-exchange",
  "config": {
    "name": "Company Internal Exchange",
    "visibility": "password",
    "password": "company-secret-2026",
    "categories": ["office-supplies", "equipment", "furniture"],
    "fee_percent": 0,
    "listing_fee_morsels": 0
  }
}
```

```json
{
  "id": "premium-vendors",
  "config": {
    "name": "Premium Vendors",
    "visibility": "invite",
    "allowed_users": ["vendor-alice", "vendor-bob", "vendor-carol"],
    "categories": ["luxury", "art", "collectibles"],
    "fee_percent": 10,
    "listing_fee_morsels": 5
  }
}
```

## Example: Matching Extension

A matching extension would use the same pattern but for a different domain — connecting people based on shared interests, location, and activity.

### Actions

| Action | Purpose | Core APIs Used |
|--------|---------|---------------|
| `create-profile` | Register a matching profile | Memory (store profile), Consent (require matching scope) |
| `run-matching` | Execute matching algorithm | Memory (read all profiles, write match records) |
| `respond` | Accept or dismiss a match | Memory (update match status) |

### Instance Configuration

```json
{
  "id": "helsinki-dating",
  "config": {
    "name": "Helsinki Dating",
    "visibility": "public",
    "max_distance_km": 50,
    "match_threshold": 0.5,
    "max_suggestions": 5
  }
}
```

```json
{
  "id": "company-networking",
  "config": {
    "name": "Company Networking",
    "visibility": "invite",
    "allowed_users": ["employee1", "employee2"],
    "max_distance_km": 1000,
    "match_threshold": 0.3,
    "max_suggestions": 10
  }
}
```

## Best Practices

### Keep Actions Small

Each action should do one thing. A marketplace needs `create-listing`, `purchase`, `deliver`, `rate` as separate actions — not one monolithic `marketplace-operation` action. This makes actions independently discoverable, testable, and composable.

### Use Memory for All State

Do not try to maintain state inside the extension code. The V8 isolate is created fresh for each action invocation. All state must be stored in and read from memory.

```javascript
// WRONG — state is lost between invocations
let counter = 0;
export default async function(ctx, input) {
  counter++; // Always 1
}

// RIGHT — state persists in memory
export default async function(ctx, input) {
  const counter = (await ctx.memory.get('counter')) || 0;
  await ctx.memory.set('counter', counter + 1);
}
```

### Validate Input Early

Check required fields, types, and business rules at the top of your action before making any state changes:

```javascript
export default async function(ctx, input) {
  // Validate input
  if (!input.listingId) {
    return { error: 'INVALID_INPUT', message: 'listingId is required' };
  }

  // Validate state
  const listing = await ctx.memory.get(`listing.${input.listingId}`);
  if (!listing) {
    return { error: 'NOT_FOUND', message: 'Listing not found' };
  }
  if (listing.status !== 'active') {
    return { error: 'INVALID_STATE', message: 'Listing is not available for purchase' };
  }

  // Now proceed with the action...
}
```

### Return Structured Errors

Return error objects with `error` (code) and `message` (human-readable) fields. Do not throw exceptions for expected business errors — throw only for unexpected failures.

```javascript
// Business error — return it
return { error: 'INSUFFICIENT_BALANCE', message: 'Need 50 morsels, have 30' };

// Unexpected error — let it throw (the runtime catches and returns EXTENSION_ERROR)
const data = JSON.parse(invalidJson); // throws TypeError
```

### Respect the API Call Limit

Each action has a limited number of API calls (default: 50). Plan your memory access patterns to minimize calls:

```javascript
// INEFFICIENT — N+1 API calls
const listings = await ctx.memory.search('listing.');
for (const l of listings) {
  const detail = await ctx.memory.get(l.key); // N more calls
}

// EFFICIENT — search already returns values
const listings = await ctx.memory.search('listing.');
// listings already contains [{ key, value }]
```

### Use Logging for Debugging

Log calls do not count toward the API limit. Use them to trace action execution:

```javascript
ctx.log.info('Purchase started', { listingId: input.listingId, buyer: ctx.caller.owner });
// ... business logic ...
ctx.log.info('Purchase completed', { purchaseId, total: totalCost });
```

## Distributing Extensions

Extensions are distributed as a bundle containing:

1. `extension.yaml` — the manifest
2. `actions/*.js` — the action scripts
3. `README.md` — documentation

Share via GitHub, npm, or any file hosting. The node operator downloads the bundle, reads the manifest and scripts, and POSTs them to `POST /v1/extensions`.

There is no automatic package manager. This is intentional — operators should review extension code before installing it on their node.

## File Storage for Extensions

Extensions that need to handle files (e.g., listing images in a marketplace) should use the existing core **Storage/Files API** (`POST /v1/storage`). The extension itself does not need file access — clients upload files through the Storage API directly and pass the storage keys or URLs to extension actions.

**Example — listing with images:**

```javascript
// Client-side flow:
// 1. Upload image:  POST /v1/storage  →  returns storage key
// 2. Create listing: POST /v1/ext/marketplace-behaviors/{instanceId}/create-listing
//    Body: { title: "...", images: ["storage-key-1", "storage-key-2"] }

// Extension action just stores the references:
export default async function(ctx, input) {
  await ctx.memory.set(`listing.${id}`, {
    title: input.title,
    images: input.images,   // Storage keys — not file data
    // ...
  });
}
```

The Storage API supports raw body uploads, base64, visibility controls (`private`, `owner`, `public`), per-file size limits, total quota per agent, and chunked uploads for large files.

## Scheduled Actions

Extensions can declare recurring jobs in their manifest. The AIMEAT core scheduler reads these and runs them automatically on the specified cron schedule.

```yaml
schedules:
  - id: run-matching
    action: run-matching
    cron: "0 */6 * * *"          # Every 6 hours
    description: "Run matching algorithm"
    instance_scope: true          # Runs once per instance
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique schedule identifier within the extension |
| `action` | Yes | Action ID to invoke |
| `cron` | Yes | Cron expression (standard 5-field format) |
| `description` | No | Human-readable description |
| `instance_scope` | No | If `true`, creates one job per instance. Default: `false` |
| `input` | No | Static input payload to pass to the action |

When `instance_scope` is `true`, the scheduler automatically creates a job for each instance and cleans up when instances are deleted. Operators can view, enable/disable, and manually trigger scheduled jobs from the admin dashboard.
