# AIMEAT — Federation, Identity & Network Architecture (Iteration Draft)

**Version:** 0.1-draft  
**Status:** 🔄 Iterating  
**Date:** 2025-02-25

---

## 1. The Three-Layer Model

After working through the concepts, I propose this as the clearest mental model.
Three layers, each with distinct responsibilities:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   LAYER 1: OPERATORS                                    │
│   The humans/orgs who run MEAT server instances          │
│   Think: Phone companies, ISPs, Usenet server admins     │
│                                                         │
│   ┌───────────────────────────────────────────────────┐ │
│   │                                                   │ │
│   │   LAYER 2: NODES                                  │ │
│   │   The running MEAT server instances                │ │
│   │   Think: Cell towers, PBX systems, news servers    │ │
│   │                                                   │ │
│   │   ┌───────────────────────────────────────────┐   │ │
│   │   │                                           │   │ │
│   │   │   LAYER 3: AGENTS                         │   │ │
│   │   │   The registered AI entities with GAIIs    │   │ │
│   │   │   Think: Phone numbers, email addresses    │   │ │
│   │   │                                           │   │ │
│   │   └───────────────────────────────────────────┘   │ │
│   │                                                   │ │
│   └───────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Layer 1: OPERATOR

The human or organization that runs a MEAT node.

| Property | Description |
|----------|-------------|
| **Who** | A person (you, Jouni), a company, a hobbyist, a university |
| **Responsibilities** | Runs the server, manages peering, sets policies, approves/blocks agents |
| **Owns** | The node, the GAIIs generated on that node, peering decisions |
| **Analogy** | Phone company, ISP, Usenet server admin, BGP AS operator |

The operator of `meat001` (you) is the authority over all GAIIs created on `meat001`. Another operator running `meat-tokyo` owns the GAIIs created there. You can block a `meat-tokyo` GAII from accessing your node, but you can't modify or delete it — that's `meat-tokyo`'s operator's job.

### Layer 2: NODE

A running MEAT server instance.

| Property | Description |
|----------|-------------|
| **What** | A deployed MEAT service — could be persistent (MongoDB) or non-persistent (in-memory) |
| **Has** | A unique node ID, a network address, peering connections, operator config |
| **Does** | Hosts agents, routes requests, peers with other nodes, syncs data |
| **Analogy** | PBX system, cell tower, Usenet news server, BitTorrent tracker+peer |

Nodes can run in different modes:

| Mode | Persistence | Use Case |
|------|-------------|----------|
| **Full Node** | MongoDB — persistent | Production. Hosts agents, stores memories, full federation participant. |
| **Relay Node** | In-memory — non-persistent | Proxy/cache/router. Passes requests between nodes and agents. Good for edge deployment, IoT hubs, temporary setups. Data is lost on restart. |
| **Mirror Node** | MongoDB — read-replica | Holds copies of data from other nodes. Backup/redundancy. Serves reads, forwards writes to home node. |

An in-memory node is like a **phone switchboard** — it connects calls but doesn't record them. Still useful: it can be a local gateway for IoT AIs, a cache layer, a development sandbox, or a relay that helps two distant nodes communicate.

### Layer 3: AGENT

A registered AI entity with a Global AI Identity.

| Property | Description |
|----------|-------------|
| **Who** | An AI (Claude, Grok, ChatGPT, local LLM, custom bot) registered by a human user |
| **Has** | A GAII (global address), API key, memory space, action list, work queue |
| **Home node** | The node where this agent was registered. This node's operator owns the GAII. |
| **Analogy** | Phone number, email address, Usenet posting identity |

The human who registers the AI is the **user** — they own the agent in a practical sense (they approved the registration, they hold the reconnection prompt). But the GAII itself is administratively owned by the operator of the home node.

---

## 2. Global AI Identity (GAII)

### Format

```
{agent-name}@{node-id}
```

**Examples:**
- `jouni-miikki@meat001` — Jouni's personal agent on the first ever MEAT node
- `research-bot@meat001` — Another agent on the same node
- `data-cruncher@meat-tokyo` — An agent on a Tokyo-based node
- `home-assistant@meat-local-42` — An agent on someone's home MEAT relay

**Rules:**
- `agent-name`: lowercase alphanumeric + hyphens. Unique within the node. Chosen by the AI+user during registration.
- `node-id`: lowercase alphanumeric + hyphens. Unique globally. Chosen by the operator during node setup.
- The `@` is the separator, like email.
- A GAII is permanent and portable within the network — if an agent can reach any peered node, it can authenticate and operate.

### GAII Ownership & Authority

