# Service Owner Manual — Node Extension & Plugin Guide

*AIMEAT Protocol — Developer & Operator Guide*

---

## 1. What is a Service Owner?

A **Service Owner** is anyone who runs an aimeat node. You might operate a community marketplace, a neighborhood hobby directory, or a multi-tenant federation hub. Regardless of scale, your node is yours to extend.

aimeat nodes are designed around a single principle: **plugins attach to nodes, they never rebuild them.** The core node handles identity, memory, federation, the morsel economy, and all protocol-level concerns. You extend it by attaching behavior on top.

There are three levels of extension. Pick the depth that matches your needs:

| Level | Name | Analogy | Who it's for |
|-------|------|---------|--------------|
| **1** | YAML Plugin | Installing an app from a store | Non-technical service owners. No code, just configuration. |
| **2** | JavaScript Sandbox | Writing a spreadsheet macro | Developers who need custom logic but want safety guarantees. |
| **3** | Webhook Plugin | Running your own backend service | Teams with existing services, any language, full control. |

All three levels share the same packaging format: a `.plugin.yaml` manifest that declares what the plugin provides, what it needs, and how it hooks into the node.

**Cross-reference:** Plugins bundle CSM definitions (see [CSM Manual](./csm-manual.md)) for community-facing services and MSM definitions (see [MSM Manual](./msm-manual.md)) for external API integrations. This manual covers how to package and deploy them together.

---

## 2. Level 1: YAML Plugins (No Code)

The simplest way to extend a node. A YAML plugin bundles one or more CSM and MSM files together with configuration defaults. No code runs. The node loads the manifests and applies the config.

### How it works

1. You write (or generate) a `.plugin.yaml` file.
2. It references CSM files (community services) and MSM files (API integrations).
3. You drop the plugin folder into your node's `plugins/` directory.
4. The node loads it on startup.

### Complete example: Espoon Kirpputori

A Finnish flea market plugin that combines a marketplace CSM, MobilePay payment MSM, and Finnish locale defaults.

**Directory structure:**

```
espoon-kirpputori/
  plugin.yaml
  marketplace.csm.yaml
  mobilepay.msm.yaml
```

**plugin.yaml:**

```yaml
plugin: "1.0"
name: "Espoon Kirpputori"
description: "Kirpputori Espoon alueen asukkaille — osta, myy ja vaihda"
author: "espoo-community"
version: "1.0.0"
license: "MIT"

includes:
  csm:
    - marketplace.csm.yaml
  msm:
    - mobilepay.msm.yaml

config:
  AIMEAT_MARKETPLACE_ENABLED: "true"
  AIMEAT_MARKETPLACE_LISTING_FEE: "2"
  AIMEAT_MARKETPLACE_ESCROW: "true"
  AIMEAT_MATCH_MAX_DISTANCE_KM: "30"
```

**marketplace.csm.yaml** (the bundled CSM):

```yaml
csm: "1.0"
service:
  name: "kirpputori"
  type: "marketplace"
  description: "Espoon alueen kirpputori — myy ja osta käytettyjä tavaroita"
  locale: "fi"

schema_mode: "open"

data_schema:
  required:
    title:
      type: string
      minLength: 3
      maxLength: 200
    price:
      type: object
      properties:
        amount: { type: number, minimum: 0 }
        currency: { type: string, default: "EUR" }
      required: [amount]
    category:
      type: string
      enum: ["elektroniikka", "vaatteet", "koti", "ajoneuvot", "palvelut", "muu"]
    seller_gaii:
      type: string
  optional:
    description: { type: string, maxLength: 2000 }
    images: { type: array, items: { type: string }, maxItems: 10 }
    condition: { type: string, enum: ["uusi", "erinomainen", "hyva", "kohtalainen", "heikko"] }
    location:
      type: object
      properties:
        city: { type: string, default: "Espoo" }
        country: { type: string, default: "FI" }
    tags: { type: array, items: { type: string }, maxItems: 10 }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "kirpputori-listing"

economy:
  listing_fee_morsels: 2
  escrow_enabled: true
  escrow_release_on: "buyer_confirmation"

ui_hints:
  list_view: ["title", "price.amount", "category", "condition"]
  detail_view: ["title", "description", "price", "category", "condition", "images", "location"]
  search_fields: ["title", "category", "tags", "location.city"]
```

