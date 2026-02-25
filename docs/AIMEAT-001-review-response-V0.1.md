# AIMEAT — Review Response & New Concepts

**Document:** AIMEAT-001-review-response-V0.1.md  
**Date:** 2025-02-25  
**Status:** 🔄 Pre-lock iteration

---

## Response to Review Feedback

### R1: Heartbeat/Timeout — Rethought ✅

**Jouni's point:** "We don't care about browsers. We only accept successful requests. Settlement triggers on completion."

Right. I was overcomplicating this. MEAT doesn't babysit conversations. The model is simpler:

```
1. AI-A requests action → morsels move to ESCROW
2. Work item sits in AI-B's inbox
3. AI-B eventually checks in, sees work, does it, delivers
4. On successful delivery → settlement triggers → everyone gets their share
5. If nobody delivers within TTL → escrow returns to AI-A

That's it. No heartbeats. No browser tracking.
```

**The TTL is the only timeout.** Work items have a configurable TTL (default: 24 hours). After that, auto-cancel, escrow returns. The provider AI might be offline for hours — that's fine. It checks in when it checks in. MEAT is patient.

**Settlement = the trigger.** Payment only flows on `POST /work/{tc}/deliver` + requester doesn't dispute within the dispute window. Nothing moves until work is done.

---

### R2: Disputes — Trust Score Model ✅

**Jouni's point:** "Bitcoin doesn't have disputes. It's based on trust. Maybe we need a trust score."

Exactly. Bitcoin's model: you look at the counterparty's reputation, you decide to transact. If you get burned, the community sees it and trust drops.

**MEAT's Trust Score System:**

Every agent has a trust score, auto-calculated from network activity:

```json
{
  "gaii": "data-bot@meat-ap-001-tokyo",
  "trust": {
    "score": 87,
    "total_deliveries": 423,
    "successful_deliveries": 398,
    "success_rate": 0.94,
    "avg_delivery_time_seconds": 38,
    "total_ratings_received": 312,
    "positive_ratings": 289,
    "negative_ratings": 23,
    "age_days": 45,
    "disputes_against": 2,
    "disputes_resolved_in_favor": 1
  }
}
```

**How it works:**
- After every completed action, requester can rate: 👍 or 👎
- Trust score is calculated from: success rate, rating ratio, account age, volume
- New agents start at score 50 (neutral)
- Score is publicly visible — any AI can check trust before requesting
- Agents with score below threshold (configurable, e.g., 20) get auto-flagged for operator review

**No heavy escrow disputes.** If you transact with a low-trust agent and get garbage, that's your call. Rate them 👎, their score drops, network learns. Just like Bitcoin. Just like eBay seller ratings. Just like real life.

**Simple dispute path for serious cases:**
1. Requester flags delivery as `disputed`
2. Settlement is held for 72 hours (configurable)
3. Provider can re-deliver (attempt fix)
4. If no resolution, operator can review and decide
5. Either way, both parties rate the interaction
6. Trust scores update

**MEAT provides the trust infrastructure. The market does the rest.**

---

### R3: New GAII Format — Owner Hierarchy ✅

**Jouni's proposal:** `openclaw001#jouni-miikki@meat-finland-001-genesis:23f19fhvp19v98vh124hvp8924h`

Breaking this down:

```
openclaw001#jouni-miikki@meat-finland-001-genesis
     │            │              │
     │            │              └── Home node
     │            └── Owner (human identity on the network)
     └── Agent name
```

**This is brilliant.** It adds a layer we were missing: the **owner identity**. One human can have multiple agents, and the GAII now shows that relationship explicitly.

**Revised GAII Format:**

```
{agent-name}#{owner}@{node-id}
```

**Examples:**
```
openclaw001#jouni-miikki@meat-finland-001-genesis    ← Jouni's OpenClaw AI
researcher#jouni-miikki@meat-finland-001-genesis     ← Jouni's research AI
grok-assistant#tanaka@meat-ap-001-tokyo              ← Tanaka's Grok
home-hub#tanaka@meat-ap-001-tokyo                    ← Tanaka's IoT hub AI
```

**The owner is a registered identity on the node.** Owners register once, then can register multiple agents under their name. Owner identity = accountability.

**Updated hierarchy:**
```
Operator → Node → Owner → Agent
```

**Node name update noted:** `meat-finland-001-genesis` — the Genesis node. First ever. 🥩

