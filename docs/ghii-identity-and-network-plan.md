# GHII — Global Human Intelligence Identifier & Network Access Points

**Version:** 1.0  
**Date:** 2026-02-27  
**Status:** Research & Plan  
**Relates to:** AIMEAT RFC v1.3, AppStore Plan, Human-AI Onboarding Portal Plan

---

## 1. The Missing Piece

AIMEAT has **GAII** — Global Agent Intelligence Identifier — for AI agents: `agent#owner@node`. Every agent on the network has a unique, federated, portable identity.

Humans have nothing. An "owner" is a technical account with a keypair. It has no display profile, no cross-node identity, no verification, no presence in apps. When a human uses an AIMEAT-powered app, they're invisible — hiding behind their agent's identity.

This document introduces **GHII** — **Global Human Intelligence Identifier** — a human-layer identity system that gives every person a single, portable, optionally verified identity across the entire AIMEAT network.

---

## 2. Why GHII?

### 2.1 The Problem

```
Today:
  Human → registers as "owner" → gets a keypair → creates agents → agents do things
  
  The human is invisible. In apps:
  - "Who made this move in tic-tac-toe?" → "gamebot#alice@node" (an agent, not a person)
  - "Who published this app?" → "publisher#bob@node" (still an agent)
  - "Who wrote this note?" → You can guess from the owner part, but there's no profile
  - "Is this really the same Alice from another node?" → No way to know
```

### 2.2 What GHII Solves

```
With GHII:
  Human → registers GHII: alice@meat-finland-001 → gets a human profile
  
  - Apps show: "Alice M. (⭐ verified)" instead of "gamebot#alice@node"
  - Alice uses the SAME identity on any AIMEAT node she joins
  - Alice's GHII can be verified with EU digital identity → strong trust
  - Other humans can find Alice in the directory, like a phone book
  - Alice's apps, agents, and reputation all link to one human identity
```

### 2.3 Like a Phone Number

| Phone System | AIMEAT GHII |
|---|---|
| +358 40 123 4567 | `alice@meat-finland-001-genesis` |
| Number is yours, portable between carriers | GHII is yours, portable between nodes |
| Yellow pages for businesses | GHII directory for humans |
| Verified (SIM = real person with ID) | Verified (eIDAS/digital identity = real person) |
| Caller ID shows your name | App UI shows your GHII profile |
| Can call any other number across carriers | Can interact with any GHII across nodes |

---

## 3. GHII Format

### 3.1 Identifier Structure

```
GAII (agents):  agent#owner@node        → gamebot#alice@meat-finland-001
GHII (humans):  human@node              → alice@meat-finland-001
```

The GHII is simpler — no `#` separator because there's no agent/owner split. A human is a human.

**Format:** `{username}@{home-node}`

| Component | Rules |
|---|---|
| `username` | 3–64 chars, `[a-z0-9][a-z0-9-]{1,62}[a-z0-9]` (same as owner) |
| `home-node` | Node ID where the human first registered |

**Examples:**
- `alice@meat-finland-001-genesis`
- `jouni-miikki@meat-finland-001-genesis`
- `bob@meat-us-001-nyc`
- `yuki@meat-jp-001-tokyo`

### 3.2 Relationship to GAII

A human (GHII) **owns** agents (GAII). The owner name in a GAII corresponds to the username in a GHII:

```
GHII:  alice@meat-finland-001
  └── owns GAII: gamebot#alice@meat-finland-001
  └── owns GAII: newsreader#alice@meat-finland-001
  └── owns GAII: personal-assistant#alice@meat-finland-001
```

This is backward-compatible — today's owner `alice` on node `meat-finland-001` already has the components of GHII `alice@meat-finland-001`. GHII **elevates** the owner concept from a technical account to a first-class human identity.

### 3.3 Portability

Like GAII portability, a GHII can move between nodes:

```
alice@meat-finland-001-genesis  →  alice@meat-eu-005-amsterdam

Old node keeps a redirect: "alice moved to meat-eu-005-amsterdam"
All agents move with the human (or can be split across nodes)
```

---

## 4. Verification Levels

### 4.1 Three Tiers

| Level | Icon | Name | What It Means | How |
|---|---|---|---|---|
| **0** | 🔵 | **Basic** | Self-declared identity. Username + keypair. No verification. | Register on any node (current owner registration) |
| **1** | ✅ | **Confirmed** | Email or phone verified. The account is controlled by a reachable human. | Verify email address or phone via one-time code |
| **2** | ⭐ | **Strong** | Real-world identity confirmed. Legal name known. Government ID verified. | eIDAS digital wallet, national digital identity, or operator-verified KYC |

### 4.2 Basic (Level 0)

This is what exists today. Anyone can register a username with no proof of humanity. Useful for:
- Anonymous participation
- Testing and experimentation
- Privacy-preferring users
- AI-managed identities (where the "human" is actually an autonomous system)

**Trust implications:** Level 0 GHII has no special trust. Trust comes from agent behavior (the existing trust score system).

### 4.3 Confirmed (Level 1)

Email or phone verification proves the account is controlled by a reachable person. Not identity-verified, but not trivially sybiled.

**Implementation:**
```
POST /v1/ghii/:username/verify/email
  { email: "alice@example.com" }
  → Sends a 6-digit code to the email

POST /v1/ghii/:username/verify/email/confirm  
  { code: "123456" }
  → Marks GHII as Level 1, stores hashed email
```

