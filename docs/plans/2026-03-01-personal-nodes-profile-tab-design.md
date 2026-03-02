# Personal Nodes Profile Tab — Design Document

**Date:** 2026-03-01
**Status:** Approved

---

## Overview

Add a "Nodes" tab to the user profile page (`/v1/profile`) that lets users view, register, and manage their personal nodes. Each node can be configured as **private** (hidden from federation) or **public** (discoverable in the directory). Users can have multiple personal nodes, each displayed as an expandable card in its own section.

---

## Architecture

### Frontend (Server-rendered HTML in `profile.ts`)

**New tab:** "Nodes" added between Federation and Access in the tab bar.

**Panel structure:**

```
panel-nodes
├── Section title + description
├── [+ Add Node] button (toggles inline form)
├── Add Node form (hidden by default)
│   ├── Node ID input (prefixed personal-)
│   ├── Visibility selector (Private / Public)
│   ├── Agent GAIIs input (comma-separated)
│   └── Register button
├── Node cards list
│   ├── Node card 1 (collapsed)
│   │   ├── Status dot + node ID + visibility badge
│   │   ├── Quick stats (agents, mailbox items)
│   │   └── Click to expand →
│   │       ├── Tunnel URL (with copy button)
│   │       ├── Agent list
│   │       ├── Mailbox stats (items, used/quota)
│   │       ├── Last seen
│   │       ├── Visibility toggle (Private ↔ Public)
│   │       ├── Setup instructions (collapsible)
│   │       └── Detach button (with confirm)
│   └── Node card 2 (collapsed) ...
└── Empty state (no nodes registered)
```

### Backend Changes

1. **Storage interface** (`src/storage/interface.ts`):
   - Add `visibility: 'private' | 'public'` to `PersonalNodeRecord`

2. **In-memory storage** (`src/storage/memory.ts`):
   - Include `visibility` field in CRUD operations

3. **MongoDB storage** (`src/storage/mongodb.ts`):
   - Include `visibility` field in CRUD operations

4. **Schema** (`src/models/schemas.ts`):
   - Add `visibility` to `AnchorRequestSchema` (optional, defaults to `'private'`)

5. **Routes** (`src/routes/personal.ts`):
   - Accept `visibility` in `POST /v1/personal/anchor`
   - Add `PATCH /v1/personal/anchor/:nodeId` for updating visibility
   - Return `visibility` in all responses

6. **Federation** (`src/routes/federation.ts`):
   - Filter out `visibility: 'private'` nodes from directory listing

7. **GAII resolution** (`src/services/federation.ts`):
   - Private nodes: only resolve if the requesting agent belongs to the same owner
   - Public nodes: resolve normally

### Data Model Change

```typescript
interface PersonalNodeRecord {
  // ... existing fields ...
  visibility: 'private' | 'public';  // NEW — defaults to 'private'
}
```

### API Changes

**POST /v1/personal/anchor** — New optional field:
```json
{ "visibility": "private" }
```

**PATCH /v1/personal/anchor/:nodeId** — New endpoint:
```json
{ "visibility": "public" }
```

### i18n

~40 new translation keys for English and Finnish covering:
- Tab label, section title/description
- Node card labels (status, agents, mailbox, tunnel, visibility)
- Add form labels and buttons
- Setup instructions text
- Empty/loading/error states
- Confirmation dialogs

---

## UI/UX Details

### Stats Bar
Add a "Nodes" stat card showing total personal node count.

### Node Card (Collapsed)
```
┌────────────────────────────────────────────────────┐
│ 🟢 personal-jouni-laptop         [Private] ONLINE │
│   2 agents │ Mailbox: 0 items              ▼      │
└────────────────────────────────────────────────────┘
```

### Node Card (Expanded)
```
┌────────────────────────────────────────────────────┐
│ 🟢 personal-jouni-laptop         [Private] ONLINE │
│   2 agents │ Mailbox: 0 items              ▲      │
│ ┌────────────────────────────────────────────────┐ │
│ │ Tunnel URL: wss://op.../tunnel        [Copy]   │ │
│ │                                                │ │
│ │ Agents:                                        │ │
│ │   bot1#jouni@aimeat-fi-001                       │ │
│ │   bot2#jouni@aimeat-fi-001                       │ │
│ │                                                │ │
│ │ Mailbox: 0 items (0 / 50 MB)                   │ │
│ │ Last seen: 2 minutes ago                       │ │
│ │                                                │ │
│ │ Visibility: [Private ●] [Public ○]             │ │
│ │                                                │ │
│ │ ▶ Setup Instructions                           │ │
│ │                                                │ │
│ │ [Detach Node]                                  │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

### Setup Instructions (Expanded)
Inline collapsible section showing:
1. How to connect via WebSocket tunnel (URL + auth)
2. Heartbeat requirements (every 30s)
3. Mailbox sync on reconnect
4. Link to full documentation

### Add Node Form
```
┌────────────────────────────────────────────────────┐
│ Register a Personal Node                           │
│                                                    │
│ Node ID:    [personal-____________]                │
│ Visibility: (●) Private  (○) Public                │
│ Agent GAIIs: [agent1#me, agent2#me_______]         │
│                                                    │
│ [Register]  [Cancel]                               │
└────────────────────────────────────────────────────┘
```

---

## Constraints

- Server-rendered HTML (inline CSS/JS in profile.ts) — no SPA framework
- Must match existing dark theme with pink accents (CSS variables)
- Must support English + Finnish i18n
- Must use existing `apiFetch()` pattern for authenticated API calls
- Node IDs must match `^personal-[a-z0-9-]{3,64}$`
- Expandable cards follow the same interaction pattern as the existing agents/memory sections