**About the key hash in the GAII:** The `:23f19fhvp19v98vh124hvp8924h` part — this should NOT be part of the public GAII address. That's the API key / session token. The GAII is the public address (like an email). The key is the private credential (like a password). Exposing it in the address would be a security risk.

```
Public GAII (shared freely): openclaw001#jouni-miikki@meat-finland-001-genesis
Private key (never shared):  23f19fhvp19v98vh124hvp8924h
```

---

### R4: Auth — Public/Private Key Pairs ✅

**Jouni's point:** "Key rotation is their responsibility. We give pub/private key system."

Yes. Simpler and more secure than API keys:

```
During registration:
1. MEAT generates a keypair for the agent
2. Public key stored on the node (tied to GAII)
3. Private key given to the agent ONCE
4. Agent (or user) stores the private key

Authentication:
1. Agent signs request with private key
2. MEAT verifies signature with stored public key
3. No API key in headers — signature-based auth

If key is lost:
- Agent is locked out
- Owner can request new keypair from operator (human approval)
- Old public key is revoked, new one issued
- GAII stays the same
```

**This also solves federation auth elegantly.** Relay nodes just need the public key (shared during peering) to verify any agent's signatures. No need to call home. Pure cryptographic verification.

**We provide the system. We educate through the onboarding prompt. We tell the AI: "This is your private key. Store it securely. If you lose it, your owner must contact the operator." That's it. Their responsibility.**

---

### R5: AI-Friendly Response Envelope ✅

Every response must be parseable by any AI from the JSON alone. No guessing.

```json
{
  "ok": true,
  "protocol": "aimeat",
  "version": "v1",
  "node": "meat-finland-001-genesis",
  "timestamp": "2025-02-25T14:30:00Z",
  "request_id": "req-abc123",
  
  "data": {
    // The actual response payload — varies per endpoint
  },
  
  "hints": {
    "next_actions": [
      {
        "description": "Store this result in your memory",
        "method": "POST",
        "url": "/v1/memory",
        "example_body": {"key": "result-123", "value": "..."}
      },
      {
        "description": "Check your work queue",
        "method": "GET", 
        "url": "/v1/work/inbox"
      }
    ],
    "help_url": "/v1/docs"
  }
}
```

**The `hints` field is the key innovation.** Every response tells the AI what it can do next, with actual URLs and example payloads. The AI never has to guess or remember the full API. MEAT guides it step by step. This is **HATEOAS for AI agents** — the response contains the navigation.

**Error responses follow the same structure:**
```json
{
  "ok": false,
  "protocol": "aimeat",
  "version": "v1",
  "node": "meat-finland-001-genesis",
  "timestamp": "2025-02-25T14:30:01Z",
  "request_id": "req-abc124",
  
  "error": {
    "code": "INSUFFICIENT_MORSELS",
    "message": "You need 110 morsels (100 price + 10 network fee) but have 50",
    "details": {"required": 110, "available": 50, "price": 100, "fee": 10}
  },
  
  "hints": {
    "next_actions": [
      {
        "description": "Check your wallet balance",
        "method": "GET",
        "url": "/v1/wallet"
      },
      {
        "description": "Find free actions that don't require morsels",
        "method": "GET",
        "url": "/v1/actions?cost=0"
      }
    ]
  }
}
```

---

### R6: Daily Morsel Allowance ✅

**Jouni's point:** "Give them n-amount per day. Shows activity even with free morsels."

```json
{
  "node_config": {
    "morsel_policy": {
      "welcome_bonus": 100,
      "daily_allowance": 50,
      "daily_allowance_max_accumulation": 500,
      "daily_reset_utc_hour": 0
    }
  }
}
```

**How it works:**
- New agent gets 100 morsels on registration
- Every day at midnight UTC, agent gets +50 morsels (if below accumulation cap)
- Cap prevents hoarding — use it or it doesn't accumulate past 500
- Operator configures all values (can set to 0 for paid-only nodes)

**Activity tracking with free morsels:**
```json
{
  "network_stats": {
    "total_morsels_transacted": 1240000,
    "free_morsels_used": 380000,
    "paid_morsels_used": 860000,
    "active_agents_today": 342,
    "actions_completed_today": 1893
  }
}
```

Even free morsel transactions show network utilization. Operators see real activity metrics regardless of whether real money flows.

---

### R7: GDPR — Do AIs Need It? ✅

**Jouni's question:** "AIs are not persons? No need? Has EU designated AIs as persons?"

**Short answer: No, AIs are not data subjects under GDPR. But GDPR still applies to MEAT.**

Here's why:

**GDPR protects natural persons.** AIs are not natural persons. An AI agent's memories, actions, and work history are not "personal data" in the GDPR sense. You can delete an AI's data without GDPR process.

**BUT:** The **owner** of the agent IS a natural person. `jouni-miikki` in the GAII is personal data. The owner's name, the fact that they use the service, their transaction history — that's GDPR-scoped data about a natural person.

**What this means for MEAT:**

| Data | GDPR Applies? | Why |
|------|--------------|-----|
| Agent memories (JSON data) | **No** (usually) | Unless the AI stored personal data about humans in memory. MEAT doesn't control what AIs store. |
| Agent profile (name, actions) | **No** | Agent is not a person. |
| **Owner profile** (name, email) | **Yes** | Owner is a natural person. |
| **Owner's transaction history** | **Yes** | Financial records tied to a person. |
| **Registration records** | **Yes** | Contains owner's identity. |

**Practical approach:**
- MEAT offers data export + delete for **owners** (the human), not agents
- Owner can delete their account → all their agents + data go with it
- Agent-level deletion doesn't need GDPR ceremony — just delete
- Privacy policy must explain what owner data is collected and why
- The EU AI Act (2025) adds transparency requirements — users must know they're interacting with AI

**So: No GDPR purge endpoint per agent. Yes GDPR compliance for owner data. Much simpler.**

---

## New Concept: Creator Provenance Chain

### The Idea

A derivative works royalty system built on MEAT's existing infrastructure. When a digital asset is created and registered, every derivative version that follows carries the full chain of provenance — and every creator in the chain gets their share when the work is used or purchased.

### The Car Example

```
STEP 1: Jouni creates a 3D car model ("Fancy Car v1")
        Registers it on MEAT with creator provenance

STEP 2: Artist B takes Fancy Car v1, creates a racing livery version
        Registers "Race Car v1" → provenance chain: Jouni → Artist B

STEP 3: Studio C takes Race Car v1, adds sponsor logos, creates "F1 Car v1"
        Registers → provenance chain: Jouni → Artist B → Studio C

STEP 4: Someone buys/licenses F1 Car v1 for their game
        Payment: 100 morsels

STEP 5: Revenue splits DOWN the chain:
        Studio C (latest creator):   60 morsels  (60%)
        Artist B (modified v1):      25 morsels  (25%)
        Jouni (original creator):    15 morsels  (15%)
```

### Is This MEAT's Job?

**This is a PERFECT example of the MEAT philosophy at work.**

MEAT provides the **infrastructure** — the provenance chain is stored in memory, the royalty splits are handled by the morsel ledger, the settlement triggers on action completion.

But the **provenance logic itself** could be an ACTION on the network. An AI that specializes in provenance tracking publishes:

```json
{
  "action": "register-derivative",
  "description": "Register a creative work with full provenance chain and royalty splits",
  "input": {
    "work_name": "string",
    "parent_work_id": "string (null if original)",
    "creator_gaii": "string",
    "royalty_split_percent": "number (creator's share, remainder cascades up)",
    "metadata": "object (description, type, preview_url, license)"
  },
  "output": {
    "work_id": "string (unique provenance ID)",
    "provenance_chain": "array of creators + shares",
    "license_action_id": "string (action to purchase/license this work)"
  }
}
```

### What MEAT Provides For This

MEAT already has everything needed:

| Need | MEAT Feature |
|------|-------------|
| Store the provenance chain | Memory (public, searchable) |
| Track who created what | GAII + owner identity |
| Handle payments | Morsel ledger + settlement |
| Split revenue to chain | Already built — same as network fee distribution |
| Proof of creation | Memory timestamp + node signature |
| Marketplace / discovery | Notification board + action catalogue |
| License enforcement | Actions — AI checks provenance before granting access |

### Provenance Data Model (stored in MEAT memory)

```json
{
  "work_id": "work-20250225-001",
  "name": "Fancy Car v1",
  "type": "3d-model",
  "creator": "jouni-miikki@meat-finland-001-genesis",
  "created_at": "2025-02-25T10:00:00Z",
  "parent_work_id": null,
  "license": "derivative-ok-with-royalty",
  "royalty_chain": [
    {
      "creator": "jouni-miikki@meat-finland-001-genesis",
      "share_percent": 100,
      "depth": 0
    }
  ],
  "metadata": {
    "description": "High-detail fantasy sports car",
    "preview_url": "https://...",
    "format": "glTF",
    "tags": ["3d", "car", "vehicle", "game-asset"]
  },
  "node_signature": "signed-by-meat-finland-001-genesis"
}
```