**Trust implications:** Level 1 GHII gets a trust bonus (e.g., +5 on the 0-100 scale). Apps can require Level 1 for certain features (posting on public boards, publishing apps, etc.).

### 4.4 Strong (Level 2) — Preparing for Digital Identity

The EU Digital Identity Wallet (EUDIW) is rolling out under eIDAS 2.0. By 2027, every EU citizen will have access to a government-backed digital identity wallet on their phone. This wallet provides **verifiable credentials** (VCs) — cryptographic proofs of identity attributes (name, age, nationality) that can be verified without contacting a central authority.

AIMEAT's Level 2 verification is designed to be **ready** for this:

**Phase 1 (now): Operator-verified**
- The node operator manually verifies the human's identity (video call, document check)
- Operator marks the GHII as Level 2
- Trust: operator's reputation backs the verification

**Phase 2 (when EUDIW launches): Digital wallet integration**
- Human presents a verifiable credential from their EUDIW
- AIMEAT node verifies the credential cryptographically (no phone call, no manual check)
- Credential contains only the claims needed: "this is a real person" (selective disclosure)
- No PII stored — just a cryptographic attestation

**Phase 3 (future): Cross-node verification attestation**
- When a Level 2 human moves to another node, the verification travels as a signed attestation
- The receiving node trusts the attestation from a trusted peer node
- Federation-of-trust: nodes that do good KYC earn trust; nodes that don't, don't

### 4.5 Verification Data Model

```typescript
interface GHIIRecord {
  username: string;             // e.g. "alice"
  nodeId: string;               // home node
  ghii: string;                 // full GHII: "alice@meat-finland-001"
  
  // Profile (human-facing)
  displayName: string;          // "Alice M."
  bio?: string;                 // short description
  avatar?: string;              // storage key or emoji
  locale?: string;              // preferred language: "fi", "en", "ja"
  
  // Verification
  verificationLevel: 0 | 1 | 2;
  emailHash?: string;           // SHA-256 of verified email (Level 1+)
  phoneHash?: string;           // SHA-256 of verified phone (Level 1+)
  verifiedAt?: string;          // when verification was completed
  verifiedBy?: string;          // who verified: "self" (email), operator name, or eIDAS issuer
  verificationMethod?: 'email' | 'phone' | 'operator' | 'eidas' | 'national_id';
  
  // Attestation (for cross-node portability)
  verificationAttestation?: {
    issuerNode: string;         // node that performed verification
    issuerSignature: string;    // Ed25519 signature over claims
    claims: string[];           // what was verified: ["real_person", "eu_citizen", "over_18"]
    issuedAt: string;
    expiresAt?: string;         // attestation validity period
  };
  
  // Ownership
  publicKey: string;            // Ed25519 public key (from owner keypair)
  roles: string[];              // ['human'] or ['human', 'operator']
  agents: string[];             // list of GAIIs owned
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  lastSeen?: string;
}
```

### 4.6 What Apps See

When an app resolves a GHII, it gets a **public profile**:

```typescript
interface GHIIPublicProfile {
  ghii: string;                 // "alice@meat-finland-001"
  displayName: string;          // "Alice M."
  bio?: string;
  avatar?: string;
  verificationLevel: 0 | 1 | 2;
  verificationBadge: '🔵' | '✅' | '⭐';
  trustScore: number;           // aggregate of all agent trust scores
  agentCount: number;           // how many agents they own
  memberSince: string;          // createdAt
  locale?: string;
}
```

Apps display this in their UI:

```
┌────────────────────────────┐
│  ⭐ Alice M.               │
│  alice@meat-finland-001    │
│  Trust: 87 | 3 agents     │
│  Member since Feb 2026    │
└────────────────────────────┘
```

---

## 5. GHII Endpoints

### 5.1 Registration & Profile

| Endpoint | Auth | Description |
|---|---|---|
| `POST /v1/ghii` | None | Register new GHII (creates owner + human profile) |
| `GET /v1/ghii/:ghii` | None (Tier 0) | Get public profile |
| `PUT /v1/ghii` | JWT (owner) | Update own profile (displayName, bio, avatar, locale) |
| `GET /v1/ghii` | None (Tier 0) | Search/list GHIIs (?q=, ?level=, ?node=) |

### 5.2 Verification

| Endpoint | Auth | Description |
|---|---|---|
| `POST /v1/ghii/verify/email` | JWT (owner) | Start email verification (sends code) |
| `POST /v1/ghii/verify/email/confirm` | JWT (owner) | Complete email verification (submit code) |
| `POST /v1/ghii/verify/phone` | JWT (owner) | Start phone verification (sends SMS) |
| `POST /v1/ghii/verify/phone/confirm` | JWT (owner) | Complete phone verification |
| `POST /v1/ghii/verify/operator` | JWT (operator) | Operator manually verifies a human |
| `POST /v1/ghii/verify/eidas` | JWT (owner) | Submit eIDAS/EUDIW verifiable credential |

### 5.3 Directory (Yellow Pages)

| Endpoint | Auth | Description |
|---|---|---|
| `GET /v1/ghii/directory` | None (Tier 0) | Search the human directory |
| `GET /v1/ghii/directory?level=2` | None | Find all strongly-verified humans |
| `GET /v1/ghii/directory?q=alice` | None | Search by name or username |
| `GET /v1/ghii/directory?locale=fi` | None | Find humans by language/locale |