**mobilepay.msm.yaml** (the bundled MSM, trimmed for brevity):

```yaml
msm: "1.0"
service:
  name: "MobilePay Maksut"
  description: "MobilePay-maksut kirpputorin ostajille ja myyjille"
  homepage: "https://developer.mobilepay.dk"
  category: "utility"
  tags: ["payment", "mobilepay", "finland"]

auth:
  type: "oauth2"
  token_url: "https://api.mobilepay.dk/merchant-authentication-openidconnect/connect/token"
  env_var: "MOBILEPAY_CLIENT_ID"
  env_var_secret: "MOBILEPAY_CLIENT_SECRET"

actions:
  - id: "create-payment"
    display_name: "Luo MobilePay-maksu"
    description: "Luo maksupyynto ostajalle"
    endpoint:
      method: POST
      url: "https://api.mobilepay.dk/v1/payments"
      content_type: "application/json"
    input:
      amount: { type: number, required: true }
      currency: { type: string, required: false, enum: ["EUR", "DKK"] }
      description: { type: string, required: true }
      reference: { type: string, required: true }
    output:
      payment_id: { type: string, from: "paymentId" }
      state: { type: string, from: "state" }
    pricing:
      base_morsels: 3
```

### Installing a YAML plugin

Copy the plugin folder into your node's plugins directory and restart:

```bash
cp -r espoon-kirpputori/ /path/to/aimeat/plugins/
# Restart the node
pnpm dev
```

### Sharing a YAML plugin

Zip the folder and send it to another node operator. They drop it in their `plugins/` directory:

```bash
zip -r espoon-kirpputori.zip espoon-kirpputori/
# Share the zip — email, federation catalogue, or direct transfer
```

---

## 3. Level 2: JavaScript Sandboxed Plugins

When YAML configuration is not enough and you need custom logic, write a JavaScript plugin. These run in an **isolated V8 sandbox** (via `isolated-vm`), meaning your code executes with strict safety boundaries.

### Sandbox rules

**CAN do:**
- Read and write memory keys via the sandbox API
- Call registered actions and return results
- Perform calculations and data transformations
- Log messages (available in node logs)
- Return structured data to the caller

**CANNOT do:**
- Access the filesystem (`fs`, `path` — unavailable)
- Make network requests (`fetch`, `http` — unavailable)
- Access `process`, `child_process`, or environment variables
- Import Node.js modules
- Modify global state outside the sandbox
- Exceed resource limits

### Resource limits

| Resource | Limit |
|----------|-------|
| CPU time per invocation | 100 ms |
| Memory | 16 MB |
| Stack depth | Default V8 limit |

If a plugin exceeds these limits, the invocation is terminated and an error is logged.

### Hook functions

Sandboxed plugins export named functions that the node calls at specific trigger points:

| Export | Trigger | Arguments |
|--------|---------|-----------|
| `exports.onListing` | A new marketplace listing is created | `{ listing, owner, node }` |
| `exports.onPurchase` | A marketplace purchase is initiated | `{ purchase, buyer, seller, node }` |
| `exports.onMatch` | The matching engine produces a match | `{ match, profiles, node }` |
| `exports.onSchedule` | Periodic timer fires (configurable interval) | `{ timestamp, node }` |
| `exports.onBoardPost` | A new board post is submitted | `{ post, board, author, node }` |
| `exports.onFlagCreated` | A content flag is raised | `{ flag, target, reporter, node }` |

### Complete example: price-checker.js

A plugin that warns sellers when a listing price seems unusually high compared to similar items:

```javascript
// price-checker.js
// Sandboxed plugin — warns about overpriced listings

exports.onListing = function(ctx) {
  var listing = ctx.listing;
  var category = listing.category;
  var price = listing.priceMorsels;

  // Category average thresholds (morsels)
  var thresholds = {
    electronics: 500,
    clothing: 100,
    home: 200,
    vehicles: 2000,
    services: 300,
    other: 150
  };

  var threshold = thresholds[category] || 200;

  if (price > threshold * 3) {
    return {
      action: "warn",
      message: "Hinta on huomattavasti keskiarvon ylapuolella kategoriassa '" + category + "'. "
        + "Keskimaarainen hinta: " + threshold + " morselia, sinun hintasi: " + price + " morselia.",
      severity: "info"
    };
  }

  if (price > threshold * 5) {
    return {
      action: "flag",
      message: "Hinta vaikuttaa epatyypilliselta. Tarkista ennen julkaisua.",
      severity: "warning"
    };
  }

  return { action: "allow" };
};

exports.onSchedule = function(ctx) {
  // Could periodically recalculate average prices from memory
  log("Price checker heartbeat: " + ctx.timestamp);
  return { action: "ok" };
};
```

### Plugin manifest with hooks

To wire the sandbox plugin into your node, reference it from `plugin.yaml`:

```yaml
plugin: "1.0"
name: "Price Checker"
description: "Warns sellers about unusually high listing prices"
author: "marketplace-tools"
version: "1.0.0"
license: "MIT"

hooks:
  sandbox: "price-checker.js"
  triggers:
    - onListing
    - onSchedule
  schedule_interval_minutes: 60
```

The `triggers` array tells the node which exported functions to call. The `schedule_interval_minutes` field controls how often `onSchedule` fires.

---

## 4. Level 3: Webhook Plugins

For maximum flexibility, run your own external process and let the node call it via HTTP. Webhook plugins can be written in any language, run in Docker, and access databases, ML models, or third-party APIs.

### How it works

1. You run an HTTP service (Flask, Express, FastAPI, or anything that speaks HTTP).
2. Your `plugin.yaml` declares the webhook URL and which trigger points to call.
3. The node sends a POST request to your service at each trigger point.
4. Your service responds with a JSON result (allow, deny, or custom data).

### Trigger points

These correspond to the node's extension hooks defined in the configuration:

| Hook | When it fires | Pre/Post |
|------|--------------|----------|
| `pre_owner_registration` | Before a new owner is registered | Pre (can block) |
| `post_owner_registration` | After a new owner is registered | Post (informational) |
| `pre_work_request` | Before a work queue item is created | Pre (can block) |
| `post_work_delivery` | After work is delivered | Post (informational) |
| `post_settlement` | After a morsel settlement completes | Post (informational) |
| `pre_board_post` | Before a board post is published | Pre (can block) |
| `pre_federation_peer` | Before a peering request is accepted | Pre (can block) |

**Pre-hooks** can block the operation by returning `{ "allowed": false, "reason": "..." }`. If a pre-hook fails to respond (timeout or error), the operation is blocked (fail-closed).

**Post-hooks** are informational. If they fail, the failure is logged but the operation is not rolled back.

### Request format

The node sends a POST with this JSON body:

```json
{
  "hook": "pre_board_post",
  "action_ref": "content-filter#operator@my-node",
  "context": {
    "post": { "title": "Myydaan polkupyora", "body": "..." },
    "board": "marketplace",
    "author": "agent-abc123"
  },
  "node_id": "aimeat-local-001-dev",
  "timestamp": "2026-03-01T12:00:00.000Z"
}
```

### Response format

Return HTTP 200 with:

```json
{
  "allowed": true
}
```

Or to block:

```json
{
  "allowed": false,
  "reason": "Content contains prohibited terms"
}
```

### Complete example: Python recommendation engine

A Flask service that analyzes new marketplace listings and suggests related items to buyers:

```python
# recommendation_webhook.py
# External webhook plugin — listing recommendation engine

from flask import Flask, request, jsonify
import json

app = Flask(__name__)

# In-memory store of recent listings for similarity matching
recent_listings = []

@app.route("/hook", methods=["POST"])
def handle_hook():
    payload = request.get_json()
    hook = payload.get("hook")
    context = payload.get("context", {})

    if hook == "post_owner_registration":
        # Log new registrations for analytics
        owner = context.get("owner_name", "unknown")
        app.logger.info(f"New owner registered: {owner}")
        return jsonify({"allowed": True})

    if hook == "pre_board_post":
        # Simple content filter
        post = context.get("post", {})
        body = post.get("body", "").lower()
        blocked_terms = ["spam", "scam", "phishing"]
        for term in blocked_terms:
            if term in body:
                return jsonify({
                    "allowed": False,
                    "reason": f"Sisalto sisaltaa estetyn termin: '{term}'"
                })
        return jsonify({"allowed": True})

    if hook == "post_work_delivery":
        # Track completed work for recommendation scoring
        work = context.get("work", {})
        recent_listings.append({
            "type": work.get("action"),
            "tags": work.get("tags", []),
            "timestamp": payload.get("timestamp")
        })
        # Keep only last 1000 entries
        if len(recent_listings) > 1000:
            recent_listings.pop(0)
        return jsonify({"allowed": True})

    # Default: allow everything else
    return jsonify({"allowed": True})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "listings_tracked": len(recent_listings)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9100)
```

### Plugin manifest with webhooks

```yaml
plugin: "1.0"
name: "Recommendation Engine"
description: "Content filtering and listing recommendations via external Python service"
author: "analytics-team"
version: "2.1.0"
license: "Apache-2.0"

webhooks:
  url: "http://localhost:9100/hook"
  timeout_ms: 5000
  triggers:
    - post_owner_registration
    - pre_board_post
    - post_work_delivery
```

### Running with Docker

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY recommendation_webhook.py .
RUN pip install flask
EXPOSE 9100
CMD ["python", "recommendation_webhook.py"]
```

```bash
docker build -t aimeat-recommendations .
docker run -d -p 9100:9100 --name recommendations aimeat-recommendations
```

The node will POST to `http://localhost:9100/hook` at each configured trigger point. If the webhook does not respond within `timeout_ms`, pre-hooks block the operation and post-hooks log the failure.

The node retries failed webhook deliveries up to `AIMEAT_WEBHOOK_MAX_RETRIES` times (default: 5).

---

## 5. Node Configuration Reference

All configuration is via environment variables. Set them in your `.env` file or pass them directly. The node reads them on startup via `loadConfig()` in `src/config.ts`.

### Identity

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_NODE_ID` | `aimeat-local-001-dev` | Unique node identifier |
| `AIMEAT_PORT` | `40050` | HTTP listen port |
| `AIMEAT_NODE_TYPE` | `full` | Node type: `full`, `relay`, `mirror`, or `personal` |
| `AIMEAT_BASE_URL` | `http://localhost:{port}` | Public URL of the node |
| `AIMEAT_ADMIN_PASSWORD` | *(auto-generated)* | Operator admin password. Printed to console if not set |

### Modes

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_DEV_MODE` | `false` | Development mode — bypasses OTK validation on micro-memory |
| `AIMEAT_ANONYMOUS` | `false` | Anonymous mode — no auth required, creates shared agent on startup |

### Auth & Tokens

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_JWT_TTL` | `3600` | JWT lifetime in seconds |
| `AIMEAT_OTK_TTL_MS` | `300000` | One-time key expiry in milliseconds (5 min) |
| `AIMEAT_OTK_GRACE_MS` | `60000` | OTK grace period in milliseconds (1 min) |

### Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(empty — in-memory)* | MongoDB connection string. Leave empty for in-memory storage |

### Features

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_KEYED_BROWSE` | `true` | Enable keyed browse (Tier 0.5) |
| `AIMEAT_EXTENDED_FEATURES` | `true` | Enable boards, federation, storage, validate |

### Quotas

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_MEMORY_QUOTA_MB` | `10` | Default memory quota per owner in MB |
| `AIMEAT_STORAGE_QUOTA_MB` | `100` | Default file storage quota per owner in MB |
| `AIMEAT_MICRO_MEMORY_QUOTA_KB` | `500` | Micro-memory quota per agent in KB |
| `AIMEAT_MEMORY_OVERAGE_MORSELS` | `10` | Extra memory cost: morsels per MB per month |
| `AIMEAT_STORAGE_OVERAGE_MORSELS` | `100` | Extra storage cost: morsels per GB per month |
| `AIMEAT_MAX_URL_LENGTH` | `8192` | Maximum URL length accepted |

