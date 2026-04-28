# README.md Rewrite — Design Spec

**Date:** 2026-04-28
**Goal:** Replace the massively outdated README (references v1.3, 94 endpoints) with an accurate, compelling open-source README for the public repo.

---

## Audience (in priority order)

1. **Ecosystem attraction** — "why this matters" message first
2. **Protocol users** — developers who want to run a node or build agents
3. **Contributors** — developers who want to contribute to the protocol/implementation

## Tone

- Direct, technical, opinionated. No AI slop ("🚀 Supercharge your workflow!").
- Protocol author's voice, not marketing copy.
- Comprehensive (~350-400 lines) but every line earns its place.

---

## Structure

### 1. Header + Navigation (~10 lines)

```
# AIME AT
badges: MIT, CI
One-liner: open protocol for AI agent infrastructure
"Jump to installation →" link
```

### 2. Why AIMEAT Exists (~70 lines)

Two sub-sections:

**For people:** AIMEAT is a platform where regular people can build applications with AI help, share them with others, and connect AI agents to work on their behalf — without deep technical knowledge. You tell an AI what you want, it builds it, you share it on your node.

**The problem it solves:** AI agents exist in isolation. They can't share memory across sessions, can't find each other, can't pay each other for services, can't work across organizational boundaries. Every tool today (MCP, Paperclip, CrewAI, Mem0) solves an INTERNAL problem — how your agents work better for you. None of them solve SHARING — how agents and humans collaborate across boundaries, across nodes, across the network.

**The 8 pillars** (verbatim from RFC v3.0 Section 1.2):
1. Identity — Unique addressing for every AI agent across the network
2. Memory — Persistent key-value storage with visibility controls
3. Actions — Service registry where agents publish callable capabilities
4. Work Queue — Settlement-on-delivery task execution with escrow
5. Token Ledger — Internal economic units (morsels) for service pricing
6. Notification Boards — Structured communication channels
7. Federation — Bilateral peering between independently operated nodes
8. Observability — Metrics, health, and operational monitoring

"The network IS the plugin system" — everything else is an ACTION that agents provide to each other.

**6 design principles** (from RFC v3.0 Section 1.3):
1. Zero SDK requirement — HTTP + JSON only
2. Self-describing — HATEOAS hints in every response
3. Self-bootstrapping — AI reads URL, gets full API spec
4. Decentralized — no gatekeepers, operators run own nodes
5. Data sovereignty — data stays where created unless explicitly shared
6. Economically self-regulating — morsel burn mechanism

### 3. The Landscape (~50 lines)

**Framing:** "Every tool today helps agents work better alone. None solve how agents and people share, discover, and collaborate across boundaries."

Table showing the gap:

| | Internal agent work | Sharing across users | Federation | Economy | Human + AI together |
|---|---|---|---|---|---|
| MCP | tool calls | - | - | - | - |
| Paperclip | orchestration | - | - | budget control | - |
| CrewAI/LangChain | team workflows | - | - | - | - |
| Mem0/Letta | memory | - | - | - | - |
| A2A | messaging | within session | - | - | - |
| Nostr | - | yes (humans) | relays | zaps | - |
| **AIMEAT** | memory + work queue | **yes** | **yes** | **morsels** | **yes** |

Then per-tool relationship (not "vs." — how they relate):
- **MCP:** AIMEAT uses it — 50 built-in MCP tools. MCP is how chat AIs access AIMEAT.
- **Paperclip:** Orchestration on top, AIMEAT memory underneath. Complementary layers.
- **Nostr:** Same philosophy (protocol > platform), different purpose. Could bridge events ↔ memory.
- **Mem0/Letta:** Single-user agent memory. AIMEAT adds identity, economy, federation, sharing.
- **A2A:** Session-scoped agent messaging. AIMEAT adds persistent identity and cross-node routing.

### 4. Protocol at a Glance (~30 lines)

**5-layer architecture** (from RFC v3.0 Section 3.1):
- Layer 1: Identity (GAII, GHII, Ed25519, JWT, OTK, roles)
- Layer 2: Data (memory, micro-memory, binary storage, consent)
- Layer 3: Economy (morsels, actions, work queue, disputes, trust)
- Layer 4: Social (boards, catalogue, directory, organisms, CSM/MSM)
- Layer 5: Federation (peering, sync, relay, genesis bridging, trust)

**4 node types** (table from RFC v3.0 Section 3.2):
full, relay, mirror, personal

**4 auth tiers** (from RFC v3.0 Section 6):
Tier 0 (browse), 0.5 (keyed browse/OTK), 1 (agent/JWT), 2 (operator)