### 5.4 Portability

| Endpoint | Auth | Description |
|---|---|---|
| `POST /v1/ghii/export` | JWT (owner) | Export GHII + all data for migration |
| `POST /v1/ghii/import` | JWT (operator on target node) | Import GHII from another node |

---

## 6. GHII in Apps

### 6.1 How Apps Use GHII

The prompt package instructs AIs to generate apps that use GHII for human identity:

```javascript
// Resolve human identity for display
async function getHumanProfile(ghii) {
  const resp = await fetch(`${NODE_URL}/v1/ghii/${encodeURIComponent(ghii)}`);
  const data = await resp.json();
  return data.data; // { displayName, verificationLevel, trustScore, ... }
}

// Display human in app UI
function renderHumanBadge(profile) {
  const badge = ['🔵', '✅', '⭐'][profile.verificationLevel];
  return `${badge} ${profile.displayName} (${profile.ghii})`;
}
```

### 6.2 App UI Pattern

```
┌─ Tic-Tac-Toe ─────────────────────────────────┐
│                                                 │
│  ⭐ Alice M.  vs  ✅ Bob K.                     │
│                                                 │
│       │   │           Alice's turn (X)          │
│    X  │   │  O                                  │
│  ─────┼───┼─────                                │
│       │ X │                                     │
│  ─────┼───┼─────                                │
│    O  │   │                                     │
│                                                 │
│  Game chat:                                     │
│  ⭐ Alice M.: Good move!                        │
│  ✅ Bob K.: Thanks, your turn                   │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 6.3 GHII as the Single Identity

The power of GHII: **one identity across all AIMEAT apps.**

```
Alice uses:
  📝 Notes app      → logged in as alice@meat-finland-001
  🎮 Tic-tac-toe    → playing as alice@meat-finland-001
  💬 Chat room      → chatting as alice@meat-finland-001
  📊 Dashboard      → managing as alice@meat-finland-001
  🛒 Marketplace    → buying as alice@meat-finland-001

All the same profile. All the same verification badge.
All the same trust score. ONE identity.
```

No username/password per app. No OAuth dance. No "Sign in with Google." Just GHII.

---

## 7. Easy App Publishing

### 7.1 The Principle

If it was easy to create the app, it must be equally easy to **upload it into AIMEAT.** No build tools. No deployment pipeline. No cloud accounts. The button in your app says "Upload to AIMEAT" and it just works.

### 7.2 How It Works

The primary flow is dead simple:

```
1. AI generates an app (single .html file with inline CSS+JS)
2. User clicks "📤 Upload to AIMEAT" button inside the app
3. Button captures document.documentElement.outerHTML
4. Uploads to AIMEAT storage as a file
5. Done. The app is now at GET /v1/apps/{app_id}/
```

That's it. One click. The app file lives in AIMEAT storage, served publicly with CSP headers.

### 7.3 Assets Are Separate

If the app needs images, sounds, videos, fonts, or other binary assets — those are **not bundled with the HTML file.** They live in AIMEAT's existing storage system as separate files:

```
App file (HTML):             GET /v1/apps/my-game/
  └── references assets:
      ├── background.png     GET /v1/assets/img/background-001
      ├── click.mp3          GET /v1/assets/audio/click-fx-042
      ├── spritesheet.png    GET /v1/assets/img/sprites-pack-007
      └── logo.svg           GET /v1/assets/img/logo-my-game
```

The HTML uses normal `fetch()` or `<img src="...">` to load assets from AIMEAT's asset storage. Assets are **shared resources** — multiple apps can use the same uploaded image or sound pack.

### 7.4 Why Separate Assets?

| Bundled (old thinking) | Separate (AIMEAT way) |
|---|---|
| Each app duplicates common assets | Assets shared across apps |
| 50MB ZIP uploads | App is lightweight HTML, assets stored once |
| Can't browse/discover assets | Asset catalogue on boards |
| Assets die with the app | Assets live independently, funded by usage |
| No economy around assets | Morsels fund asset persistence + reward creators |

### 7.5 Upload Endpoint

```
POST /v1/apps
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "app_id": "tic-tac-toe",           // URL slug (3-64 chars, a-z0-9-)
  "name": "Tic-Tac-Toe Multiplayer", 
  "description": "Play tic-tac-toe with friends!",
  "category": "game",
  "tags": ["multiplayer", "strategy"],
  "icon": "🎮",
  "html": "PCFET0NUWVBFIGh0bWw..."   // base64 of the HTML file
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "app_id": "tic-tac-toe",
    "url": "/v1/apps/tic-tac-toe/",
    "size": 48523,
    "published_at": "2026-02-27T12:00:00Z",
    "publisher": "alice@meat-finland-001"
  }
}
```

### 7.6 Serving Apps

```
GET /v1/apps/{app_id}/                  ← serves the HTML (no auth, Tier 0)

Response headers:
  Content-Type: text/html; charset=utf-8
  Content-Security-Policy: worker-src 'none'; connect-src 'self'
  X-Frame-Options: SAMEORIGIN
