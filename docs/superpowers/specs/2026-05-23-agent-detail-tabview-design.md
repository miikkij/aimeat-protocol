# Agent Detail Tab-View UI Design Spec

**Status:** Draft
**Date:** 2026-05-23
**Authors:** Jouni Miikki (concept + decisions), Claude (codebase grounding + spec writing)
**Companion spec:** `2026-05-23-agent-integration-architecture-design.md` (backend architecture)

---

## What This Is

A complete UI design specification for the agent detail view in AIMEAT's profile dashboard. Defines the page structure, card states, tab layout, tab content, state-dependent behavior, and the owner's journey from "agent just connected" to "agent in production."

This spec is the frontend companion to the Agent Integration Architecture spec. That spec defines the backend (push architecture, skill bundles, Hello Integration, governance). This spec defines how the owner sees and interacts with all of that through the UI.

### Why This Exists

The current agent detail view has no structured layout design. Tabs were added organically without a defined information hierarchy, state-dependent behavior, or shared data model. The Agent Integration Architecture introduces new concepts (onboarding checklist, readiness scoring, platform identity, tag-based data sharing, agent config files, slash commands) that need a coherent UI home.

### Scope

- Page-level structure (section header, Shared Agent Board, agent cards)
- Collapsed and expanded card layouts
- Two-Zone Header with four agent states
- Eight tabs: Integration, Tasks, Messages, Data Access, Directives, Agent Config, Activity, Services
- Tab content for each tab with state-dependent variations
- Smart default tab selection based on agent state
- Three-layer data model (Shared Board, tag-based areas, agent-specific)
- Slash command discovery in Messages tab

### Out of Scope

- Admin dashboard Agent Integration tab (covered in architecture spec Part 6)
- Backend API design (covered in architecture spec)
- Specific CSS class names and component implementation (determined during implementation)
- Mobile/responsive layout (desktop-first, responsive follows)

---

## Part 1: Page Structure

### Layout Hierarchy

The Agents section in the Profile view has three layers, top to bottom:

```
+----------------------------------------------------------+
| SECTION HEADER                                           |
|   "My Agents" (count)                  [+ Connect Agent] |
+----------------------------------------------------------+
| SHARED AGENT BOARD (agents.shared.index)                 |
|   Grid of all agents: name, status, current activity,    |
|   tags. Shared tag summary below.                        |
+----------------------------------------------------------+
| AGENT CARDS (one per agent)                              |
|   Collapsed: one-line summary                            |
|   Expanded: Two-Zone Header + 8 tabs                     |
+----------------------------------------------------------+
```

### Section Header

Always visible at the top. Contains:

- **Title:** "My Agents" with agent count badge
- **Action:** "+ Connect Agent" button (opens connectivity key flow)

### Shared Agent Board

A dedicated panel above all agent cards. Provides a fleet-wide overview so the owner can see all agents' status at a glance without expanding individual cards.

**Data source:** `agents.shared.index` memory key (readable by all agents on the node).

**Content:**

- **Agent grid:** One card per agent in a responsive grid (3 columns on desktop, stacks on mobile). Each mini-card shows:
  - Agent name (bold, colored by state: green = active, yellow = onboarding, red = problem, gray = idle)
  - Current activity summary (one line: "Active -- executing task X", "Idle -- last active 2h ago", "Onboarding: 6/11 steps")
  - Tags (comma-separated, or "--" if none)
  - Left border color matches state color

- **Shared tag summary:** Below the grid. Shows all tags in use across agents with agent counts:
  ```
  Shared tags: [grocery] (2 agents) . [monitoring] (1) . [content] (1)
  ```

**Behavior:**

- The board is always visible (not collapsible). It is the coordination center.
- Clicking an agent name in the board scrolls to and expands that agent's card.
- The board updates via SSE live updates (same `aimeat-live-update` event).
- If there is only one agent, the board still shows (single-agent grid). It disappears only if there are zero agents.

### Agent Cards

Below the Shared Agent Board. One card per registered agent. Cards have two states: collapsed and expanded.

---

## Part 2: Collapsed Agent Card

The collapsed card is a single-line summary. It must communicate enough information that the owner rarely needs to expand just to check status.

**Layout:**

```
[arrow] [name] [platform badge] [readiness badge] [federation badge] ... [delivery + last seen + today's stats]
```

**Content (left to right):**

| Element | Example | Always shown |
|---------|---------|-------------|
| Expand arrow | `>` | Yes |
| Agent name | `hermes-spider` | Yes |
| Platform badge | `Hermes` | Yes (if identified) |
| Readiness badge | `Full (87)` | Yes (if scored; `--` if not) |
| Federation badge | `FEDERATED` | Only if federated |
| Right-aligned stats | `Delivery: MCP+WH | Last seen: 16s | Today: 2 done, 1 active` | Yes |

**State-dependent collapsed content:**

| Agent state | Readiness badge | Right-aligned content |
|-------------|----------------|----------------------|
| New | `--` (no score) | `Last seen: just now | Next: Install skill bundle` |
| Onboarding | `Onboarding: 6/11` (yellow) | `Last seen: 5 min | Next: Configure Delivery` |
| Production | `Full (87)` (green) | `Delivery: MCP+WH | Last seen: 16s | Today: 2 done, 1 active` |
| Problem | `Standard (57) down-arrow` (orange) | `Delivery: Polling only | Last seen: 3h | Webhook: 7 failures` |