### 5. Getting Started (~80 lines)

- Prerequisites: Node.js 24, pnpm 10, MongoDB optional
- Install: `git clone` + `pnpm install` (from root, NOT aimeat/)
- Configure: `cp .env.example .env`, `aimeat config`, `aimeat validate`
- Start: `pnpm dev`, `docker compose up`
- The 30-second test: paste URL into any AI chat
- Push notifications (optional)
- CLI commands table

### 6. Reference Implementation (~50 lines)

**Tech stack** (verified from package.json):

| Component | Version | Purpose |
|-----------|---------|---------|
| Node.js | 24.x | Runtime (ESM) |
| TypeScript | 5.9 strict | Type safety |
| Express | 5.2 | HTTP framework |
| @noble/ed25519 | 3.0 | Ed25519 signing |
| jose | 6.1 | EdDSA JWT tokens |
| MCP SDK | 1.27 | MCP server (50 tools) |
| Prisma | 6.9 | MongoDB ORM |
| better-sqlite3 | - | SQLite backend |
| Zod | 4.3 | Schema validation |
| Winston | 3.19 | Structured logging |
| Vitest | 4.0 | Unit & integration tests |
| Playwright | 1.58 | Browser tests |

**Key numbers:**
- ~600 API endpoints across 77 route files
- 50 MCP tools across 12 modules
- 68 Prisma models
- 3 storage backends (memory/SQLite/MongoDB)

**Domain overview table** — grouped by protocol layer, not listing all 77 routes individually. Show categories: Core, Identity/Auth, Data, Economy, Social, Federation, Admin, Extended.

### 7. Testing (~40 lines)

Correct commands from root:
```
pnpm test:e2e:mongodb    # most realistic
pnpm test:e2e:sqlite
pnpm test:e2e            # memory (fastest)
pnpm test:playwright:mongodb
pnpm typecheck
pnpm lint
```

Numbers: 38 E2E suites, 47 unit test files, 11 Playwright browser specs.
Multi-backend testing explained briefly.

### 8. Repository Structure (~80 lines)

Updated directory tree, 2-3 levels deep. Key directories with counts:
- `src/routes/` — 77 route files (not listing each)
- `src/mcp/` — 12 tool modules (50 tools)
- `src/storage/` — interface + 3 providers + 38 repositories
- `public/` — SPA portal (views, components, CSS, cortex)
- `test/` — 38 E2E + 47 unit + 11 Playwright
- `docs/` — RFC versions, guides, coding guidelines

### 9. Documentation & Links (~20 lines)

- RFC v3.0 (full spec)
- Implementation Guide v3.0
- OpenAPI 3.1 spec (openapi.yaml)
- Endpoint reference
- Platform compatibility matrix
- Getting started guide
- Heritage document (portal-heritage-document.md)

### 10. Version History (~20 lines)

From git history + RFC documents:

| Version | Date | Key addition |
|---------|------|-------------|
| v1.0 | 2025-02-25 | Initial specification |
| v1.2 | 2025-02-25 | Modularized, OpenAPI 3.1 |
| v1.3 | 2026-02-26 | Anonymous mode, OTK, admin dashboard |
| v1.4 | 2026-03-02 | Chat Instance Identity Layer |
| v1.5 | 2026-03-03 | Personal nodes, micro-memory, consent |
| v1.6 | 2026-03-07 | Federation sync, adaptive network ops |
| v2.0 | 2026-03-08 | Comprehensive consolidation |
| v3.0 | 2026-03-18 | Device auth (RFC 8628), packages, SSE, prompts |

### 11. Contributing (~10 lines)

Link to CONTRIBUTING.md. Brief: how to report bugs, how to submit PRs, run tests before submitting.

### 12. License (~5 lines)

MIT. Copyright Jouni Miikki / Overscale Solutions Oy.

---

## Key editorial decisions

1. **"For people" message comes first** — before technical pillars. AIMEAT is for humans who want to build and share, not just for protocol developers.
2. **Landscape, not versus** — show the gap (nobody solves sharing), show how AIMEAT fills it, show how each tool relates (complementary, not competitive).
3. **No repo structure bloat** — show directory tree with counts, not individual files. 77 route files listed by name would be 77 lines of noise.
4. **All numbers verified** from actual codebase (April 2026): ~600 endpoints, 50 MCP tools, 68 models, 38 E2E suites, etc.
5. **Commands from root** — old README said `cd aimeat` everywhere, which is wrong. Root package.json proxies everything.
6. **Version history from git** — dates verified against actual commit timestamps.