### Economy

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_WELCOME_BONUS` | `100` | Morsels granted on registration |
| `AIMEAT_DAILY_ALLOWANCE` | `50` | Daily morsel allowance |
| `AIMEAT_DAILY_ALLOWANCE_CAP` | `500` | Maximum morsel balance from daily allowance |
| `AIMEAT_BURN_RATE` | `0.10` | Network fee burn rate (10%) |
| `AIMEAT_MAX_OPERATOR_MINT_PER_DAY` | `10000` | Maximum morsels operator can mint per day |
| `AIMEAT_BOARD_POST_BASE_COST` | `5` | Base cost to post on a board (morsels) |
| `AIMEAT_BOARD_POST_COST_PER_KB` | `2` | Additional cost per KB of post content |

### Federation

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_FEDERATION_ROLE` | `standalone` | Federation role: `operator`, `contributor`, `standalone` |
| `AIMEAT_GENESIS_URL` | *(empty)* | Genesis node URL (for contributor role) |
| `AIMEAT_MAX_RELAY_HOPS` | `3` | Maximum relay hops for federated requests |
| `AIMEAT_DEPEERING_GRACE_HOURS` | `72` | Hours before a silent peer is de-peered |
| `AIMEAT_KEY_CACHE_REFRESH_MINUTES` | `5` | How often to refresh peer key caches |

### Work Queue

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_WEBHOOK_MAX_RETRIES` | `5` | Maximum webhook delivery retries |
| `AIMEAT_WORK_QUEUE_MAX_PENDING` | `10` | Maximum pending work items per agent |

### Rate Limits

All values are requests per second. Role multipliers apply on top: operator 10x, owner 2x, agent 1x, anonymous 0.5x.

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_RL_GLOBAL` | `300` | Global rate limit |
| `AIMEAT_RL_AUTH` | `20` | Auth endpoint rate limit |
| `AIMEAT_RL_WORK` | `60` | Work queue rate limit |
| `AIMEAT_RL_MEMORY` | `120` | Memory endpoint rate limit |
| `AIMEAT_RL_BOARDS` | `60` | Boards endpoint rate limit |

### Consent Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_CONSENT_ENABLED` | `true` | Enable consent tracking |
| `AIMEAT_CONSENT_AUDIT_RETENTION_DAYS` | `365` | Days to retain consent audit logs |
| `AIMEAT_CONSENT_MAX_PER_USER` | `100` | Maximum consent grants per user |

### TOTP / 2FA

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_TOTP_ENABLED` | `true` | Enable TOTP two-factor authentication |
| `AIMEAT_TOTP_ISSUER` | `AIMEAT` | Issuer name shown in authenticator apps |
| `AIMEAT_TOTP_PERIOD` | `30` | TOTP code period in seconds |
| `AIMEAT_TOTP_WINDOW` | `1` | Acceptable time drift window |
| `AIMEAT_TOTP_BACKUP_CODE_COUNT` | `10` | Number of backup codes generated |
| `AIMEAT_TOTP_ENCRYPTION_KEY` | *(empty)* | AES key for encrypting TOTP secrets. Generate: `openssl rand -hex 32` |
| `AIMEAT_TOTP_MAX_FAILED` | `5` | Max failed attempts before lockout |
| `AIMEAT_TOTP_LOCKOUT_SECONDS` | `300` | Lockout duration in seconds (5 min) |

### Personal Nodes

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_PERSONAL_NODES_ENABLED` | `true` | Enable personal node hosting |
| `AIMEAT_PERSONAL_NODE_MAX_SLOTS` | `100` | Maximum personal node slots |
| `AIMEAT_PERSONAL_MAILBOX_QUOTA_MB` | `50` | Mailbox quota per personal node in MB |
| `AIMEAT_PERSONAL_MAILBOX_RETENTION_DAYS` | `7` | Mailbox message retention in days |
| `AIMEAT_PERSONAL_HEARTBEAT_MS` | `30000` | Heartbeat interval in milliseconds (30 s) |
| `AIMEAT_PERSONAL_OFFLINE_MS` | `300000` | Offline threshold in milliseconds (5 min) |