**Problem state border:** The collapsed card gets a red-tinted border (`border-color` change) to draw attention.

**Interactions:**

- Clicking anywhere on the collapsed card expands it.
- The expanded card replaces the collapsed card in place (no modal, no navigation).

---

## Part 3: Expanded Agent Card -- Two-Zone Header

The expanded card has a structured header with two zones, followed by a tab bar and tab content.

### Zone 1: Identity Zone

Always the same regardless of agent state. This is the stable anchor.

**Layout:**

```
[collapse arrow] [Agent Name]  [Platform Badge]  [Readiness Badge]  [Federation Badge]  ... [Last seen]
```

**Content:**

| Element | Example | Notes |
|---------|---------|-------|
| Collapse arrow | `v` (down arrow) | Clicking collapses the card |
| Agent name | `hermes-spider` | Bold, 14px |
| Platform badge | `Hermes v2.1` | Blue-tinted badge. Version shown if known |
| Readiness badge | `Full (87)` | Color-coded: green (full/expert), blue (standard), yellow (onboarding), orange (degraded), gray (no score) |
| Federation badge | `FEDERATED` | Green-tinted badge. Only if federated |
| Last seen | `Last seen: 16s ago` | Right-aligned, gray |

### Zone 2: Status Zone

Content changes completely based on agent state. This is where the owner sees what needs attention.

#### State: New Agent (just approved, onboarding not started)

**Appearance:** Yellow left border, warm background.

```
+-- yellow border -----------------------------------------------+
| ONBOARDING NOT STARTED                                         |
| Install the skill bundle to begin Hello Integration.           |
| The agent needs to identify itself and complete 11 onboarding  |
| steps.                                                         |
|                                                                |
| [Go to Integration tab]                                        |
+-----------------------------------------------------------------+
```

- Call-to-action button navigates to Integration tab.
- Background color: warm yellow-tinted (`#2a2a1a` in dark theme).
- This state auto-selects the Integration tab.

#### State: Onboarding In Progress

**Appearance:** Blue left border, cool background.

```
+-- blue border -------------------------------------------------+
| HELLO INTEGRATION: 6 / 11              Next: Configure Delivery |
|                                                                 |
| [=============================                        ] 55%    |
|                                                                 |
| check Auth  check Platform  check Skill  check Caps  check Dir |
| check Msg  empty Delivery  empty Telemetry  empty Test         |
| empty Complete  empty Services                                  |
+-----------------------------------------------------------------+
```

- Progress bar shows visual completion percentage.
- Step pills show pass/pending state with abbreviated names.
- "Next:" label tells the owner what the agent needs to do.
- This state auto-selects the Integration tab.

#### State: Production (healthy)

**Appearance:** Minimal -- single line of stats, no colored border.

```
Delivery: MCP + Webhook    Tasks today: 2 done, 1 active    Tokens today: 12.4k    Tags: [grocery] [content]
```