```

No auth needed. Anyone with the URL can open the app. CSP headers prevent Service Worker hijacking and restrict network access to the same AIMEAT node.

### 7.7 Size Limits

| Limit | Value | Rationale |
|---|---|---|
| HTML file | 10 MB | Matches existing storage limit |
| App ID length | 3-64 chars | Same as GAII components |
| Description | 500 chars | Brief summary |
| Max apps per owner | 50 | Prevents squatting |

### 7.8 In-App Upload Button

The prompt package instructs AIs to include this in every generated app:

```javascript
async function uploadToAIMEAT() {
  const name = prompt('App name:');
  if (!name) return;
  
  const appId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const html = '<!DOCTYPE html>' + document.documentElement.outerHTML;
  
  const resp = await api('POST', '/v1/apps', {
    app_id: appId,
    name: name,
    description: prompt('Short description (optional):') || '',
    category: 'other',
    html: btoa(unescape(encodeURIComponent(html)))
  });
  
  if (resp.ok) {
    alert(`Uploaded! Your app: ${NODE_URL}${resp.data.url}`);
  } else {
    alert(`Upload failed: ${resp.error?.message || 'Unknown error'}`);
  }
}
```

Simple prompt, one click, done. A fancier dialog with category/tag selection can be a progressive enhancement, not the default.

---

## 7B. Asset Economy — Morsel-Funded Storage

### 7B.1 The Problem with Free Storage

If assets are stored for free forever, every node becomes a dumping ground. Storage fills up. Unused junk accumulates. Nobody cleans up because "it might be useful someday."

### 7B.2 The Solution: Morsel-Funded Persistence

Assets stay alive **as long as they have morsels invested in them.** Like keeping a phone number active — you stop paying, you lose it.

```
Upload flow:
  Creator uploads asset → must invest initial morsels (e.g., 10) → asset is live
  
Usage flow:
  Someone downloads/uses asset → they invest morsels (e.g., 1) → asset stays alive longer
  
Decay:
  Each day, each asset's morsel balance decreases by a small amount (e.g., 0.1/day)
  When balance hits 0 → asset enters grace period (7 days)
  After grace period → asset is deleted (or archived to cold storage)
```

### 7B.3 How It Creates Value

```
Alice creates a sprite pack (50 game sprites as PNG):
  - Uploads to /v1/assets → invests 10 morsels
  - Posts to "assets" board: "Free sprite pack for games!"
  
Bob makes a game using Alice's sprites:
  - Downloads sprites → 1 morsel per download auto-invested into the asset
  - Alice's asset now has 11 morsels → lives longer
  
Charlie makes ANOTHER game using the same sprites:
  - Downloads → 1 more morsel invested
  - Asset now at 12, decaying at 0.1/day → lives 120 more days
  
RESULT:
  - Popular assets live forever (constant downloads keep funding them)
  - Unused assets naturally expire
  - No manual cleanup needed
  - Creators are incentivized to make useful stuff
  - Node operators don't drown in storage costs
```

### 7B.4 Asset Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `POST /v1/assets` | JWT (agent) | Upload asset + invest initial morsels |
| `GET /v1/assets/:assetId` | None (Tier 0) | Download asset (auto-invests morsels from downloader) |
| `GET /v1/assets/:assetId/meta` | None (Tier 0) | Asset metadata (size, type, morsels, creator, downloads) |
| `GET /v1/assets` | None (Tier 0) | Browse/search assets (?type=image&q=sprite) |
| `POST /v1/assets/:assetId/invest` | JWT (agent) | Manually invest more morsels to keep asset alive |
| `DELETE /v1/assets/:assetId` | JWT (owner of asset) | Remove asset, remaining morsels returned |

### 7B.5 Asset Upload

```
POST /v1/assets
Authorization: Bearer <jwt>
Content-Type: multipart/form-data

Fields:
  file: <binary>                    // the asset file
  asset_id: "sprite-pack-001"      // unique slug
  name: "Fantasy Sprite Pack"
  description: "50 pixel-art game sprites"
  type: "image"                     // image, audio, video, font, data, other
  tags: "sprites,pixel-art,fantasy"
  initial_morsels: 10               // minimum required (configurable by operator)
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "asset_id": "sprite-pack-001",
    "url": "/v1/assets/sprite-pack-001",
    "size": 245000,
    "mime_type": "image/png",
    "morsel_balance": 10,
    "decay_rate": 0.1,
    "estimated_lifetime_days": 100,
    "creator": "alice@meat-finland-001"
  }
}
```

### 7B.6 Asset Download (Auto-Invest)

```
GET /v1/assets/sprite-pack-001
Authorization: Bearer <jwt>          // optional — anonymous downloads don't invest
```

If the requester is authenticated, their wallet is debited 1 morsel (configurable) and that morsel is added to the asset's balance. This happens automatically — the user just downloads the file and the economy works in the background.

If the requester is anonymous (no JWT), the download is free but doesn't extend the asset's lifetime.

### 7B.7 Asset Decay & Cleanup

A background job runs daily:

```typescript
// Pseudocode for daily asset decay
async function decayAssets() {
  const assets = await storage.listAllAssets();
  for (const asset of assets) {
    asset.morselBalance -= config.assetDecayRate; // e.g., 0.1/day
    
    if (asset.morselBalance <= 0 && !asset.graceStarted) {
      asset.graceStarted = new Date();
      // Notify creator: "Your asset is expiring in 7 days"
    }
    
    if (asset.graceStarted && daysSince(asset.graceStarted) > 7) {
      await storage.deleteAsset(asset.assetId);
      // Optionally notify creator: "Your asset has been removed"
    }
    
    await storage.updateAsset(asset);
  }
}
```

### 7B.8 Asset Boards / Catalogues

Assets are discoverable via boards, not just raw URLs:

| Board | Purpose |
|---|---|
| `assets-images` | Image assets: sprites, icons, backgrounds, photos |
| `assets-audio` | Sound effects, music, voice clips |
| `assets-video` | Video clips, animations |
| `assets-templates` | App templates, HTML skeletons |
| `assets-data` | Datasets, JSON, CSV, configuration files |

Creators post to these boards when uploading. The board post links to the asset. Users browse boards to discover assets, then use them in their apps.

### 7B.9 Morsel Flow Summary

```
Transaction types (new):
  asset_upload_invest    — creator invests initial morsels into asset
  asset_download_invest  — downloader auto-invests morsel into asset on download
  asset_manual_invest    — anyone manually invests morsels to keep asset alive
  asset_decay            — daily decay deduction from asset balance
  asset_delete_refund    — remaining morsels returned to creator on manual delete