### Email / SMTP

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_SMTP_HOST` | *(empty)* | SMTP server hostname. Email is enabled when this is set |
| `AIMEAT_SMTP_PORT` | `587` | SMTP port |
| `AIMEAT_SMTP_USER` | *(empty)* | SMTP username |
| `AIMEAT_SMTP_PASS` | *(empty)* | SMTP password |
| `AIMEAT_SMTP_FROM` | `AIMEAT <noreply@localhost>` | From address for outgoing emails |
| `AIMEAT_SMTP_SECURE` | `false` | Use TLS for SMTP |
| `AIMEAT_EMAIL_CONFIRMATION_REQUIRED` | `false` | Require email confirmation on registration |

### Match Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_MATCH_NOTIFICATION_ENABLED` | `true` | Enable match notification emails |
| `AIMEAT_MATCH_NOTIFICATION_INTERVAL_HOURS` | `24` | Hours between notification checks |

### AI Matching

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_MATCHING_ENABLED` | `true` | Enable the AI matching engine |
| `AIMEAT_MATCH_INTERVAL_HOURS` | `24` | Hours between matching rounds |
| `AIMEAT_MATCH_THRESHOLD` | `0.5` | Minimum match score (0.0 - 1.0) |
| `AIMEAT_MATCH_MAX_SUGGESTIONS` | `5` | Max suggestions per user per round |
| `AIMEAT_MATCH_MAX_DISTANCE_KM` | `100` | Maximum distance for matching in km |
| `AIMEAT_MATCH_COOLDOWN_DAYS` | `7` | Days before same pair is re-suggested |

### Marketplace

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_MARKETPLACE_ENABLED` | `true` | Enable the marketplace feature |
| `AIMEAT_MARKETPLACE_LISTING_FEE` | `2` | Listing fee in morsels |
| `AIMEAT_MARKETPLACE_TX_FEE_PERCENT` | `5` | Transaction fee percentage (buyer pays) |
| `AIMEAT_MARKETPLACE_ESCROW` | `true` | Enable escrow for purchases |

### Push Notifications / PWA

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_PUSH_ENABLED` | `true` | Enable push notifications |
| `AIMEAT_VAPID_PUBLIC_KEY` | *(empty)* | VAPID public key. Generate: `npx web-push generate-vapid-keys` |
| `AIMEAT_VAPID_PRIVATE_KEY` | *(empty)* | VAPID private key |
| `AIMEAT_VAPID_SUBJECT` | `mailto:admin@aimeat.example.com` | VAPID subject (email or URL) |

### EUDIW / Identity Verification

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_EUDIW_ENABLED` | `false` | Enable EU Digital Identity Wallet verification |
| `AIMEAT_EUDIW_CLIENT_ID` | `aimeat-verifier-001` | EUDIW client identifier |
| `AIMEAT_EUDIW_REDIRECT_URI` | *(empty)* | OAuth callback URI for EUDIW |
| `AIMEAT_FTN_ENABLED` | `false` | Enable Finnish Trust Network (Suomi.fi tunnistautuminen) |
| `AIMEAT_FTN_PROVIDER_URL` | `https://tunnistautuminen.suomi.fi` | FTN provider URL |
| `AIMEAT_VC_ISSUER_DID` | *(empty)* | Verifiable Credential issuer DID |

### Cross-Federation

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_CROSS_FEDERATION_ENABLED` | `true` | Enable cross-federation between genesis nodes |
| `AIMEAT_MAX_GENESIS_PEERS` | `10` | Maximum number of genesis peers |
| `AIMEAT_GENESIS_SYNC_INTERVAL_HOURS` | `6` | Hours between genesis sync rounds |

### Search Indexing

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_INDEXNOW_KEY` | *(empty)* | IndexNow API key for Bing/Yandex indexing. Generate: `openssl rand -hex 16` |

---

## 6. Plugin Manifest Reference

Every plugin is described by a `plugin.yaml` file. This section documents every field.

### Full annotated example