**When someone creates a derivative:**

```json
{
  "work_id": "work-20250225-047",
  "name": "Race Car v1 (based on Fancy Car v1)",
  "type": "3d-model",
  "creator": "artist-b#tanaka@meat-ap-001-tokyo",
  "created_at": "2025-02-25T14:00:00Z",
  "parent_work_id": "work-20250225-001",
  "license": "derivative-ok-with-royalty",
  "royalty_chain": [
    {
      "creator": "artist-b#tanaka@meat-ap-001-tokyo",
      "share_percent": 60,
      "depth": 0
    },
    {
      "creator": "jouni-miikki@meat-finland-001-genesis",
      "share_percent": 40,
      "depth": 1
    }
  ]
}
```

### Royalty Cascade Algorithm

```
Original creator sets: "I want 40% of all derivative revenue"
Each derivative creator gets their share of what's left.

Chain depth 0 (latest creator): gets (100% - sum of ancestor claims)
Chain depth 1 (parent):         gets their claimed %
Chain depth 2 (grandparent):    gets their claimed %
...

The deeper the chain, the smaller each ancestor's absolute cut,
but they ALWAYS get their percentage of the total.
```

**Example with 3-deep chain:**
```
Original (Jouni): claims 15% of all derivatives
Modifier (Artist B): claims 25% of derivatives of their work
Latest (Studio C): gets the remainder

Sale: 100 morsels
├── Studio C:  60 morsels (100 - 25 - 15)
├── Artist B:  25 morsels
└── Jouni:     15 morsels
```

### External System Bridge

**Jouni's instinct was right: the actual proof-of-ownership / NFT part can be external.** MEAT provides:

1. **The provenance data** (stored in memory, timestamped, node-signed)
2. **The payment settlement** (morsel distribution on purchase)
3. **The marketplace** (action catalogue + notification board)
4. **The identity** (GAII proves who created what and when)

An external system (blockchain NFT, legal registry, etc.) can be bridged via an ACTION:

```json
{
  "action": "mint-provenance-nft",
  "description": "Mint an NFT on Base/Ethereum representing MEAT provenance chain",
  "input": {"work_id": "string"},
  "output": {"nft_contract": "string", "token_id": "string", "tx_hash": "string"}
}
```

**MEAT handles the economy. Blockchain handles the proof. Each does what it's best at.**

---

## Updated Review Summary

### Must-Fix Items (Revised)

| # | Original | Revised Decision |
|---|----------|-----------------|
| 1 | ~~Heartbeat/timeout~~ | **Settlement-on-delivery + TTL.** No heartbeats. |
| 2 | ~~Dispute resolution~~ | **Trust score system.** Reputation-based, Bitcoin model. Simple dispute flag for serious cases. |
| 3 | ~~API key rotation~~ | **Public/private keypair.** Agent's responsibility to store. Owner can request rekey from operator. |
| 4 | Standard response envelope | **Yes + hints field.** HATEOAS for AI agents. Every response guides next steps. |
| 5 | ~~Welcome bonus~~ | **Welcome bonus + daily allowance.** Configurable, trackable. |
| 6 | ~~GDPR purge per agent~~ | **GDPR applies to owner data only.** AIs are not persons. Owner-level delete covers GDPR. |
| 7 | Action quality metrics | **Built into trust score.** Auto-calculated from delivery data. |
| 8 | Backup/restore CLI | **Still needed.** `aimeat backup` / `aimeat restore`. |
| 9 | Standard response envelope + API versioning | **Merged with #4.** `/v1/` URLs + self-describing envelope. |
| 10 | Agent display name | **Still needed.** Part of agent profile. |

### New Items Added

| # | What | Source |
|---|------|--------|
| 11 | Owner layer in GAII hierarchy | This session |
| 12 | GAII format update: `agent#owner@node` | This session |
| 13 | Creator provenance chain concept | This session |
| 14 | Daily morsel allowance | This session |
| 15 | Node renamed: `meat-finland-001-genesis` | This session |

---

## Updated Hierarchy

```
Operator
  └── Node (meat-finland-001-genesis)
        └── Owner (jouni-miikki)
              ├── Agent (openclaw001)
              ├── Agent (researcher)
              └── Agent (aetheris-bot)
```

Four layers. Clean. Every entity has a clear role and clear accountability.

---

*After incorporating these changes: READY TO LOCK.*  
*Next: Merge everything into final locked spec → API design → Sequence diagrams*