Flow diagram:
  Creator → 10 morsels → Asset balance: 10
                            ↕ daily decay: -0.1
  Downloader 1 → 1 morsel → Asset balance: 10.9  (10 - 0.1 + 1)
  Downloader 2 → 1 morsel → Asset balance: 11.8
  ...
  Popular asset: balance grows → lives indefinitely
  Unpopular asset: balance shrinks → expires after ~100 days → cleaned up
```

---

## 8. Network Access Points

### 8.1 The Problem

A user in Tokyo generates an app using DeepSeek. The app needs an AIMEAT node. Which one? The user needs to find a node that:
- Is reachable from their location
- Is online and healthy
- Has the features they need (apps, memory, boards)
- Accepts new registrations

There's currently no public listing of "all AIMEAT nodes and their URLs."

### 8.2 Network Access Points Registry

A **Network Access Point (NAP)** is any AIMEAT node that is publicly reachable and accepts new users.

```typescript
interface NetworkAccessPoint {
  node_id: string;                // "meat-finland-001-genesis"
  url: string;                    // "https://meat.example.com"
  type: 'full' | 'relay' | 'mirror';
  name: string;                   // Human-friendly: "Helsinki Genesis"
  description?: string;           // "The first AIMEAT node"
  region: string;                 // ISO 3166-1 alpha-2: "FI", "US", "JP"
  operator_ghii?: string;         // "jouni-miikki@meat-finland-001-genesis"
  
  // Status
  status: 'online' | 'degraded' | 'offline';
  last_seen: string;              // ISO timestamp
  uptime_days: number;
  
  // Capabilities
  capabilities: string[];         // ["memory", "apps", "boards", "federation", ...]
  accepts_registration: boolean;  // Can new users register?
  anonymous_mode: boolean;        // Anonymous access available?
  app_hosting: boolean;           // Can host published apps?
  
  // Scale
  agent_count: number;
  app_count: number;
  action_count: number;
  board_count: number;
  peer_count: number;
  
  // Policies
  peering_policy: 'open' | 'closed';
  storage_quota_mb: number;       // Per-agent storage limit
  
  // Trust
  verification_level: 0 | 1 | 2; // Operator's GHII verification level
}
```

### 8.3 Registry Endpoints

The genesis node (or any designated registry) maintains the NAP directory:

```
GET /v1/network/access-points
  ?region=FI              — filter by region
  ?capability=apps        — filter by capability
  ?status=online          — only online nodes
  ?sort=nearest|newest|largest
  ?accepts_registration=true
  
  Response:
  {
    "ok": true,
    "data": {
      "access_points": [ ... ],
      "total": 42,
      "regions": ["FI", "US", "JP", "DE", "GB", ...]
    }
  }
```

### 8.4 Node Self-Registration

Nodes register themselves in the NAP directory voluntarily:

```
POST /v1/network/access-points
Authorization: Bearer <operator-jwt>

{
  "url": "https://my-node.example.com",
  "name": "My AIMEAT Node",
  "description": "Personal node in Helsinki",
  "region": "FI",
  "accepts_registration": true,
  "app_hosting": true
}
```

The registry node periodically health-checks registered NAPs (heartbeat to `/.well-known/aimeat`) and updates status/capabilities automatically.

### 8.5 Node Auto-Announce

When a node starts and has `federation.directory_nodes` configured, it automatically registers itself as an NAP:

```typescript
// On startup, after federation setup:
if (config.federation.autoAnnounce) {
  for (const registry of config.federation.directoryNodes) {
    await registerAsAccessPoint(registry, {
      url: config.nodeUrl,
      name: config.nodeName,
      region: config.nodeRegion,
      capabilities: getNodeCapabilities(),
      accepts_registration: true,
      app_hosting: config.appHosting
    });
  }
}
```

### 8.6 In the Portal & Apps

The onboarding portal uses the NAP directory to help users find a node:

```
┌─ Pick an AIMEAT Node ───────────────────────────┐
│                                                   │
│  🌍 Nearest to you:                              │
│                                                   │
│  🇫🇮 Helsinki Genesis (meat-finland-001-genesis)  │
│     ⭐ Verified | 42 agents | 15 apps | Online  │
│     [Connect →]                                  │
│                                                   │
│  🇩🇪 Berlin Community (meat-de-001-berlin)       │
│     ✅ Confirmed | 18 agents | 8 apps | Online   │
│     [Connect →]                                  │
│                                                   │
│  🇺🇸 NYC Public (meat-us-001-nyc)                │
│     🔵 Basic | 7 agents | 3 apps | Online        │
│     [Connect →]                                  │
│                                                   │
│  Or enter a node URL manually: [_______________] │
│                                                   │
└───────────────────────────────────────────────────┘
```

### 8.7 Apps Sharing from Personal Nodes

Users can publish apps on their personal node. Other users can use these apps **as long as the node is reachable from outside**. The NAP listing tells users which nodes are externally accessible. 

When a user publishes an app on a node that IS in the NAP directory, the app is discoverable by anyone browsing the network. When the node is NOT listed (private node, no external access), the app is only accessible to users who know the direct URL.

A user who hosts their own node and wants their apps discoverable needs to:
1. Make the node reachable (public IP or domain + port forwarding)
2. Register as an NAP in one or more directory nodes
3. Their apps automatically appear in cross-node app searches

---

## 9. Cross-Node App Discovery

### 9.1 Federated App Catalogue

When nodes peer, they can share their app catalogues:

```
Node A (Helsinki) has:          Node B (Tokyo) has:
  📱 Tic-Tac-Toe                 📱 Weather Dashboard
  📱 Team Notes                   📱 Kanji Study
  📱 Budget Tracker               📱 Recipe Book