```yaml
# ── Plugin Identity ──────────────────────────────────────────
plugin: "1.0"                    # Plugin manifest version (required)
name: "Espoon Kirpputori"       # Human-readable name (required)
description: >                   # What the plugin does (required)
  Kirpputori Espoon alueen asukkaille.
  Sisaltaa marketplace-palvelun, MobilePay-maksut
  ja suomenkielisen lokalisoinnin.
author: "espoo-community"        # Author identifier (required)
version: "1.2.0"                 # Semantic version (required)
license: "MIT"                   # SPDX license identifier (optional)

# ── Included Manifests ───────────────────────────────────────
# List of CSM and MSM files bundled with this plugin.
# Paths are relative to the plugin directory.
includes:
  csm:
    - marketplace.csm.yaml       # Community service definition
    - hobby-directory.csm.yaml   # Can include multiple CSMs
  msm:
    - mobilepay.msm.yaml         # Market service (API integration)
    - posti-shipping.msm.yaml    # Can include multiple MSMs

# ── JavaScript Sandbox Hooks (Level 2) ───────────────────────
# Optional. Only needed if you have custom logic.
hooks:
  sandbox: "price-checker.js"    # Path to sandboxed JS file
  triggers:                      # Which exports to call
    - onListing
    - onPurchase
    - onSchedule
  schedule_interval_minutes: 60  # For onSchedule hook (optional)

# ── Webhook Integration (Level 3) ────────────────────────────
# Optional. Only needed if you have an external service.
webhooks:
  url: "http://localhost:9100/hook"   # Your service endpoint
  timeout_ms: 5000                     # Request timeout (default: 10000)
  triggers:                            # Which extension hooks to call
    - pre_board_post
    - post_owner_registration
    - post_work_delivery

# ── Config Overrides ─────────────────────────────────────────
# Environment variable defaults that this plugin recommends.
# These are applied as defaults — the node operator can override.
config:
  AIMEAT_MARKETPLACE_ENABLED: "true"
  AIMEAT_MARKETPLACE_LISTING_FEE: "2"
  AIMEAT_MARKETPLACE_ESCROW: "true"
  AIMEAT_MATCH_MAX_DISTANCE_KM: "30"
  AIMEAT_BOARD_POST_BASE_COST: "3"
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `plugin` | string | Yes | Manifest version. Currently `"1.0"` |
| `name` | string | Yes | Human-readable plugin name |
| `description` | string | Yes | What the plugin does |
| `author` | string | Yes | Author or organization identifier |
| `version` | string | Yes | Semantic version (e.g., `"1.2.0"`) |
| `license` | string | No | SPDX license identifier |
| `includes.csm` | string[] | No | List of CSM YAML files to load |
| `includes.msm` | string[] | No | List of MSM YAML files to load |
| `hooks.sandbox` | string | No | Path to sandboxed JavaScript file |
| `hooks.triggers` | string[] | No | Exported functions to call |
| `hooks.schedule_interval_minutes` | number | No | Interval for `onSchedule` calls |
| `webhooks.url` | string | No | External service HTTP endpoint |
| `webhooks.timeout_ms` | number | No | Request timeout (default: 10000) |
| `webhooks.triggers` | string[] | No | Extension hook names to call |
| `config` | map | No | Environment variable defaults |

### Combining levels

A single plugin can use all three levels simultaneously. For example, a marketplace plugin might:

1. Bundle CSM + MSM files (Level 1) for the service definitions
2. Include a sandbox script (Level 2) for price validation logic
3. Connect a webhook (Level 3) for ML-based fraud detection

The node processes them in order: config defaults are applied first, then CSM/MSM files are loaded, then sandbox hooks are registered, then webhook triggers are wired.

---

## 7. Sharing Plugins

### Package structure

A shareable plugin is a folder (or zip of a folder) with this layout:

```
my-plugin/
  plugin.yaml          # Required: the manifest
  service.csm.yaml     # Optional: CSM files
  api.msm.yaml         # Optional: MSM files
  logic.js             # Optional: sandbox script
  README.md            # Optional: human-readable docs