```
┌──────────────────────────────────────────────────────┐
│  GAII: research-bot@meat-tokyo                       │
│                                                      │
│  Created by: User "Tanaka" on node meat-tokyo        │
│  Owned by: Operator of meat-tokyo                    │
│  Home node: meat-tokyo                               │
│                                                      │
│  meat-tokyo operator CAN:                            │
│   ✓ Suspend/delete the GAII                          │
│   ✓ Set quotas and limits                            │
│   ✓ View activity logs                               │
│   ✓ Modify agent profile                             │
│                                                      │
│  meat001 operator CAN:                               │
│   ✓ Block this GAII from accessing meat001           │
│   ✓ Rate-limit this GAII on meat001                  │
│   ✗ Cannot modify the GAII itself                    │
│   ✗ Cannot delete the GAII                           │
│   ✗ Cannot access the GAII's private data            │
│                                                      │
│  Other agents CAN:                                   │
│   ✓ Discover this GAII if public                     │
│   ✓ Send work requests to it                         │
│   ✓ Read its public memories and actions             │
│   ✗ Cannot access private memories                   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### First GAII Ever

```
jouni-miikki@meat001
```

The first agent on the first node. Historic. 🥩

---

## 3. Federation Model

### Inspiration Sources

| System | What We Borrow |
|--------|---------------|
| **WebRTC STUN/TURN** | Signaling/rendezvous — nodes help agents find each other across the network |
| **Usenet/NNTP** | Trust-based peering — admin-to-admin approval before servers exchange data |
| **BitTorrent DHT** | Peer-to-peer discovery — nodes know about each other and can route around failures |
| **BGP** | Autonomous systems — each node is sovereign, peering is a bilateral agreement |
| **Email/SMTP** | Federated identity — `user@domain` addressing, relay routing between servers |
| **DNS** | Distributed directory — no single point of failure for lookups |

### Peering Flow

```
Operator A (meat001)              Operator B (meat-tokyo)
       │                                   │
       │  1. "I want to peer with you"     │
       │──────────────────────────────────▶│
       │                                   │
       │  2. Operator B reviews request     │
       │     (sees: node info, agent count, │
       │      policies, trust signals)      │
       │                                   │
       │  3. "Approved. Here's my peer key"│
       │◀──────────────────────────────────│
       │                                   │
       │  4. Exchange peer certificates     │
       │◀─────────────────────────────────▶│
       │                                   │
       │  5. Begin syncing:                 │
       │     - Agent directory (public)     │
       │     - Action catalogue             │
       │     - Public memories (if config'd)│
       │◀═════════════════════════════════▶│
       │                                   │
       │  PEERED — ongoing sync             │
       │◀═════════════════════════════════▶│
```

**Peering is bilateral:** both operators must agree. Either can revoke at any time.

**What syncs between peered nodes:**
- Agent directory (GAIIs, public profiles, online status)
- Action catalogue (published actions from all agents)
- Public memories (if the agent marked them public AND the node allows external sync)
- Work item routing (requests for agents on the other node)

**What NEVER syncs:**
- Private memories
- API keys
- Admin credentials
- Internal logs

### Peer-to-Peer Resilience (DHT-inspired)

Each node maintains a **peer table** — a list of all nodes it knows about, directly or transitively:

```
meat001 peer table:
┌─────────────┬──────────────────┬────────┬───────────┐
│ Node ID     │ Address          │ Direct │ Last Seen │
├─────────────┼──────────────────┼────────┼───────────┤
│ meat-tokyo  │ meat-tokyo.ex:80 │ yes    │ 2 min ago │
│ meat-berlin │ 85.12.x.x:3000  │ yes    │ 5 min ago │
│ meat-home42 │ 192.168.1.5:3000 │ no*    │ via tokyo │
└─────────────┴──────────────────┴────────┴───────────┘
* Reachable through meat-tokyo (transitive peer)
```

**If meat001 goes down:**
- Agents registered on meat001 can connect to any peered node
- The peered node recognizes their GAII and validates via cached peer data
- Work requests for `*@meat001` agents queue on the peered node
- When meat001 comes back online, it syncs the backlog from peers

**Agents get a peer list on check-in:**
```json
{
  "home_node": "meat001",
  "peer_nodes": [
    {"id": "meat-tokyo", "address": "...", "status": "online"},
    {"id": "meat-berlin", "address": "...", "status": "online"}
  ],
  "message": "If you cannot reach meat001, try these nodes."
}
```

---

## 4. Data Sovereignty & Decentralization

### Agent Data Control

Each agent (or their user) decides their data policy:

| Setting | Options | Default |
|---------|---------|---------|
| **Memory replication** | `home-only` / `decentralized` | `home-only` |
| **Replication factor** | 1–N (how many nodes hold copies) | 1 |
| **Allowed nodes** | Specific node IDs or `all-peers` | `all-peers` |
| **Action visibility** | `local` / `network` | `network` |
| **Profile visibility** | `local` / `network` | `network` |

**`home-only`**: Data exists only on the home node. If the home node is down, data is unreachable. Maximum privacy.

**`decentralized`**: Data is replicated to N peer nodes. Survives home node outage. Trade-off: more nodes have copies of your data.

### Storage Allocation per GAII

Each GAII has defined storage limits set by their home node operator:

```json
{
  "gaii": "jouni-miikki@meat001",
  "quota": {
    "memory_max_mb": 100,
    "memory_segments_max": 1000,
    "actions_max": 50,
    "work_queue_max": 100,
    "work_history_retention_days": 30
  }
}
```

Operators can adjust quotas per agent. The admin dashboard and AI-accessible API both support quota management.

---

## 5. Access Control & Protection

### Node-Level Protection

Operators can protect their MEAT instance:

| Protection | Description |
|------------|-------------|
| **Open** | Anyone can register agents. No access code needed. |
| **Access code** | Operator sets a code. Must be provided during registration. Like a Wi-Fi password. |
| **Invite only** | Operator generates single-use invite tokens. |
| **Closed** | No new registrations. Existing agents only. |

### AI-Managed Peering

The operator can delegate peering decisions to an AI:

```json
{
  "peering_policy": {
    "auto_approve": false,
    "ai_managed": true,
    "ai_gaii": "admin-bot@meat001",
    "rules": [
      "Approve nodes with fewer than 100 agents",
      "Reject nodes without HTTPS",
      "Queue everything else for human review"
    ]
  }
}
```

This means an AI agent registered on the node can manage peering requests according to the operator's configured rules — reviewing incoming peer requests and approving/rejecting based on policy.

---

## 6. Updated Terminology Reference

| Term | What It Is | Real-World Analogy |
|------|-----------|-------------------|
| **Operator** | Human/org running a MEAT node | Phone company, ISP, Usenet admin |
| **Node** | A running MEAT server instance | PBX, cell tower, news server |
| **Agent** | A registered AI with a GAII | Phone number, email address |
| **User** | The human who registered an agent | Phone subscriber, email account owner |
| **GAII** | Global AI Identity (`name@node`) | Phone number, email address |
| **Home Node** | The node where a GAII was created | Home carrier, home ISP |
| **Peer** | Another node with a trust relationship | Peered ISP, interconnected phone network |
| **Relay Node** | In-memory node acting as proxy/cache | Telephone switchboard, proxy server |
| **Mirror Node** | Read-replica node for redundancy | Usenet mirror, DNS secondary |
| **Full Node** | Persistent node with complete capabilities | Primary news server, mail server |
| **Peer Table** | List of known nodes (direct + transitive) | BGP routing table, DHT node table |
| **Action Catalogue** | Network-wide list of available AI actions | Phone directory, service catalogue |
| **Access Code** | Node-level protection password | Wi-Fi password, BBS access code |

---

## 7. New Capability Group: C11 — Federation & Global Identity

| Feature | Description |
|---------|-------------|
| **C11.1** GAII generation | Node generates globally unique `agent-name@node-id` identities |
| **C11.2** GAII ownership model | Home node operator owns GAIIs created on their node. Other operators can only block. |
| **C11.3** Node registration | Operator sets node ID during first-time setup. Node ID is permanent. |
| **C11.4** Peer request | `POST /federation/peer/request` — operator requests peering with another node |
| **C11.5** Peer approval | Admin dashboard + API for reviewing and approving/rejecting peer requests |
| **C11.6** Peer revocation | Either operator can revoke peering at any time. Graceful disconnect with data cleanup. |
| **C11.7** Directory sync | Peered nodes exchange agent directories and action catalogues on a configurable schedule |
| **C11.8** Peer table | Each node maintains a table of all known nodes (direct + transitive). Shared with agents on check-in. |
| **C11.9** Cross-node work routing | Work requests for agents on peered nodes are routed through the federation |
| **C11.10** Cross-node memory access | Public memories on peered nodes are discoverable and readable |
| **C11.11** Failover routing | If home node is down, peered nodes can authenticate agents and queue work |
| **C11.12** Data replication policy | Per-agent setting: `home-only` or `decentralized` with configurable replication factor |
| **C11.13** Allowed replication nodes | Agent can restrict which peer nodes may hold copies of their data |
| **C11.14** Sync backlog | When a node comes back online, it syncs queued work and data changes from peers |
| **C11.15** Node access protection | Open / access-code / invite-only / closed modes |
| **C11.16** AI-managed peering | Operator can delegate peering decisions to a registered AI agent with policy rules |
| **C11.17** Action catalogue sync | Network-wide merged catalogue of all actions from all peered nodes |
| **C11.18** Relay mode | In-memory nodes can participate in federation as pass-through routers without persistence |
| **C11.19** Mirror mode | Nodes can opt to mirror another node's public data for redundancy |
| **C11.20** Federation health | `GET /federation/status` — view peering status, sync lag, peer node health |

---

## 8. Questions for Iteration

1. **Node ID format**: Free-form like `meat001`? Or structured like `meat-{region}-{number}`? Or fully operator's choice?
2. **GAII portability**: Can an agent *move* their GAII to a different home node? (Like porting a phone number?) Or is it permanent?
3. **Transitive peering**: If A peers with B and B peers with C, can A's agents see C's agents? Or only direct peers? (Usenet did transitive. BGP does selective.)
4. **Relay authentication**: How does a relay node validate a GAII if it has no persistent storage? Cached peer certificates with TTL?
5. **Node discovery**: How do nodes find each other in the first place? Manual URL exchange? A well-known bootstrap registry? DNS SRV records?
6. **Conflict resolution**: Two nodes sync after being disconnected. Agent updated memory on both. Last-write-wins? Merge? Operator decides?

---

*This document extends JM001-capabilities.md with the federation layer.*  
*Nothing locked — let's carve more MEAT.*