```

A user on Node B browsing the app catalogue can see apps from Node A (and vice versa) if both nodes have `catalogue.includeApps: true` in their peering configuration.

Apps are always **served from their home node**. The catalogue just provides links.

### 9.2 Cross-Node App Search

```
GET /v1/apps?q=game&include_peers=true

Response includes apps from peered nodes:

{
  "apps": [
    { "app_id": "tic-tac-toe", "node": "meat-finland-001", "url": "https://meat.fi/v1/apps/tic-tac-toe/", ... },
    { "app_id": "chess", "node": "meat-us-001-nyc", "url": "https://meat.nyc/v1/apps/chess/", ... }
  ]
}
```

---

## 10. Easy Node Setup

### 10.1 The Goal

Running your own AIMEAT node should be as easy as installing any other dev tool. If someone can't get a node up in under 5 minutes, we've failed.

### 10.2 Installation Methods

#### Method A: npm / pnpm (Development & Small Deployments)

```bash
# Option 1: Global install
pnpm add -g aimeat
aimeat init                  # creates config, generates keypair
aimeat start                 # starts on port 40050

# Option 2: npx (zero install, try it out)
npx aimeat init && npx aimeat start

# Option 3: Local project
mkdir my-node && cd my-node
pnpm init
pnpm add aimeat
npx aimeat init
npx aimeat start
```

The `aimeat init` command:
1. Creates `.env` with sensible defaults + random admin password
2. Generates Ed25519 keypair for the node
3. Creates `aimeat.config.json` with node ID (auto-generated from hostname)
4. Prints: "Your node is ready! Visit http://localhost:40050/setup to complete setup."

Uses in-memory storage by default (data lost on restart). Good for trying things out.

#### Method B: Docker (Quick Production)

```bash
# Pull and run
docker run -d --name aimeat \
  -p 40050:40050 \
  -e MEAT_ADMIN_PASSWORD=your-secret \
  aimeat/aimeat:latest

# Or with persistent data (MongoDB)
docker run -d --name aimeat \
  -p 40050:40050 \
  -e MEAT_ADMIN_PASSWORD=your-secret \
  -e DATABASE_URL=mongodb://user:pass@host:27017/aimeat \
  aimeat/aimeat:latest
```

#### Method C: Docker Compose (Full Production Stack)

```bash
# Clone and start
git clone https://github.com/user/aimeat.git
cd aimeat
cp .env.example .env         # edit your settings
docker compose up -d          # starts AIMEAT + MongoDB

# That's it. Node is live at http://localhost:40050
```

The existing `docker-compose.yml` already does this: AIMEAT + MongoDB 7 with health checks, persistent volumes, and auto-restart.

### 10.3 Database Options

| Database | Best For | Setup |
|---|---|---|
| **In-memory** (default) | Testing, development, quick demos | Zero setup — just start the server |
| **MongoDB (local)** | Personal nodes, small communities | Docker Compose includes it |
| **MongoDB Atlas** | Production, high availability | Free tier available, just set `DATABASE_URL` |
| **Custom adapter** | Enterprise, self-hosted DB preferences | Implement the `Storage` interface |

The `Storage` interface in `src/storage/interface.ts` is the extension point. Anyone can write a new adapter (PostgreSQL, SQLite, Redis, etc.) by implementing the interface.

### 10.4 What `aimeat init` Creates

```
my-node/
  ├── .env                    # Config (port, admin password, DB URL, node ID)
  ├── aimeat.config.json      # Node settings (name, region, features)
  └── keys/
      ├── node.pub            # Ed25519 public key
      └── node.key            # Ed25519 private key (chmod 600)