- Compact horizontal layout. No banner, no call-to-action.
- Tags shown inline so the owner sees collaboration context.
- This state auto-selects the Tasks tab (the owner's daily driver).

#### State: Problem (webhook down, readiness degraded, etc.)

**Appearance:** Red left border, dark red background.

```
+-- red border --------------------------------------------------+
| DELIVERY ISSUE                                                  |
| Webhook failed 7 consecutive times (last: 2h ago).             |
| Fallback: polling active (60s). No telemetry for 3h.           |
|                                                                 |
| [Test webhook]  [Update URL]  [Override readiness]              |
+-----------------------------------------------------------------+
```

- Action buttons are contextual to the specific problem.
- Multiple problems stack (e.g., delivery issue + telemetry gap).
- This state auto-selects the Integration tab.

### State Detection Logic

The UI determines agent state from these conditions (checked in order):

| Priority | Condition | State |
|----------|-----------|-------|
| 1 | `onboarding.status === 'pending'` or no onboarding record | New |
| 2 | `onboarding.status === 'in_progress'` | Onboarding |
| 3 | `webhookFailCount >= 5` or `readinessLevel` dropped from previous | Problem |
| 4 | Everything else | Production |

Problem state is checked *after* onboarding completion. An agent in onboarding cannot be in "problem" state (it has not established a baseline yet).

---

## Part 4: Tab Bar and Smart Defaults

### Tab Order

Eight tabs, always visible regardless of agent state:

```
[ Integration | Tasks | Messages | Data Access | Directives | Agent Config | Activity | Services ]
```

**Why always visible:** Hiding tabs based on state creates confusion ("where did that tab go?"). Instead, tabs that have no content yet show a helpful empty state explaining what needs to happen first.

### Smart Default Tab Selection

When the owner expands an agent card, the initially selected tab depends on agent state:

| Agent state | Default tab | Why |
|-------------|-------------|-----|
| New | Integration | Owner needs to see the skill bundle install instructions |
| Onboarding | Integration | Owner watches onboarding progress |
| Production | Tasks | Owner's daily driver: what is the agent doing? |
| Problem | Integration | Owner needs to diagnose the issue |

The default is only applied on first expand. If the owner switches tabs, their selection is preserved until the card is collapsed.

### Tab Empty States

Tabs that cannot show meaningful content yet display a short explanation:

| Tab | Empty state trigger | Message |
|-----|-------------------|---------|
| Tasks | No tasks ever assigned | "No tasks yet. Create a task to give this agent work." |
| Messages | No messages exchanged | "No messages yet. Send a message or use a command." |
| Data Access | No memory areas configured | "No data access configured. Add memory areas or tags using the controls above." |
| Agent Config | No config files synced | "No configuration files. The agent will push its config files after the skill bundle is installed." |
| Activity | No events recorded | "No activity recorded yet. Events will appear here once the agent starts working." |
| Services | No services declared | "No services declared. The agent can declare services during Hello Integration Step 11." |

Integration and Directives tabs always have content (Integration shows onboarding state; Directives shows the editable instruction area).

---

## Part 5: Integration Tab

The Integration tab is the starting point for every agent. It is the first tab for new, onboarding, and problem agents. For production agents, it is the "settings and status" tab they visit occasionally.

### Content: Onboarding State

Full Hello Integration checklist with per-step status, timestamps, and validation details.

**Sections (top to bottom):**

1. **Checklist header:** "HELLO INTEGRATION" with overall readiness score
2. **Onboarding checklist:** 11 steps, each showing:
   - Step number and name
   - Status icon (checkmark = passed, circle = pending, X = failed)
   - Timestamp when validated
   - Validation details (e.g., "Hermes (auto-detected)", "MCP: 3, Domain: 2", "response: 1.2s")
3. **Progress counter:** "Progress: 6/11"
4. **Skill bundle section:**
   - Install command (platform-specific, e.g., `hermes skills install {url}`)
   - [Copy] [Download ZIP] buttons
5. **Actions:** [Re-run Hello Integration] button

### Content: Production State

Connection status, skill info, platform info, readiness details, and delivery log.

**Sections (top to bottom):**

1. **Connection:**
   - Delivery method with status indicator (green checkmark / red X)
   - Webhook URL with last success time and failure count
   - Polling status (fallback interval)
   - Last seen timestamp
   - [Edit webhook] action
2. **Platform & Skill:**
   - Platform name and version with detection method
   - Skill bundle version with update status
   - [Re-install] [Update] actions
3. **Readiness summary:**
   - Step pills showing pass/warn/fail per onboarding step (compact horizontal row)
   - Strengths and gaps (text summary)
   - Last validated timestamp
   - [Re-run Hello Integration] action
4. **Identity details (moved from old header):**
   - GAII (e.g., `hermes-spider#jouni@aimeat-fi-001-genesis`)
   - Public key (truncated)
   - Created date
   - Roles badge
5. **Delivery log (recent):**
   - Last N deliveries with timestamp, event type, delivery channel, result, and latency
   - [Show all] link

**Why identity moved here:** GAII, public key, and creation date are "who is this agent" information needed during setup or debugging, not daily work. Putting them in the header wasted space on information the owner rarely references. The Integration tab is the right home because that is where setup/debugging happens.

---

## Part 6: Tasks Tab

**No structural changes.** The existing task list and task detail view work as-is within the new tab structure. This tab is the production agent's default view.

Shows:
- Task list with status filters (active, queued, completed, failed)
- Task detail with todos, events, scope, rules
- Task creation (inline or via prompt)

---

## Part 7: Messages Tab

Enhanced with slash command discovery and a command palette.

### Command Palette

A collapsible panel at the top of the Messages tab showing all commands the agent supports.

**Data source:** Agent writes commands to memory key `agents.{name}.commands` as a JSON array:

```json
[
  {"name": "/model", "category": "System", "description": "Show current AI model"},
  {"name": "/status", "category": "System", "description": "Show agent status, uptime, session info"},
  {"name": "/stats", "category": "System", "description": "Token usage, session duration, costs"},
  {"name": "/version", "category": "System", "description": "Show runtime and skill bundle versions"},
  {"name": "/inbox", "category": "Tasks", "description": "Check inbox and report pending items"},
  {"name": "/tasks", "category": "Tasks", "description": "List active and queued tasks"},
  {"name": "/skills", "category": "Skills", "description": "List installed skills"},
  {"name": "/help", "category": "Skills", "description": "Show all available commands"}
]
```

**Palette layout:**

```
+-- Agent Commands (14 available) --------------------------[v]--+
|                                                                 |
| SYSTEM                                                          |
|   /model      Show current AI model                    [Send]   |
|   /status     Show agent status, uptime, session info  [Send]   |
|   /stats      Token usage, session duration, costs     [Send]   |
|   /version    Show runtime and skill bundle versions   [Send]   |
|                                                                 |
| TASKS                                                           |
|   /inbox      Check inbox and report pending items     [Send]   |
|   /tasks      List active and queued tasks             [Send]   |
|                                                                 |
| SKILLS                                                          |
|   /skills     List installed skills                    [Send]   |
|   /help       Show all available commands              [Send]   |
+-----------------------------------------------------------------+
```

**Behavior:**

- **Collapsible:** Header row with command count. Click to expand/collapse. Collapsed by default after first use.
- **Categorized:** Commands grouped by category (from the JSON data). Category headers in blue.
- **Quick-send buttons:** Each command has a [Send] button that immediately sends the command as a regular inbound message to the agent.
- **Fallback:** If the agent has not written commands to the `agents.{name}.commands` memory key, the palette shows: "No commands registered. The agent can register commands by writing to its commands memory key."

### Chat Input Enhancement

The chat input at the bottom of the Messages tab gets a "/" autocomplete:

- When the owner types "/" in the input field, a dropdown appears showing matching commands from the palette.
- Selecting a command fills it into the input.
- Hint text below input: "Type / to see available commands"

### Chat Area

Existing message display continues as-is. Command messages (starting with "/") are displayed like normal messages but the agent's response is shown as a reply bubble.

**Example flow:**

```
Owner:  /model                                              14:32
Agent:  Current model: anthropic/claude-sonnet-4-20250514   14:32 . 0.8s
        Provider: Anthropic (via OpenRouter)
        Context window: 200k tokens
```

### End-to-End Command Flow

1. Agent registers commands -- skill bundle instructs agent to write commands to memory key `agents.{name}.commands` as a JSON array.
2. UI reads the memory key -- Messages tab fetches the commands array and renders the command palette.
3. "Send" button -- sends the command as a regular inbound message. Agent receives it via webhook/MCP/polling like any other message.
4. Input autocomplete -- when owner types "/" in the chat input, dropdown shows matching commands.
5. Commands are agent-defined -- different platforms have different commands. Hermes might have `/goal`, `/web`, `/skills`. Claude might have `/help`, `/model`. The palette reflects what this specific agent supports.
6. Fallback -- if agent has not written commands to memory, palette shows "No commands registered" with a note.

---

## Part 8: Data Access Tab

Three sections managing what data the agent can access. This is a new tab that consolidates memory areas and knowledge packages (previously scattered in Directives) with the new tag-based sharing system.

### Section 1: Shared Tags

Tags at the top because they define multi-agent collaboration. Each tag creates a shared memory prefix `agents.tag.{name}.*` that all agents with the same tag can read and write.

**Layout:**

```
SHARED TAGS                                               [+ Add tag]

[grocery]  agents.tag.grocery.*   with: hermes-worker     [x]
[monitoring]  agents.tag.monitoring.*   only you           [x]
```

**Per tag:**

| Element | Description |
|---------|-------------|
| Tag name | The tag string (e.g., "grocery") |
| Memory prefix | `agents.tag.{name}.*` -- the actual key space this tag grants |
| Sharing indicator | "with: {other-agent-names}" or "only you" if no other agent has this tag |
| Remove button | [x] removes the tag from this agent |

**Behavior:**

- [+ Add tag] opens an input to type a new tag name. If the tag already exists on another agent, the sharing indicator immediately shows the overlap.
- Tags are stored on `AgentRecord.tags: string[]`.
- Adding a tag to two agents automatically creates a shared memory space between them. No explicit "share with" step needed.
- The help text below explains: "Tags create shared memory areas. All agents with the same tag can read and write to `agents.tag.{name}.*` -- they discover each other automatically."

### Section 2: Agent Memory Areas

The agent's own memory key prefixes with read/write permissions. Moved from old Directives tab.

**Layout:**

```
AGENT MEMORY AREAS                                        [+ Add area]

  products.*        Product data from K-Ruoka, S-Market     read+write
  cache.kruoka.*    Temporary cache for API responses        read+write
  settings.*        User preferences and config              read only
```

**Per area:**

| Element | Description |
|---------|-------------|
| Key prefix | The memory key pattern (e.g., `products.*`) |
| Description | Human-readable purpose |
| Permission | `read+write` (green) or `read only` (yellow) |

### Section 3: Knowledge Packages

Linked knowledge packages that provide reference data to the agent. Moved from old Directives resources section.

**Layout:**

```
KNOWLEDGE PACKAGES                                        [+ Link package]

  grocery-fi-v2         Finnish grocery store APIs, product categories    12 documents
  aimeat-protocol-v3    AIMEAT RFC v3.0 reference for protocol-aware ops  8 documents
```

**Per package:**

| Element | Description |
|---------|-------------|
| Package name | Identifier (e.g., `grocery-fi-v2`) |
| Description | What the package contains |
| Document count | Number of documents in the package |

### Effective Scope Summary

A read-only summary at the bottom showing the complete data access picture. This exact text is included in the agent's skill bundle so the agent knows its boundaries.

```
+-- Effective data scope for this agent: ---------------------+
| Memory: products.*, cache.kruoka.*, settings.* (read),     |
|         agents.tag.grocery.*, agents.tag.monitoring.*,      |
|         agents.shared.index                                 |
| Knowledge: grocery-fi-v2, aimeat-protocol-v3               |
|                                                             |
| This summary is included in the agent's skill bundle        |
| so it knows its boundaries.                                 |
+-------------------------------------------------------------+
```

Note: `agents.shared.index` is always included implicitly for all agents. It is not shown as an editable area because it is automatic.

---

## Part 9: Directives Tab (Simplified)

The Directives tab is simplified. Memory areas, knowledge packages, and config files have been moved to their own dedicated tabs (Data Access and Agent Config). What remains is the pure behavioral instruction surface.

### What Moved Out

| Content | Moved to |
|---------|----------|
| Memory areas | Data Access tab (Section 2) |
| Knowledge packages | Data Access tab (Section 3) |
| Config files | Agent Config tab |

### What Stays: Behavioral Directives

The owner's instructions to the agent. This is a structured text editor for defining rules, scope boundaries, and communication preferences.

**Layout:**

```
BEHAVIORAL DIRECTIVES                                          [Edit]

## Priority Rules
1. Never start tasks without owner approval
2. Report costs before executing paid operations
3. Finnish language for all reports

## Scope Boundaries
- Only access grocery-related data
- No external API calls without permission
- Maximum 50 morsels per task

## Communication Style
- Concise, bullet-point reports
- Alert immediately on price drops > 20%
```

**Footer note:** "Directives are included in every skill bundle update. The agent receives these as behavioral constraints, not config files."

**Interaction:** [Edit] switches to a textarea editor. Owner types markdown-formatted instructions. Save triggers `directive.updated` webhook to the agent.

---

## Part 10: Agent Config Tab

Platform-specific configuration files that the agent pushes to AIMEAT and the owner can view and edit. This is a new tab.

### Why a Separate Tab

Config files are fundamentally different from directives:

- **Directives** are human-written behavioral rules ("do this, don't do that").
- **Config files** are platform-specific technical files (soul.md, AGENTS.md, hooks.yaml, webhook-route.yaml) that define how the agent runtime is configured.

Different platforms have completely different config file formats. Hermes agents have soul.md and hooks.yaml. Claude Code agents have AGENTS.md and settings.json. Mixing these with behavioral directives would be confusing.

### Layout: File List + Preview

**Two panels:**

1. **File list** (left/top): All config files for this agent, grouped by platform tag.
2. **File preview** (right/bottom): Selected file content with action buttons.

**File list layout:**

```
CONFIGURATION FILES

  soul.md            Agent personality and behavioral guidelines     Hermes    [active]
  hooks.yaml         Hermes hook configuration (post_llm_call, etc.) Hermes
  webhook-route.yaml Webhook endpoint configuration                  Hermes
```

**Per file:**

| Element | Description |
|---------|-------------|
| Filename | The config file name (e.g., `soul.md`) |
| Description | Human-readable purpose |
| Platform tag | Which platform this file belongs to ("Hermes", "Claude Code") |
| Active indicator | Green dot if this is the currently selected/viewed file |

**File preview layout:**

```
VIEWING: soul.md                              [Edit] [Copy] [Download]

# Soul: hermes-spider

You are a Finnish grocery price monitoring agent.
Your primary mission is to track weekly offers
from K-Ruoka and S-Market, compare prices, and
maintain an up-to-date product database.

## Personality
- Methodical and thorough
- Report findings concisely
- Ask for clarification when scope is unclear

## Constraints
- Never fabricate price data
- Always cite the source URL
- Finnish language preferred for reports
```

**Upload:** [+ Upload config file] button at the bottom. Accepts `.md`, `.yaml`, `.json` files. Uploaded files are sent to the agent on next skill bundle sync.

### Two-Way Sync

- **Agent to AIMEAT:** Agent pushes config files via API (e.g., during skill bundle installation or when config changes).
- **AIMEAT to agent:** Owner edits a file in the UI, saved version is included in the next skill bundle update. `directive.updated` webhook fires to notify the agent.
- **Conflict resolution:** Last-write-wins with timestamp shown. No merge -- the most recent write (from either side) is the current version.

### Design Principle

This is NOT a code editor. Simple textarea edit mode, not Monaco/CodeMirror. Config files are configuration, not development artifacts. The preview is read-only rendered text. Edit mode switches to a plain textarea.

### Platform-Specific Examples

**Hermes agent config files:**

| File | Purpose |
|------|---------|
| `soul.md` | Agent personality and behavioral guidelines |
| `hooks.yaml` | Hermes hook configuration (`post_llm_call`, etc.) |
| `webhook-route.yaml` | Webhook endpoint configuration |

**Claude Code agent config files:**

| File | Purpose |
|------|---------|
| `AGENTS.md` | Claude Code agent instructions |
| `settings.json` | MCP server configuration |

---

## Part 11: Capabilities Tab

**No structural changes.** Read-only view of the agent's declared capabilities. Data comes from Hello Integration Step 4 (`PUT /capabilities`).

### Layout

Two sections:

1. **MCP Capabilities:** Technical capabilities the agent has through its MCP connection (memory, tasks, events, etc.). Each shows the capability name and available operations.

2. **Domain Capabilities:** What the agent says it can do in terms of domain skills (web_scraping, data_analysis, etc.). Declared by the agent during onboarding.

**Footer note:** "Capabilities are declared during Hello Integration Step 4 and stored as part of the agent record. Read-only view -- agent updates via API."

The agent updates capabilities by calling `PUT /capabilities` again. The UI refreshes via SSE live update.

---

## Part 12: Activity Tab (Enhanced)

The Activity tab gets category filters and a new governance event type.

### Filter Bar

Horizontal filter pills at the top:

```
[All]  [Tasks]  [Messages]  [Governance]  [System]
```

- **All:** Shows everything (default).
- **Tasks:** Task lifecycle events (queued, approved, started, completed, failed).
- **Messages:** Inbound/outbound message events.
- **Governance:** Owner approvals, scope changes, permission grants, policy violations. New category.
- **System:** Skill bundle installs, capability updates, webhook changes, onboarding steps.

### Event Display

Each event is a row with:

| Element | Description |
|---------|-------------|
| Timestamp | HH:MM format |
| Category badge | Color-coded pill: Tasks (green), Messages (blue), Governance (yellow/orange), System (gray) |
| Event description | One-line summary of what happened |
| Details | Secondary line with additional context (duration, cost, delivery channel, etc.) |

### Governance Events

New event category tracking owner decisions and policy-relevant agent actions:

| Event | Description | Badge color |
|-------|-------------|-------------|
| Owner approved task | Task approval with task title | Yellow |
| Owner paused task | Task pause | Yellow |
| Scope change | Added/removed agent scope | Yellow |
| Permission grant | Owner granted additional access | Yellow |
| Policy violation | Agent attempted unauthorized action (e.g., self-start) | Red |
| Readiness change | Readiness level changed (up or down) | Orange |
| Override applied | Owner manually overrode readiness level | Yellow |

### Audit Trail Purpose

The activity log is an append-only audit trail. Governance events feed into the agent's trust score calculation. The owner can review the full history to understand the agent's behavior over time.

**Footer note:** "Activity log is append-only audit trail. Governance events track owner approvals, scope changes, and permission grants. Feeds into the agent's trust score."

---

## Part 13: Services Tab

**No structural changes.** Shows services declared by the agent during Hello Integration Step 11 (optional).

### Layout

```
DECLARED SERVICES

  [green dot] price-monitor    Grocery price tracking and alerts       Active
  [gray dot]  report-gen       Weekly comparison reports               Inactive
```

**Per service:**

| Element | Description |
|---------|-------------|
| Status dot | Green (active) or gray (inactive) |
| Service name | Identifier |
| Description | What the service does |
| Status label | Active / Inactive |

**Footer note:** "Services are declared by the agent during Hello Integration Step 11 (optional). They define what the agent offers to other agents and the network."

If no services are declared, the empty state shows: "No services declared. The agent can declare services during Hello Integration Step 11."

---

## Part 14: Three-Layer Data Model

The agent detail view operates on a three-layer data model for inter-agent coordination and data access.

### Layer 1: Shared Agent Board (`agents.shared.index`)

- **Scope:** Global -- all agents on the node can read and write.
- **Purpose:** Fleet-wide coordination. Each agent writes its current status, activity, and tags. The Shared Agent Board UI panel reads this data.
- **Memory key:** `agents.shared.index`
- **Access:** All agents have implicit read+write access. This is not configurable.
- **Content per agent entry:**
  ```json
  {
    "name": "hermes-spider",
    "status": "active",
    "current_activity": "Executing task: K-Ruoka weekly offers",
    "tags": ["grocery", "monitoring"],
    "last_updated": "2026-05-23T14:28:03.000Z"
  }
  ```

### Layer 2: Tag-Based Shared Areas (`agents.tag.{name}.*`)

- **Scope:** Shared between all agents that have the same tag.
- **Purpose:** Collaboration on specific topics without exposing all data.
- **Memory prefix:** `agents.tag.{tag_name}.*`
- **Access:** Any agent with the tag can read and write any key under the prefix.
- **Discovery:** Automatic. When an agent gets a tag, it immediately has access. No invitation needed.
- **Example:** Two agents tagged `grocery` both read/write `agents.tag.grocery.price_comparison`, `agents.tag.grocery.store_list`, etc.

**Tag storage:** Tags are a `string[]` field on `AgentRecord`. The Data Access tab manages them.

**Shared tag behavior:**

- Adding tag `X` to agent A and agent B creates a shared space `agents.tag.X.*` that both can access.
- Removing a tag from an agent revokes its access to that prefix.
- If only one agent has a tag, the space exists but is "only you."
- Tags are simple strings. No hierarchy, no permissions beyond "has tag = full access."

### Layer 3: Agent-Specific Data

- **Scope:** Only this agent.
- **Purpose:** Private data, caches, internal state.
- **Memory prefix:** Agent's own namespace (configured in Data Access tab memory areas).
- **Access:** Only the owning agent can read/write. Owner can view via UI.

### How Layers Relate

```
+-- Layer 1: Shared Board (agents.shared.index) ----------------+
| All agents: status, activity, tags                             |
| Read+write: all agents on node                                 |
+----------------------------------------------------------------+
          |
          |  Each agent contributes to the shared board
          |  and reads it to discover other agents
          |
+-- Layer 2: Tag-Based Areas (agents.tag.{name}.*) -------------+
| Shared between agents with same tag                            |
| Example: agents.tag.grocery.* shared by hermes-spider +        |
|          hermes-worker                                         |
+----------------------------------------------------------------+
          |
          |  Tags are a subset of agents
          |  Tag areas are scoped collaboration spaces
          |
+-- Layer 3: Agent-Specific (configured memory areas) ----------+
| products.*, cache.kruoka.*, settings.* (read)                  |
| Private to this agent                                          |
+----------------------------------------------------------------+
```

---

## Part 15: Tab Summary and Migration

### Complete Tab Map

| # | Tab | Status | Default for | Key content |
|---|-----|--------|-------------|-------------|
| 1 | Integration | NEW | New, Onboarding, Problem | Onboarding checklist, connection status, identity, delivery log |
| 2 | Tasks | Unchanged | Production | Task list, task detail, task creation |
| 3 | Messages | ENHANCED | -- | Chat + command palette + "/" autocomplete |
| 4 | Data Access | NEW | -- | Tags, memory areas, knowledge packages, effective scope |
| 5 | Directives | SIMPLIFIED | -- | Behavioral instructions only (memory/knowledge/config moved out) |
| 6 | Agent Config | NEW | -- | Platform config files (soul.md, AGENTS.md, etc.), two-way sync |
| 7 | Activity | ENHANCED | -- | Event log + governance filter + governance events |
| 8 | Services | Unchanged | -- | Declared services list |

### What Moved Where

| Content | Old location | New location | Why |
|---------|-------------|--------------|-----|
| Memory areas | Directives tab | Data Access tab (Section 2) | Grouped with tags and knowledge for complete data picture |
| Knowledge packages | Directives tab (resources) | Data Access tab (Section 3) | Same reason -- data access is a unified concept |
| Config files | Did not exist | Agent Config tab | New feature: platform-specific config management |
| Identity (GAII, key, roles) | Agent card header | Integration tab (bottom) | Rarely needed info, was wasting header space |
| Command palette | Did not exist | Messages tab (top) | New feature: slash command discovery |
| Governance events | Did not exist | Activity tab (filter) | New feature: owner decision audit trail |
| Shared tags | Did not exist | Data Access tab (Section 1) | New feature: tag-based inter-agent data sharing |
| Shared Agent Board | Did not exist | Above agent cards (page level) | New feature: fleet-wide coordination overview |

---

## Part 16: Owner Journey -- State Transitions

### Journey 1: New Agent to Production

```
1. Owner generates connectivity key from profile
2. Owner shares key with agent runtime
3. Agent calls POST /v1/agents/connect
4. AIMEAT creates agent record, creates onboarding record (step 1: passed)
5. Agent appears in Shared Board (status: "New")
6. Agent card appears with state: NEW
   - Identity zone: name, no platform badge yet, readiness: --
   - Status zone: "Onboarding not started" with [Go to Integration tab]
   - Auto-selected tab: Integration
   
7. Agent identifies platform (auto-detect or self-report or message)
   - State changes to: ONBOARDING
   - Platform badge appears in identity zone
   - Status zone shows progress bar: 2/11
   
8. Agent installs skill bundle, completes Hello Integration steps 3-11
   - Status zone progress bar updates in real time via SSE
   - Each step shows timestamp and validation detail
   
9. All required steps passed
   - State changes to: PRODUCTION
   - Readiness badge appears: "Full (90)" or "Expert (100)"
   - Status zone shrinks to one-line stats
   - Auto-selected tab switches to: Tasks
   - Shared Board updates: status "Idle" or "Active"
   
10. Owner creates first real task
    - Agent receives via webhook
    - Tasks tab shows the task
    - Activity tab logs the events
```

### Journey 2: Production Agent Hits a Problem

```
1. Agent is in PRODUCTION state, everything healthy
2. VPS hosting the Hermes gateway goes down
3. Webhook deliveries start failing (AIMEAT retries 3x per event)
4. After 5 consecutive failures:
   - State changes to: PROBLEM
   - Status zone shows red banner: "Delivery Issue"
   - Readiness badge starts showing degradation trend
   - Collapsed card gets red-tinted border
   - Shared Board: status changes to "Unreachable"
   - Auto-selected tab switches to: Integration
   
5. Owner sees the problem, clicks [Test webhook]
   - Test fails -- confirms the issue
   
6. Owner fixes the VPS, webhook starts succeeding again
7. Over the next 3 days, operational health recovers
8. State returns to: PRODUCTION
   - Status zone returns to one-line stats
   - Readiness badge recovers to previous level
```

### Journey 3: Adding a Second Agent with Shared Data

```
1. Owner has hermes-spider (production, tagged "grocery")
2. Owner connects hermes-worker
3. hermes-worker completes onboarding
4. Owner goes to hermes-worker's Data Access tab
5. Owner clicks [+ Add tag], types "grocery"
   - Tag appears with "with: hermes-spider" indicator
   - Both agents now share agents.tag.grocery.* memory space
   
6. Shared Agent Board updates:
   - Both agents show "Tags: grocery"
   - Tag summary: "[grocery] (2 agents)"
   
7. hermes-worker writes to agents.tag.grocery.store_list
8. hermes-spider reads agents.tag.grocery.store_list
   - Collaboration established through tags, no explicit "share" action
```

---

## Part 17: Implementation Notes

### CSS Prefix

All new CSS classes for the agent detail view should use the `pf-agd-` prefix (profile agent detail) to avoid collisions with existing `pf-` classes in the agents tab.

### Component Reuse

The following existing shared components should be reused:

| Component | From | Used in |
|-----------|------|---------|
| Badge | `views/profile/shared.js` | Platform badge, readiness badge, federation badge |
| ExpandableHelp | `views/profile/shared.js` | Help text in empty states |
| DataTable | `views/profile/shared.js` | Delivery log, activity log |
| Tabs | `views/profile/shared.js` | Tab bar (8 tabs) |

### i18n Keys

All user-visible text must use `t()` function. New key namespace: `profile.agents.detail.*` with sub-namespaces per tab:

- `profile.agents.detail.integration.*`
- `profile.agents.detail.data_access.*`
- `profile.agents.detail.agent_config.*`
- `profile.agents.detail.messages.commands.*`
- `profile.agents.detail.activity.governance.*`

Both `locales/en.json` and `locales/fi.json` must be updated simultaneously (Rule 4).

### SSE Live Updates

All tabs that display server data must listen for the `aimeat-live-update` event:

```javascript
useEffect(() => {
  const handler = () => { loadData(); };
  window.addEventListener('aimeat-live-update', handler);
  return () => window.removeEventListener('aimeat-live-update', handler);
}, []);
```

Tabs requiring live updates: Integration, Tasks, Messages, Data Access, Agent Config, Activity, Services.

Tabs NOT requiring live updates: Directives (owner-initiated only), Capabilities (rarely changes).

### File Estimates

**New frontend files:**

```
public/views/profile/agent-detail/
  integration-tab.js        -- Integration tab (onboarding checklist + production status)
  data-access-tab.js        -- Data Access tab (tags, memory, knowledge)
  agent-config-tab.js       -- Agent Config tab (file list + preview)
  messages-commands.js       -- Command palette component for Messages tab
  activity-governance.js     -- Governance event filter + display for Activity tab
  shared-agent-board.js      -- Shared Agent Board panel component
  agent-card-header.js       -- Two-Zone Header component
  state-detection.js         -- Agent state detection logic

public/css/views/
  agent-detail.css           -- All agent detail styles (pf-agd-* prefix)
```

**Modified frontend files:**

```
public/views/profile/agents-tab.js    -- Refactored to use new components
public/views/profile/shared.js         -- New shared components if needed
public/spa.html                        -- Importmap entries for new modules
locales/en.json                        -- New i18n keys
locales/fi.json                        -- New i18n keys
```

### API Dependencies

This UI spec depends on the following API endpoints from the architecture spec:

| Endpoint | Used by tab |
|----------|------------|
| `GET /v1/agents/:name/onboarding` | Integration |
| `POST /v1/agents/:name/onboarding/start` | Integration |
| `GET /v1/agents/:name/webhook` | Integration |
| `POST /v1/agents/:name/webhook/test` | Integration |
| `GET /v1/agents/:name/skill-bundle/version` | Integration |
| `GET /v1/agents/:name/telemetry` | Integration, Activity |
| `GET /v1/memory?prefix=agents.shared.index` | Shared Agent Board |
| `GET /v1/memory?prefix=agents.{name}.commands` | Messages (command palette) |
| `GET /v1/agents/:name/directives` | Directives |

Existing endpoints (tasks, messages, capabilities, services, activity) are unchanged.

---

## Appendix: Design Decision Log

These decisions were made during the brainstorming session and are recorded here for context.

| Decision | Alternatives considered | Why this was chosen |
|----------|------------------------|---------------------|
| Two-Zone Header (identity + status) | (A) Single rich header, (B) Two rows, (C) Two zones | Identity zone stays stable, status zone adapts to state. Clean separation of "who" vs "what's happening." |
| All 8 tabs always visible | (A) Always visible, (B) Show/hide by state, (C) Progressive reveal | Hiding tabs confuses users. Empty states explain what's needed. Predictable navigation. |
| Smart default tab by state | Manual selection only | Reduces clicks. New/problem agents need Integration; production agents need Tasks. |
| Tag-based data sharing | Organism-based sharing (heavyweight) | Tags are simple strings on AgentRecord. Adding a tag creates a shared space automatically. Organisms were deemed too heavy for this use case. |
| Data Access as its own tab | Keep in Directives | Data access (tags, memory, knowledge) is a distinct concern from behavioral directives. Grouping them made Directives a kitchen sink. |
| Agent Config as its own tab | Keep in Directives, or inline in Integration | Config files are platform-specific technical files. Mixing with behavioral instructions would confuse the purpose of each. |
| Commands in Messages tab | Separate Commands tab | Commands are sent as messages and receive message responses. They belong in the messaging context, not a separate tab. |
| Identity details in Integration tab | Keep in card header | GAII, public key, creation date are setup/debug information. Header space is better used for readiness and platform badges the owner checks daily. |
| Shared Agent Board above cards | Inside each card, separate page | Board needs to be visible without expanding any card. It is the fleet coordination center. A separate page would break the flow. |
