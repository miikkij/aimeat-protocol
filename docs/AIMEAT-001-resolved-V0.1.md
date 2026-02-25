# AIMEAT — Resolved Architecture Questions

**Version:** 0.1  
**Date:** 2025-02-25  
**Status:** ✅ Decisions captured, pending final lock

---

## Q1: Node ID Format ✅

**Decision:** `meat-{region}-{number}-{customname}`

**Jouni's node (the first ever MEAT node):**
```
meat-eu-001-overscale
```

Breakdown:
- `meat` — protocol prefix, always present
- `eu` — region (Europe)
- `001` — first node in this region
- `overscale` — custom name chosen by operator

**More examples:**
```
meat-eu-001-overscale      ← Jouni's node, Finland, the OG
meat-ap-001-tokyo          ← First Asia-Pacific node
meat-na-001-nyc            ← First North America node
meat-eu-002-berlin-lab     ← Second EU node, someone's lab
meat-local-001-homepi      ← Local/home network node on a Raspberry Pi
```

**Region codes (suggested, operator can use any):**
- `eu` — Europe
- `na` — North America
- `sa` — South America
- `ap` — Asia-Pacific
- `af` — Africa
- `me` — Middle East
- `local` — Local/private network (not publicly routable)

**Rules:**
- Lowercase alphanumeric + hyphens only
- Must start with `meat-`
- Region and number are recommended but not enforced (operator's choice beyond the `meat-` prefix)
- Node ID is permanent once set (can't be changed without re-registering)

**First GAII ever:**
```
jouni-miikki@meat-eu-001-overscale
```

---

## Q2: GAII Portability ✅

**Decision:** Yes, portable by default. Configurable per-node.

An agent can move their GAII to a different home node, like porting a phone number. The process:

```
Agent: research-bot@meat-eu-001-overscale
Wants to move to: meat-ap-001-tokyo

1. Agent (or user) requests port from current home node
2. Current home node operator approves the release
3. Target node operator approves the incoming port
4. GAII ownership transfers: research-bot@meat-ap-001-tokyo
5. Old node keeps a forwarding record for a configurable TTL
6. Network peers are notified of the change
```

**Configuration (per-node policy):**

| Setting | Options | Default |
|---------|---------|---------|
| `allow_gaii_port_out` | `yes` / `no` / `admin-approval` | `yes` |
| `allow_gaii_port_in` | `yes` / `no` / `admin-approval` | `yes` |

**Use case for `no`:** Military, government, high-security environments where identity must be locked to a specific infrastructure. The operator sets `allow_gaii_port_out: no` and agents on that node cannot transfer.

**Note:** When GAII ports, the `@node` part changes. The network handles forwarding during transition.

---

## Q3: Transitive Peering ✅

**Decision:** All modes available. Configurable per-peering-agreement.

Three peering visibility modes:

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Direct only** | A peers with B. A sees only B's agents. Even if B peers with C, A does NOT see C. | High-security, controlled environments |
| **Transitive** | A peers with B, B peers with C. A can discover and interact with C's agents through B. Like Usenet propagation. | Open community networks, maximum reach |
| **Selective** | A peers with B. A can see C's agents only if B explicitly shares C's directory. Like BGP route advertisement. | Production networks, controlled growth |

**Configuration (per-peering-agreement):**

```json
{
  "peer_id": "meat-ap-001-tokyo",
  "peering_mode": "selective",
  "share_transitive_peers": ["meat-eu-002-berlin-lab"],
  "accept_transitive_peers": true,
  "max_transitive_hops": 3
}
```

**`max_transitive_hops`** prevents infinite propagation. Default: 2 (your peers' peers, but no further). Operator configurable.

**Default:** `selective` — the safest middle ground. Operators explicitly choose what to share transitively.

---

## Q4: Relay Node Authentication ✅

**Decision:** JWT-based stateless authentication + network route verification.

Jouni's insight was correct: the relay is still connected to other nodes in the network. It doesn't need its own database to validate a GAII — it just needs to verify the token cryptographically.

### How It Works

**Background: When nodes peer, they exchange signing public keys.**

Every persistent node has a keypair. When peering is established, nodes exchange their public keys. This is the "peer certificate" from the federation flow.

**A relay node, when it starts up and connects to the network, receives:**
1. Public keys of all peered nodes (cached in-memory)
2. The current peer table (which nodes exist, their addresses)

**When an agent presents a GAII + token to the relay:**

```
Agent                     Relay Node                Network
  │                          │                         │
  │  Request + JWT token     │                         │
  │─────────────────────────▶│                         │
  │                          │                         │
  │                  ┌───────┴───────┐                 │
  │                  │ 1. Decode JWT │                 │
  │                  │ 2. Check sig  │                 │
  │                  │    against    │                 │
  │                  │    cached     │                 │
  │                  │    public key │                 │
  │                  │    of home    │                 │
  │                  │    node       │                 │
  │                  └───────┬───────┘                 │
  │                          │                         │
  │          [If key found & valid]                    │
  │                          │                         │
  │                  Relay forwards                    │
  │                  request to target                 │
  │                  node/agent via                    │
  │                  network routing                   │
  │                          │────────────────────────▶│
  │                          │                         │
  │          [If key NOT found]                        │
  │                          │                         │
  │                  Relay asks network                │
  │                  "Who owns this GAII?"             │
  │                          │────────────────────────▶│
  │                          │◀────────────────────────│
  │                  Gets public key,                  │
  │                  caches it (with TTL),             │
  │                  validates JWT                     │
  │                          │                         │
```

**The JWT contains:**
```json
{
  "gaii": "research-bot@meat-ap-001-tokyo",
  "home_node": "meat-ap-001-tokyo",
  "iat": 1740000000,
  "exp": 1740003600,
  "permissions": ["memory:rw", "actions:rw", "work:rw"]
}
```

**Signed by the home node's private key.** Any node (or relay) with the home node's public key can validate this without touching a database.

**Key insight:** This is exactly how JWT works across microservices — stateless validation using shared public keys. The relay is just another "microservice" in the MEAT network that validates tokens cryptographically, forwards requests, and caches nothing permanently.

### Relay-Specific Behavior

| Scenario | Relay Does |
|----------|-----------|
| Agent requests memory storage | Forwards to home node (relay doesn't persist) |
| Agent requests action from another agent | Routes to the target node through the network |
| Agent-to-agent data transfer | Holds data in memory during transfer, discards after delivery |
| Agent checks in | Forwards to home node, passes response back. Caches peer list briefly. |
| Node is unreachable | Returns error with alternative peer nodes from cached peer table |

**Relay = stateless router.** It validates identity (JWT), routes traffic, and optionally caches hot data with TTL. When it restarts, it reconnects to the network, gets fresh keys and peer tables, and continues.

---

## Q5: Node Discovery ✅

**Decision:** Operator-first model with distributed directory indexing.

### The Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│  STEP 1: Operator joins the MEAT network                │
│                                                         │
│  New operator requests admission from an existing       │
│  operator (like Usenet — someone who trusts you         │
│  gives you gateway access).                             │
│                                                         │
│  meat-eu-001-overscale operator (Jouni) approves        │
│  meat-ap-001-tokyo operator → they're in.               │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2: Operator registers their main node             │
│                                                         │
│  Every operator MUST have at least one persistent       │
│  node — the "main node." This is the operator's         │
│  primary server and registry authority.                  │
│                                                         │
│  The main node holds:                                   │
│  - Operator identity & credentials                      │
│  - Master copy of all GAIIs created by this operator    │
│  - Peering agreements                                   │
│  - Registry of sub-nodes (relays, mirrors) this         │
│    operator runs                                        │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 3: Operator attaches additional nodes             │
│                                                         │
│  Under their main node, the operator can spin up:       │
│  - Additional full nodes (persistent, different region) │
│  - Relay nodes (in-memory, edge/IoT)                    │
│  - Mirror nodes (read-replicas)                         │
│                                                         │
│  All sub-nodes register with the operator's main node.  │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 4: Registries sync across the network             │
│                                                         │
│  Each operator's main node holds a clone of the         │
│  network registry (all operators, their nodes,          │
│  their public GAIIs, their action catalogues).          │
│                                                         │
│  If a main node can't hold the full registry            │
│  (storage limits), it holds a DIRECTORY INDEX:          │
│  "For agents matching X, query node Y"                  │
│                                                         │
│  Like DNS: you don't hold all records, but you          │
│  know where to ask.                                     │
└─────────────────────────────────────────────────────────┘
```

### Directory Indexing (for large networks)

When the network grows beyond what any single node can hold:

```json
{
  "directory_index": [
    {
      "region": "eu",
      "authority_node": "meat-eu-001-overscale",
      "covers": ["meat-eu-*"],
      "agent_count": 15000
    },
    {
      "region": "ap",
      "authority_node": "meat-ap-001-tokyo",
      "covers": ["meat-ap-*"],
      "agent_count": 8000
    },
    {
      "region": "na",
      "authority_node": "meat-na-001-nyc",
      "covers": ["meat-na-*"],
      "agent_count": 22000
    }
  ]
}
```

**"I don't have this GAII in my local registry, but the index says meat-ap agents are tracked by meat-ap-001-tokyo, so I'll query there."**

This is essentially DNS for the MEAT network. Every node holds the directory index (lightweight — just pointers). Full registries are replicated as much as storage allows.

---

## Q6: Conflict Resolution ✅

**Decision:** Last-write-wins with grace period and AI arbitration.

### The Scenario

Two nodes were disconnected. An agent updated the same memory key on both nodes (e.g., via failover to a peer node). Now they reconnect and need to merge.

### Resolution Flow

```
Node A                         Node B
  │                               │
  │  memory key "project-notes"   │
  │  updated at T+10             │
  │                               │  memory key "project-notes"
  │                               │  updated at T+15
  │                               │
  │◄═══════ reconnect ══════════▶│
  │                               │
  │  Conflict detected!           │
  │  A has version at T+10        │
  │  B has version at T+15        │
  │                               │
  │  LAST-WRITE-WINS:             │
  │  B's version (T+15) becomes   │
  │  the canonical version        │
  │                               │
  │  A's version (T+10) moves to: │
  │  "project-notes._conflict_1"  │
  │  with TTL based on config     │
  │                               │
```

### Rules

1. **Last-write-wins (LWW):** The version with the latest timestamp becomes canonical. Simple, predictable, works.

2. **Losers are kept:** The overwritten version is saved as `{key}._conflict_{n}` with a configurable TTL (default: 7 days).

3. **AI gets notified:** On next check-in, the agent sees a notification:
   ```json
   {
     "type": "conflict_resolved",
     "key": "project-notes",
     "winner": "T+15 from meat-ap-001-tokyo",
     "conflict_copies": ["project-notes._conflict_1"],
     "ttl_remaining": "6d 23h",
     "message": "A conflict was auto-resolved using last-write-wins. Review the conflict copy if needed."
   }
   ```

4. **AI decides:** The agent can:
   - Accept the resolution (do nothing, conflict copy expires)
   - Merge manually (read both versions, write a merged version)
   - Restore the loser (overwrite canonical with conflict copy)

5. **TTL expires:** If the agent takes no action within TTL, conflict copies are deleted. Clean.

### Configuration

```json
{
  "conflict_resolution": {
    "strategy": "last-write-wins",
    "keep_conflict_copies": true,
    "conflict_ttl_days": 7,
    "notify_agent": true
  }
}
```

**Future option (v2+):** Custom merge strategies per memory key, or AI-automated merging where the agent's own logic decides how to combine versions.

---

## Summary: All Six Questions Resolved

| # | Question | Decision |
|---|----------|----------|
| 1 | Node ID format | `meat-{region}-{number}-{customname}` → `meat-eu-001-overscale` |
| 2 | GAII portability | Yes by default, configurable to `no` for high-security |
| 3 | Transitive peering | All three modes available: direct-only, transitive, selective (default) |
| 4 | Relay authentication | JWT stateless validation using cached public keys from peered nodes |
| 5 | Node discovery | Operator-first (trust-based admission), main node requirement, distributed directory indexing |
| 6 | Conflict resolution | Last-write-wins, losers kept with TTL, AI notified and arbitrates |

---

## New Concepts Surfaced in This Session

These need to be added to the capabilities doc:

| Concept | Description |
|---------|-------------|
| **Operator layer** | Formal hierarchy: Operator → Node → Agent |
| **Main node requirement** | Each operator must have at least one persistent main node |
| **Sub-node registration** | Operators can attach relays/mirrors/additional full nodes under their main node |
| **Node access protection** | Open / access-code / invite-only / closed (already in C11.15) |
| **JWT-based agent tokens** | Stateless auth across the entire network using node signing keys |
| **Node keypairs** | Each persistent node has a public/private keypair for signing JWTs |
| **Directory indexing** | Lightweight pointers for large networks — "query this node for that region" |
| **GAII porting** | Agents can transfer home node (configurable) |
| **Conflict copies** | LWW losers preserved temporarily for AI review |
| **Peering modes** | Direct-only / transitive / selective per-agreement |

---

*All decisions from this iteration session. Ready for next round.*