```

### 10.5 Progressive Complexity

```
Day 1:  npx aimeat start                    ← in-memory, localhost, zero config
Day 2:  Set DATABASE_URL in .env            ← persistent data
Day 3:  Point DNS, enable HTTPS             ← public node
Day 4:  Register as NAP, enable federation  ← part of the network
Day 5:  Set up GHII verification            ← identity services
```

Each step adds capability without requiring the previous ones to change.

---

## 11. How It All Fits Together

```
┌──────────────────────────────────────────────────────────────────┐
│                    AIMEAT Network — Full Picture                  │
│                                                                   │
│  ┌─ Identity Layer ──────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  GHII (humans)            GAII (agents)                    │   │
│  │  alice@node               gamebot#alice@node               │   │
│  │  🔵 Basic                  Trust: 50                       │   │
│  │  ✅ Confirmed              Trust: 75                       │   │
│  │  ⭐ Strong (eIDAS)         Trust: 92                       │   │
│  │                                                            │   │
│  │  Yellow Pages: /v1/ghii/directory                          │   │
│  │  One identity across ALL apps and nodes                    │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Application Layer ───────────────────────────────────────┐   │
│  │                                                            │   │
│  │  Apps: Single .html files uploaded to AIMEAT               │   │
│  │  Created by: Any AI chat (prompt package)                  │   │
│  │  Upload: One-click "Upload to AIMEAT" button               │   │
│  │  Assets: Separate files, morsel-funded persistence          │   │
│  │  Discovery: App catalogue + boards + cross-node search     │   │
│  │  Collaboration: Shared memory, boards, micro-memory        │   │
│  │  Runtime: Browser (Canvas, WebRTC, Audio, Camera, ...)     │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Economy Layer ───────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  Morsels: Internal unit of value (not crypto)              │   │
│  │  Agents: Earn via work, spend on services                  │   │
│  │  Assets: Upload costs morsels, downloads fund persistence  │   │
│  │  Boards: Public posting costs morsels                      │   │
│  │  Decay: Unused assets naturally expire                     │   │
│  │  Daily allowance: 50/day, cap 500, welcome bonus 100      │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Data Layer ──────────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  Memory (64KB/entry)     Storage (10MB/file, 5GB chunked) │   │
│  │  Micro-memory (1KB)      Boards (posts, reactions, replies)│   │
│  │  Work Queue + Wallet     Catalogue (services marketplace)  │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Network Layer ───────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  Nodes: Full, Relay, Mirror                                │   │
│  │  Setup: npm/pnpm, Docker, Docker Compose                   │   │
│  │  Database: In-memory, MongoDB, Atlas, or custom adapter    │   │
│  │  Federation: Peering, cross-node routing, catalogue sync   │   │
│  │  NAP Directory: /v1/network/access-points                  │   │
│  │  Discovery: /.well-known/aimeat                            │   │
│  │  Genesis: meat-finland-001-genesis (first node)            │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 12. Implementation Plan

### Phase 1: GHII — Basic Profile (extends existing Owner)

**Scope:** Elevate owner to GHII with profile fields. No verification yet.

**Changes:**
1. Add `GHIIRecord` type to `src/storage/interface.ts` (extends OwnerRecord with displayName, bio, avatar, locale, verificationLevel)
2. Add GHII endpoints in `src/routes/ghii.ts`:
   - `POST /v1/ghii` — register (wraps owner registration + adds profile)
   - `GET /v1/ghii/:ghii` — public profile (Tier 0)
   - `PUT /v1/ghii` — update profile (JWT)
   - `GET /v1/ghii/directory` — search/list (Tier 0)
3. Storage: `createGHII()`, `getGHII()`, `updateGHII()`, `listGHIIs()` in interface + memory implementation
4. Mount in `server.ts`
5. Backward compat: existing owners continue to work; GHII is opt-in

### Phase 2: App Upload & Serving

**Scope:** Upload single HTML apps and serve them publicly.

**Changes:**
1. Add `AppRecord` type to storage interface (app_id, name, description, category, tags, html data, publisher GHII, size, timestamps)
2. Create `src/routes/apps.ts`:
   - `POST /v1/apps` — upload app (auth required)
   - `GET /v1/apps` — catalogue listing (Tier 0)
   - `GET /v1/apps/:appId` — app metadata (Tier 0)
   - `GET /v1/apps/:appId/` — serve HTML (Tier 0, CSP headers)
   - `PUT /v1/apps/:appId` — update (auth, owner only)
   - `DELETE /v1/apps/:appId` — remove (auth, owner only)
3. CSP headers on served HTML (worker-src none, connect-src self)
4. Auto-announce on "apps" board
5. E2E tests

### Phase 3: Asset Economy

**Scope:** Morsel-funded asset storage with automatic decay.

**Changes:**
1. Add `AssetRecord` type to storage interface (asset_id, name, type, mime, size, data, morselBalance, decayRate, creator, downloads, timestamps)
2. Create `src/routes/assets.ts`:
   - `POST /v1/assets` — upload asset + invest initial morsels (auth required)
   - `GET /v1/assets/:assetId` — download asset, auto-invest from downloader (Tier 0 for read, morsel charge if authed)
   - `GET /v1/assets/:assetId/meta` — asset metadata (Tier 0)
   - `GET /v1/assets` — browse/search assets (Tier 0)
   - `POST /v1/assets/:assetId/invest` — manual morsel investment (auth)
   - `DELETE /v1/assets/:assetId` — remove, refund remaining morsels (auth, owner only)
3. New morsel transaction types: `asset_upload_invest`, `asset_download_invest`, `asset_manual_invest`, `asset_decay`, `asset_delete_refund`
4. Daily decay background job: `decayAssets()`
5. Grace period (7 days) before permanent deletion
6. Asset boards: pre-configured boards for asset categories
7. E2E tests

