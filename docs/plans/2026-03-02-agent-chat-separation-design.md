# Agent vs Chat Instance Separation — Design Document

**Date:** 2026-03-02
**Status:** Approved
**Relates to:** GHII Identity Plan, AIMEAT RFC v1.3

---

## 1. Problem

Currently, all AI entities in AIMEAT are treated as **agents** (`AgentRecord` with GAII). This includes:

- **Autonomous agents** (e.g., OpenClaw) — truly independent AI actors
- **AI Chat sessions** (Claude, ChatGPT, Grok, Copilot, Gemini, etc.) — human-operated tools

This is conceptually wrong. A human using Claude to write memory is not an "agent" — they're a human using a tool. The system conflates two fundamentally different actor types:

| | Autonomous Agent | AI Chat Instance |
|---|---|---|
| **Actor** | AI acts independently | Human directs AI |
| **Identity** | GAII (Global AI Identifier) | Chat Instance ID |
| **Economy** | Own trust score + morsel balance | Inherited from GHII |
| **Autonomy** | Full — makes own decisions | None — follows human commands |
| **Example** | `openclaw001#jouni@node` | `claude-myapp#jouni@node` |

## 2. Solution: Separate Entity Type

Introduce `ChatInstanceRecord` as a new entity type alongside `AgentRecord`. Both use the same `agent#owner@node` syntax but are stored and tracked separately.

### 2.1 Identity Format

Same GAII syntax, different semantics:

```
Agents (GAII):     openclaw001#jouni@aimeat-finland-001-genesis
Chat (logged in):  claude-myapp#jouni@aimeat-finland-001-genesis
Chat (anonymous):  anon-claude-1709337600#anonymous@aimeat-finland-001-genesis
```

### 2.2 Anonymous GHII

The system automatically creates an `anonymous` GHII (`anonymous@node-id`) at startup:
- Not owned by any individual person
- Exists as a system-level identity for anonymous chat sessions
- All anonymous chat instances are linked to this GHII
- Has its own (shared) trust score and morsel balance

### 2.3 Economy

Chat instances do NOT have their own trust score or morsel balance. They inherit from their linked GHII:

- **Logged-in user:** `claude-myapp#jouni@node` → economy from `jouni@node` GHII
- **Anonymous:** `anon-claude-1709337600#anonymous@node` → economy from `anonymous@node` GHII

## 3. Data Model

### 3.1 ChatInstanceRecord (NEW)

```typescript
export interface ChatInstanceRecord {
  id: string;              // Full identifier: "claude-myapp#jouni@node" or "anon-claude-1709337600#anonymous@node"
  platform: string;        // "claude" | "chatgpt" | "grok" | "copilot" | "gemini" | ...
  appName: string;         // App name or "anon-<timestamp>" for anonymous
  ownerName: string;       // "anonymous" or username
  ghii: string;            // Always set: "anonymous@node" or "username@node"
  nodeId: string;          // Node where this instance operates
  isAnonymous: boolean;    // true = anonymous session
  createdAt: string;       // ISO timestamp — session start
  lastSeen: string;        // ISO timestamp — last activity
}
```

### 3.2 GHIIRecord Extension

Add fields already documented in GHII plan but not yet implemented:

```typescript
// Add to existing GHIIRecord:
trustScore: number;        // Aggregate trust score (0-100)
morselBalance: number;     // Morsel wallet balance
```

### 3.3 Storage Interface Methods (NEW)

```typescript
// Chat instance CRUD
createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord>;
getChatInstance(id: string): Promise<ChatInstanceRecord | null>;
listChatInstances(opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]>;
updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null>;
deleteChatInstance(id: string): Promise<boolean>;
```

## 4. Affected Components

### 4.1 Storage Layer

| File | Change |
|------|--------|
| `src/storage/interface.ts` | Add `ChatInstanceRecord`, extend `GHIIRecord`, add CRUD methods |
| `src/storage/memory.ts` | Implement ChatInstance CRUD with new `Map<string, ChatInstanceRecord>` |
| `src/storage/mongodb.ts` | Implement ChatInstance CRUD with new collection |

### 4.2 Routes & Prompts

| File | Change |
|------|--------|
| `src/routes/prompts.ts` | Change `shared#anonymous@node` GAII to chat instance ID format (`anon-<platform>-<timestamp>#anonymous@node`) |
| `src/routes/ghii.ts` | On login, create chat instance instead of agent for chat sessions |
| `src/routes/portal.ts` | Show agents and chat instances separately in stats |
| `src/routes/portal-human.ts` | Display chat sessions separately from agents |

### 4.3 Auth Middleware

| File | Change |
|------|--------|
| `src/auth/middleware.ts` | Recognize chat instance tokens (same JWT, different `type` claim) |

### 4.4 Bootstrap / Init

| File | Change |
|------|--------|
| `src/routes/bootstrap.ts` | Create `anonymous` GHII at node startup |
| `src/cli/init-wizard.ts` | Add anonymous chat config option |

### 4.5 Utils

| File | Change |
|------|--------|
| `src/utils/gaii.ts` | Add `buildChatInstanceId()` and `parseChatInstanceId()` functions |

## 5. API Behavior

### 5.1 Same APIs, Different Identity

Chat instances use the same endpoints as agents:
- `GET/POST /v1/memory` — read/write memory
- `GET /v1/mm` — micro-memory operations
- `GET /v1/memory/search` — search

The difference is in the identity attached to actions:
- Agent actions show GAII: `openclaw001#jouni@node`
- Chat actions show chat instance ID: `claude-myapp#jouni@node`

### 5.2 Statistics Separation

Portal and admin endpoints show separate counts:
- "3 agents" (autonomous GAII entities)
- "12 chat sessions" (human-operated AI tools)

### 5.3 Chat Instance Endpoints (NEW)

```
POST   /v1/chat-instances          — Register a new chat session
GET    /v1/chat-instances          — List chat instances (filterable by owner, platform)
GET    /v1/chat-instances/:id      — Get chat instance details
PUT    /v1/chat-instances/:id      — Update (e.g., lastSeen)
DELETE /v1/chat-instances/:id      — End chat session
```

## 6. Migration

### 6.1 Existing Data

Current `shared#anonymous@node` agent entries in memory should continue to work. No migration needed for existing memory keys — the change is forward-looking.

### 6.2 Backward Compatibility

The old `shared#anonymous@node` GAII remains valid for legacy prompts but new sessions create proper chat instance IDs.

## 7. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entity type | Separate `ChatInstanceRecord` | Cleaner than overloading `AgentRecord` with a `type` field |
| Anonymous handling | System-level `anonymous@node` GHII | No truly anonymous entities — everything links to a GHII |
| Economy | Inherited from GHII | Chat instances are tools, not economic actors |
| API access | Same endpoints as agents | Human using Claude should have same capabilities |
| ID format | Same `agent#owner@node` syntax | Consistent, parseable, reusable utilities |