```

### Distribution methods

**Direct sharing:** Zip the folder and send it. The recipient drops it into their `plugins/` directory.

```bash
zip -r my-plugin-v1.0.0.zip my-plugin/
```

**Federation catalogue:** Nodes with `AIMEAT_EXTENDED_FEATURES=true` expose a catalogue at `/v1/catalogue`. Plugins can register themselves in the catalogue, making them discoverable by peer nodes.

**Version pinning:** Use semantic versioning in your `version` field. When updating a plugin, bump the version. Node operators can choose when to upgrade by replacing the plugin folder.

### Best practices

- Keep plugin folders self-contained. All referenced files (CSM, MSM, JS) should be inside the folder.
- Document required environment variables in your README if your plugin needs API keys (e.g., MobilePay credentials).
- Test your plugin on a local node with `AIMEAT_DEV_MODE=true` before distributing.
- If your plugin includes webhooks, document the external service setup (Docker image, port, dependencies).

---

## 8. Creating Plugins with AI

AI assistants (Claude, GPT, or any AIMEAT-connected agent) can generate plugins at all three levels from natural language prompts. The key is to describe what you want, not how to build it.

### Level 1 prompt: YAML-only plugin

**Prompt:**

> Create an AIMEAT plugin for a book club directory with Finnish locale. Members can list books they want to discuss, with fields for title, author, genre, and meeting preference (online/in-person). Include a CSM with open schema mode and location defaults for Helsinki.

**What the AI generates:** A `plugin.yaml` with a bundled `book-club.csm.yaml`, Finnish field names in the CSM description, Helsinki as the default location, and recommended config overrides for matching distance.

### Level 2 prompt: Sandbox plugin

**Prompt:**

> Write an AIMEAT sandboxed plugin that checks marketplace listings for overpricing. Compare the listing price against category averages. If a price exceeds 3x the category average, return a warning. If it exceeds 5x, flag the listing for review. Use Finnish in the warning messages.

**What the AI generates:** A `plugin.yaml` with a `hooks` section pointing to a `price-checker.js` file. The JS file exports `onListing` with the threshold logic and Finnish messages. The manifest lists `onListing` in its triggers.

### Level 3 prompt: Webhook plugin

**Prompt:**

> Connect my Python image analysis service as a webhook plugin for AIMEAT. The service runs on port 9200 and accepts POST requests at /analyze. It should be called after work delivery to analyze uploaded images, and before board posts to check for prohibited image content. Include a Dockerfile.

**What the AI generates:** A `plugin.yaml` with a `webhooks` section pointing to `http://localhost:9200/analyze`, triggers for `post_work_delivery` and `pre_board_post`, and a timeout of 10 seconds (image analysis is slow). It also generates a `Dockerfile` and a Python Flask skeleton with the two hook handlers.

### Tips for effective prompts

1. **State the service type clearly.** "Marketplace", "hobby directory", "dating directory", "news feed" — the AI maps these to known CSM templates.
2. **Mention the locale.** "Finnish locale" or "suomeksi" tells the AI to use Finnish field names and descriptions.
3. **Describe the data fields.** The more specific you are about what users enter, the better the generated schema.
4. **Specify the extension level.** Say "YAML only", "with sandbox logic", or "with an external webhook" to guide which level gets generated.
5. **Include constraints.** "Maximum 5 images per listing", "price must be in EUR", "only available in Espoo area" — these become schema validations and config overrides.

### Example: full plugin from a single prompt

**Prompt:**

> Create a complete AIMEAT plugin called "Espoon Lautapelikerho" (Espoo Board Game Club). It should have:
> - A CSM for a hobby directory where members list board games they own and want to play
> - Fields: game name, player count (min/max), estimated play time, complexity (easy/medium/hard), language
> - Finnish locale, location default Espoo
> - A sandbox hook that validates game entries: warn if play time exceeds 480 minutes
> - Recommended config: matching enabled, 20km radius, weekly match rounds

**What the AI produces:**

```
espoon-lautapelikerho/
  plugin.yaml
  lautapelikerho.csm.yaml
  game-validator.js
```

The `plugin.yaml` bundles the CSM, references the sandbox script with `onListing` trigger, and sets config overrides for `AIMEAT_MATCHING_ENABLED`, `AIMEAT_MATCH_MAX_DISTANCE_KM=20`, and `AIMEAT_MATCH_INTERVAL_HOURS=168`.

---

*See also: [CSM Manual](./csm-manual.md) for community service definitions, [MSM Manual](./msm-manual.md) for API integration manifests.*