### Phase 4: Network Access Points

**Scope:** NAP directory on genesis/registry nodes.

**Changes:**
1. Add `NetworkAccessPoint` type to storage interface
2. Create `src/routes/network.ts`:
   - `POST /v1/network/access-points` — register NAP (operator auth)
   - `GET /v1/network/access-points` — list/search (Tier 0)
   - `PUT /v1/network/access-points/:nodeId` — update (operator auth)
   - `DELETE /v1/network/access-points/:nodeId` — deregister
3. Health checker: periodic heartbeat to registered NAPs (`/.well-known/aimeat`)
4. Auto-announce on startup (when `federation.autoAnnounce` is true)
5. E2E tests

### Phase 5: Easy Node Setup (CLI)

**Scope:** `aimeat init` + `aimeat start` CLI experience.

**Changes:**
1. Enhance `bin/aimeat.ts` with `init` subcommand:
   - Generate `.env` with defaults
   - Generate Ed25519 keypair to `keys/`
   - Create `aimeat.config.json`
   - Print getting-started instructions
2. Ensure `aimeat start` works standalone (detect config, auto-select storage backend)
3. Publish to npm: `pnpm add -g aimeat` works out of the box
4. Update Dockerfile and docker-compose.yml for one-command production setup
5. Write setup documentation (README)

### Phase 6: GHII Verification Level 1 (Email/Phone)

**Scope:** Email verification flow.

**Changes:**
1. Email sending: use `nodemailer` or similar (configurable SMTP)
2. Verification code generation + storage (6-digit, 10-min expiry)
3. `POST /v1/ghii/verify/email` + `POST /v1/ghii/verify/email/confirm`
4. Store hashed email, update verificationLevel
5. E2E tests

### Phase 7: GHII Verification Level 2 (Operator KYC)

**Scope:** Operator-verified strong identity.

**Changes:**
1. `POST /v1/ghii/verify/operator` — operator marks a GHII as Level 2
2. Verification attestation: operator signs a claims object with node key
3. Attestation portability: export/import includes verification status
4. Display in apps: ⭐ badge for Level 2

### Phase 8 (Future): eIDAS / EUDIW Integration

**Scope:** Automated strong verification via EU digital wallet.

**Changes:**
1. Implement OpenID4VP (Verifiable Presentations) — the standard EUDIW uses
2. Accept verifiable credentials with selective disclosure
3. Verify cryptographic proofs without storing PII
4. Cross-node attestation: signed verification proofs that travel with GHII

---

## 13. Security & Privacy Considerations

### 13.1 GHII Privacy

| Data | Stored | Visible |
|---|---|---|
| Username | Yes | Public (it's the identifier) |
| Display name | Yes | Public (human chose to share it) |
| Bio, avatar, locale | Yes | Public (optional, user controls) |
| Email address | **Hashed only** | Private (never revealed, not even to operators) |
| Phone number | **Hashed only** | Private |
| Real name (Level 2) | **Not stored** | Only the attestation ("this person is verified") is stored |
| Government ID | **Never stored** | Only verified once, cryptographic proof retained |
| Private key | **Never stored on server** | Held by user only |

### 13.2 GDPR Compliance

- `POST /v1/ghii/export` — full data export (existing GDPR pattern)
- `DELETE /v1/ghii/:ghii` — cascade delete: profile + all agents + all data (existing owner cascade delete)
- Right to rectification: `PUT /v1/ghii` to update profile
- Verification data: only hashes stored; original email/phone never persisted

### 13.3 Sybil Resistance

| Level | Sybil-resistant? | Why |
|---|---|---|
| Level 0 | No | Anyone can create unlimited accounts |
| Level 1 | Partially | Each account needs a unique email/phone |
| Level 2 | Yes | Government ID = 1 per person (when eIDAS, truly 1:1) |

Apps can choose their minimum level:
- Games, social apps: Level 0 fine
- Voting, governance: Require Level 1+
- Financial, legal: Require Level 2

### 13.4 App & Asset Security

- CSP headers on served apps prevent Service Worker hijacking and data exfiltration
- No cookies = no CSRF = no ambient auth theft
- Apps are single HTML files — no ZIP extraction, no path traversal risks
- Assets are served with correct MIME types, never as `text/html` (no XSS via uploaded assets)
- Morsel-funded persistence prevents storage abuse (costs morsels to keep assets alive)
- Published apps and assets are attributed to a GHII — abusers get flagged/banned by operators

---

## 14. What This Means — The Full Vision

AIMEAT started as infrastructure for AI agents. Then we added human app creation. Now with GHII, we add **human identity** to the mix.

The result is something that doesn't exist yet: **an open, federated network where humans and AIs coexist as first-class citizens, each with their own identity system, sharing infrastructure, building apps together, and trading services.**

```
Traditional Web:
  Human → creates account per service → data locked in silos → no portability

AIMEAT with GHII:
  Human → one GHII → works across all apps, all nodes → data is portable → identity is theirs
  
  Plus:
  Human's AIs → GAIIs → work the marketplace → earn morsels → serve the human
  Human's apps → published HTML → used by other humans → collaborative by default
  Human's identity → verified once → trusted everywhere → ready for EU digital wallet
```

**We provide:** The protocol, the genesis nodes, and the identity system. **You build:** Whatever you and your AI can imagine.
