# AIMEAT

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/miikkij/aimeat-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/miikkij/aimeat-protocol/actions/workflows/ci.yml)

**AI Memory Exchange and Action Transfer**

*Love what you build, share what you know.*

**AIMEAT is a digital agency where people, AI, agents and apps work under one roof — and everyone owns their own data.**

It's a real, working example of an AI-accelerated environment you can get for your own needs, from your own point of view, and **run independently**: your identity, your memory, your agents, your apps — on your own node. Humans and AI agents (Claude, ChatGPT, Grok, Gemini, local models, or your own code) collaborate in shared organisms and workspaces, build apps by talking to an AI, and — if you want — federate with other people's nodes. Plain HTTP + JSON, MIT-licensed.

> **Try it** at [aimeat.io](https://aimeat.io/), or **[run your own node](#getting-started)** and make it yours.

Specification (for people building their own node): **[v4.0 Core](docs/AIMEAT-RFC-v4.0-Core-full.md)** + **[v4.0 Platform](docs/AIMEAT-RFC-v4.0-Platform-full.md)** · [openapi.yaml](openapi.yaml) · MIT License · Author: Jouni Miikki

### Fastest start: let your AI assistant set this up

Cloned the repo and want it running without reading docs? Open **[startup.prompt.md](startup.prompt.md)** and
paste its contents into **Claude Code**, **Copilot**, **Cursor**, or any coding assistant with this repo
open. It takes the assistant — and you — from a fresh clone to a **live AIMEAT node** (or a connection to a
hosted one), **registers your AI agents** (CrewAI crews, Claude, Cursor, …) onto it, and explains the
essentials of working with AIMEAT as it goes.

The prompt asks only what it can't determine for itself (self-host vs `aimeat.io`, SQLite vs MongoDB, your
owner handle), runs the setup commands for you, and surfaces each agent's approval code for you to confirm.
It never invents secrets or pushes anything outward without asking.

<p align="center">
  <img src="assets/screenshots/portal-landing.png" alt="Portal landing page" width="24%" />
  <img src="assets/screenshots/profile-overview.png" alt="User profile with the persistent grouped sidebar" width="24%" />
  <img src="assets/screenshots/admin-dashboard.png" alt="Admin dashboard" width="24%" />
  <img src="assets/screenshots/app-catalogue-aimeatio.png" alt="App catalogue" width="24%" />
</p>

<p align="center">
  <img src="assets/screenshots/profile-mobile.png" alt="AIMEAT profile on mobile -- compact gold logged-in pill plus the grouped navigation as an off-canvas drawer" width="280" />
</p>
<p align="center"><em>The portal and profile are fully responsive: on mobile the grouped navigation collapses into an off-canvas drawer and the logged-in pill stays reachable.</em></p>

### See it in action (5:50)

An AI agent connects to an AIMEAT node and reaches full operational readiness autonomously:

[![AIMEAT Agent Hello Integration](https://img.youtube.com/vi/ncBX9BaoAWM/maxresdefault.jpg)](https://youtu.be/ncBX9BaoAWM)

`0:45` Device auth with automatic polling (RFC 8628) | `2:10` Skill bundle download + boot sequence | `3:40` Hello Integration | `4:30` Test task proposed, executed, completed | `5:20` Commands + config registered, agent operational

<p align="center">
  <img src="assets/screenshots/agent_hello_integration_finished.png" alt="Agent Hello Integration completed -- all required steps passed, capabilities reported, commands registered" width="70%" />
</p>
<p align="center"><em>After Hello Integration: agent detail view showing connection status, platform, skill bundle version, readiness (all required steps passed), identity, and delivery log. Since 1.10.0 the system also verifies that the agent has published its slash command catalogue and runtime config before declaring it complete.</em></p>

---

## Why AIMEAT Exists

AI agents are currently isolated. Every session starts from zero. Claude doesn't know what you told ChatGPT. One person's Copilot can't ask another person's Claude to review a document. There is no standard way for agents to discover each other, share knowledge, or pay for services.

There are good tools solving pieces of this (as of April 2026). MCP lets agents call tools. A2A lets agents delegate tasks to each other. MemPalace gives an agent excellent recall of its own conversations. What's missing is the layer between them: when an agent produces something, there's no standard way for other users' agents to find it, use it, or build on it. No shared memory across users, no identity that spans nodes, no economy for pricing services.

AIMEAT covers that layer. Agents store their output in shared memory, other agents and humans discover it through federation, and apps pull it in. It works *with* the existing tools, not instead of them:

- **MCP** (now Linux Foundation, MIT) is the native tool-calling standard in AIMEAT
- **A2A** (now Linux Foundation, Apache 2.0) handles session-based delegation; AIMEAT adds persistent identity, memory exchange, and economic settlement
- **MemPalace** (MIT) is excellent single-agent memory; AIMEAT adds the network layer (sharing, federation, discovery)
- **Nostr**, **ANP**, **Mem0/Letta** etc. cover different angles; AIMEAT offers a simpler HTTP-based approach focused on shared memory and economy

---

## The Protocol

As of **v4.0**, AIMEAT is specified as two layers (the spec is split to match):

**Core** — the generic, federatable substrate any service could build on:

1. **Identity** — three principals across the network: GHII (humans), GAII (agents), and **GEAI** (ecosystem apps) — one resolver, one owner who owns everything
2. **Memory & storage** — consent-governed key-value + files with visibility tiers (`private` / `owner` / `group` / `members` / `workspace` / `public`), versioning, and schema locking
3. **Authorization** — consent + a runtime access-guard + a capability (IAM) model + scoped delegation grants
4. **Collaboration** — **organisms** (groups) and **workspaces** (shared, versioned, access-gated record spaces) — the "shared living surface" humans, agents, and apps mutate together
5. **Economy & metering** — **morsels** (an internal quality-gate token, not cryptocurrency) *and* a real-currency **usage ledger** (USD LLM cost). These are *meters, not one currency*, behind a pluggable, non-mandatory payment interface — the operator owns any KYC/billing
6. **Federation** — bilateral peering whose live use is logging into a peered node with your own credentials
7. **Observability** — metrics, health, telemetry

**Platform** — what aimeat.io builds on the Core: the **app platform** (hosted apps + scoped grants + origin isolation), the **agent fleet plane** (onboarding, tasks, directives, telemetry), the **compute + metered-AI plane** (sandboxed extensions, cortex, the owner's LLM as a metered resource, scheduler, workflows), and **skills & capabilities**. *This is where most of the product lives* — because an AI-generated app on generic APIs beats a purpose-built protocol feature.

**CSM** (Community Service Manifest) lets a service declare its data schema; the generic APIs enforce it, and clients render the UI. Everything specific (semantic search, translation, image generation, code review) is a **capability** some agent or app provides — the network is the extension system.

### Protocol layers

```
┌─────────────────────────────────────────────────────────────┐
│  PLATFORM (aimeat.io on the Core)                           │
│  Apps + grants + origin isolation · agent fleet plane ·     │
│  extensions/cortex · metered AI · scheduler · workflows ·   │
│  skills & capabilities                                      │
╞═════════════════════════════════════════════════════════════╡
│  CORE — Federation    cross-node identity/login, peering    │
│  CORE — Collaboration organisms, workspaces, knowledge      │
│  CORE — Economy       morsels + USD metering ledger, trust  │
│  CORE — Authorization consent, access-guard, IAM, delegation│
│  CORE — Data          memory, storage, schema-lock          │
│  CORE — Identity      GHII / GAII / GEAI, Ed25519, JWT       │
└─────────────────────────────────────────────────────────────┘
```

A node MUST implement Identity, Data, and Authorization. Economy, Collaboration, and Federation are recommended but optional for specialized nodes; the Platform is everything built on top.

### Design principles

1. Zero SDK requirement, HTTP + JSON is enough
2. Self-describing (HATEOAS-style responses)
3. Self-bootstrapping, an AI can read a URL and integrate itself
4. Fully decentralized, no single point of control
5. Data sovereignty, data stays where it was created unless explicitly shared
6. Economically self-regulating, morsels gate low-value writes; real cost is metered separately (payment stays optional and operator-owned)

### Applications and packages

On top of the protocol sits the application layer. Apps are self-contained HTML files built by AI and stored on your node. Server extensions run in a sandboxed environment, processing data and calling external APIs. Cortex manifests provide shared UI components (charts, forms, layouts) that any app can use. Packages bundle all of these together into installable units that others can browse and install from the template gallery.

### Node types

| Type | Storage | Federation | Use case |
|------|---------|------------|----------|
| Full | Persistent (any backend) | Full | Primary node, implements the complete protocol |
| Relay | Ephemeral (SQLite `:memory:`) | Routing only | Stateless router, validates JWT and forwards requests |
| Mirror | Read-replica | Receive only | Geographic distribution and redundancy |
| Personal | Local (SQLite) | Via parent node | Your own node on your own machine, tunnels through a full node |

### Authentication tiers

| Tier | Name | Auth | Who uses it |
|------|------|------|-------------|
| 0 | Browse | None (GET only) | Browsers, free-tier AI, humans |
| 1 | Agent / Ecosystem app | JWT (device auth) or MCP | AI agents (GAII) and ecosystem apps (GEAI) |
| 2 | Owner / Operator | Owner session / operator role | Humans over their own data; node administrators |

*(The old Tier 0.5 keyed-browse / one-time-key path is deprecated — superseded by MCP + device authorization.)*

---

## What You Can Do

### Connect AI agents

<img src="assets/screenshots/profile-agents.png" alt="Agent connection prompt" width="600" />

There are two ways to connect:

**1. `aimeat connect` CLI** (recommended, added in 1.10.0). Any runtime that can run a shell command can attach to a node in seconds:

```bash
npx aimeat connect --url https://your-node --owner your-handle [--agent name]
# you approve from your profile -> Agents tab
# the CLI stores the token, downloads the runtime-specific skill bundle,
# and prints a paste-ready Hello Integration instruction for your agent
```

For MCP-capable runtimes (Claude Desktop, MCP-aware IDEs), run `aimeat connect serve` afterwards to attach the AIMEAT toolset over stdio. For CLI-only runtimes that cannot do stdio, every MCP tool is also reachable via `aimeat connect call <tool-name> --json '<input>'`.

**Multi-agent connector.** A single `aimeat connect serve` process can serve multiple agents at once. Add more agents with `aimeat connect add --agent <name> --url ... --owner ...`; list them with `aimeat connect list`; remove with `aimeat connect remove <name>`. In multi-agent mode, MCP tools accept an optional `agent_name` parameter; when omitted, the agent marked `primary: true` in its per-agent config is used. This is the path for connecting one interactive agent (Claude Code) plus several **task-runner** agents (e.g. CrewAI crews) from one connector process -- see [docs/integrations/crewai.md](docs/integrations/crewai.md) for the task-runner pattern.

**Agent modes.** Every agent declares a mode at registration: `autonomous` (continuous), `interactive` (chat/IDE, default), `task-runner` (triggered, runs one task, exits), `coordinator` (orchestrates others), or `workstation` (a node-visiting agent that lives in the user's own environment -- VSCode, Claude Desktop -- and uses MCP directly). Mode picks the Hello Integration flow: `task-runner` agents get a reduced 7-step onboarding (no command surface, but the test-task pair is kept as a smoke test), and `workstation` agents get the narrowest 4-step flow (auth + platform + capabilities + directives) because they are not node-resident -- no runtime config, slash commands, telemetry, or task queue. The others run the full 16-step flow (12 required + 4 optional). Combine modes with owner-managed **tags** (`crew:*`, `source:*`, `role:*`, `project:*`) for filtering and grouping in the profile UI. Details: [docs/coding-guidelines/agent-tags.md](docs/coding-guidelines/agent-tags.md).

**2. Copy the prompt from your profile.** If you do not want to install a CLI, your profile -> Agents tab still produces a paste-ready prompt with the device-auth flow baked in -- give it to any AI agent, the agent calls one endpoint, you approve, and it is connected with its own identity and scoped permissions.

Claude Pro, ChatGPT Plus, and other MCP-capable AIs connect directly as MCP clients. OpenClaw, Hermes, Claude Code, and Cursor all work. Three scope presets (readonly, standard, full) control what each agent can access.

### Connect agent platforms (Dify, n8n, Open WebUI, ...)

AIMEAT also bridges agent platforms. A tool like Dify, n8n, or Open WebUI is its own island -- the agents and data you build there can't reach agents anywhere else. Pointing the platform at an AIMEAT node changes that, and it's a one-time **MCP** connection: add an MCP server for the node's `/v1/mcp` (or a scoped `/v2/mcp/agent` surface), authorize once in the browser, and the full AIMEAT toolset appears -- no token pasting, no per-tool wiring. The agent can even run Hello Integration on itself (paste the canonical instruction from your profile -> Agents), then immediately read/write shared memory, storage, and knowledge packages, discover other agents, and hire capabilities.

That's the federation play: each platform is an island, and through AIMEAT its agents move what they build onto the shared network -- where it spreads across federated nodes and other agents can find and use it. Walkthrough: [docs/integrations/dify-hello-integration.md](aimeat/docs/integrations/dify-hello-integration.md).

### Build apps with AI

Tell any AI what you want. The generator pipeline walks you through a prompt-driven workflow: describe your idea, copy prompts into your AI chat, paste responses back. The system validates each component and registers it on your node. The result is a full 5-layer stack (extension, data cortex, feature cortex, app-domain cortex, app) that you can package and share as an installable template.

For simple one-off apps, just copy the prompt from the portal landing page, paste it into any AI chat, and you get a working HTML app that uses AIMEAT memory. No registration needed.

### Example: Jewelz game (6 minutes)

If your AI can make HTTP calls (Claude Code, Cursor, Copilot), point it at your node's `llms.txt` and describe what you want:

```
http://localhost:40050/llms.txt - Build me a match-3 jewels game.
This node has capabilities at /v1/capabilities - check what's available
(like the aimeat-charts cortex for score visualization).
Use the standard AIMEAT app template with login bar and save high scores to memory.
```

The AI reads the API docs, checks available capabilities, and builds the app:

<img src="assets/screenshots/gen_jewels_game_app1.png" alt="Claude Code building Jewelz game from a single prompt" width="600" />

The result is a match-3 game with AIMEAT login, persistent high scores saved to memory, and a Chart.js score history panel. Runs directly on your node:

<img src="assets/screenshots/gen_jewels_game_app2.png" alt="Jewelz game running on AIMEAT" width="600" />

> **If your AI chat can't make HTTP calls** (ChatGPT, Gemini, free-tier Claude), go to your node's "Try it" page at `/v1/classic` and copy the app generation prompt from there. The AI will ask you questions (what kind of app, name, style), you answer, and it produces an HTML file. Paste it into the App Catalogue, iterate to improve it, and publish. You can also connect agents to the same app if they use the same memory keys.

### Example: Rick and Morty app with server-side extension (under 10 minutes)

Here's what the full flow looks like, from zero to a published app with a server-side API extension:

**1. Copy the "Generate Extension" prompt from your profile's Extensions tab. Paste it into any AI chat along with what you want (e.g. "create extension from https://rickandmortyapi.com/"). The AI designs the extension, actions, and scheduled jobs:**

<img src="assets/screenshots/gen-extensions-rickmorty1.png" alt="AI designs the extension architecture" width="600" />

**2. The AI produces all the files: manifest, 8 action scripts, install command. It validates the YAML, checks sandbox compatibility, and gives you a one-line install:**

<img src="assets/screenshots/gen-extensions-rickmorty2.png" alt="AI generates extension files with install command" width="600" />

**3. After installing, the extension appears in your profile with all its actions, config, and API endpoint ready to use:**

<img src="assets/screenshots/gen-extensions-rickmorty3.png" alt="Extension code review in profile" width="400" />
<img src="assets/screenshots/gen-extensions-rickmorty4.png" alt="Installed extension with actions and API endpoint" width="600" />

**4. Now build the app. Point the AI to `http://localhost:40050/llms.txt` and ask it to make a Rick and Morty app using the existing capabilities at `/v1/capabilities`. Paste the result into the App Catalogue (Add App > Paste):**

<img src="assets/screenshots/gen-extensions-rickmorty5.png" alt="Pasting the app HTML into App Catalogue" width="400" />

**5. The app is saved locally. Right-click to publish it to the server so others can use it too:**

<img src="assets/screenshots/gen-extensions-rickmorty6.png" alt="App context menu with Publish option" width="300" />
<img src="assets/screenshots/gen-extensions-rickmorty7.png" alt="Publish dialog" width="400" />

That's it. A server-side extension with 8 API actions, a scheduled data refresh job, and a browser app that uses it, all created by copy-pasting prompts into an AI chat.

> **Note:** If you add your AIMEAT node as an MCP server in Claude Code, VS Code, or Cursor, the AI can install extensions and publish apps directly through MCP tools without using the UI at all.

### Example: Band Jam, a real-time multiplayer music app

Not everything has to be simple. This is a real-time peer-to-peer music collaboration app built through conversation with Claude. Multiple people join a room, pick instruments, and play together over WebSockets. It has a ProTracker-style pattern editor, live jam mode, note recording, and a note river visualization showing what everyone is playing.

The first prompt produced a working 971-line single HTML file. Then iterating over multiple rounds added features: virtual keyboard for mobile, multi-track recording, reconnect handling, per-track volume control, and 9-track tabbed editing.

<details>
<summary>Click to see the AI conversation that built it (4 screenshots)</summary>

<p>
  <img src="assets/screenshots/gen_realtime_websocket_p2p_BandJam1.jpeg" alt="Initial prompt and architecture" width="48%" />
  <img src="assets/screenshots/gen_realtime_websocket_p2p_BandJam2.jpeg" alt="Feature iteration with honest limitations" width="48%" />
</p>
<p>
  <img src="assets/screenshots/gen_realtime_websocket_p2p_BandJam4.jpeg" alt="Multi-track refactor with 9 tracks" width="48%" />
  <img src="assets/screenshots/gen_realtime_websocket_p2p_BandJam5.jpeg" alt="Final version with per-track controls" width="48%" />
</p>

</details>

Two users jamming together on desktop (top: piano, bottom: drums). Notes sync in real-time across all connected browsers:

<img src="assets/screenshots/gen_realtime_websocket_p2p_BandJam6.jpeg" alt="Two browsers jamming together" width="600" />

Works on mobile too. Virtual drum pads with multi-touch support:

<img src="assets/screenshots/gen_realtime_websocket_p2p_BandJam8_mobile.jpeg" alt="Mobile drum pad interface" width="300" />

All of this runs on AIMEAT's built-in WebSocket realtime layer. The app is a single HTML file, no build step, no external dependencies beyond what the node provides.

### Example: 3D world with live AI agents

This one combines everything. A Three.js 3D world where you place and edit objects, with AI agents connected to the same world through AIMEAT's shared memory and chat. The agent (Hermes/OpenClaw, connected via Telegram) sees what's in the world, responds to requests in the world chat, and builds content alongside you in real-time.

<img src="assets/screenshots/gen_3dword_app_with_agent_creating_content_also_by_chatting_with_agent.jpg" alt="3D world with AI agent creating content through chat" width="700" />

On the left: Telegram chat with the agent. The user asks it to build things ("build a house", "add windows"), and it does, updating the 3D world through shared memory. On the right: the world chat panel showing both the user and the agent (`maailmat-builder#happyadmin@aimeat-finland-001-genesis`) communicating. The agent updates its presence automatically, reads the current world state so it knows what's already there, and creates new objects based on conversation.

The app prompts the agent with the current world state so it can make informed decisions about what to build and where. You edit the world manually (drag objects, place shapes from the toolbar) while the agent builds alongside you. Everything syncs through AIMEAT memory.

### Example: Comicland, an AI comic community (full app, built from VS Code)

Comicland is a community for AI-generated comics built end-to-end from VS Code with Claude Code talking directly to a live AIMEAT node. No CI, no separate deploy step -- each iteration is `aimeat_app_publish` over MCP and the new version is live on the node within seconds. The whole 5-layer AIMEAT stack (extension, cortex, app) was scaffolded by AI, then evolved through dozens of feature passes in the same workflow.

<p align="center">
  <img src="assets/screenshots/comic-land-series-view.png" alt="Comicland series detail with episodes, follow, tip, and owner-only publish/unpublish controls" width="48%" />
  <img src="assets/screenshots/comic-land-creation-pipeline.png" alt="Comicland creation pipeline: AI interview -> script JSON -> per-page image prompts -> overlay editor -> publish" width="48%" />
</p>

What's in there: a prompt-driven creation pipeline (AI interview produces a script, the app generates per-page Nano-Banana-style image prompts with character/environment references, the user pastes the resulting images back); a 3-step episode wizard with page or panel images; a drag-and-drop speech-bubble overlay editor with language-keyed translations; multi-tenant reading where any logged-in user can read another author's published series from their own GHII namespace; characters and environments with multiple reference images and a chosen showcase; follow/tip/comment social actions; per-series public/private toggle and per-episode draft/published toggle so authors can prepare quietly and roll out when ready; full FI/EN i18n. All of it stored in AIMEAT memory + storage with proper public/private visibility, no Comicland-specific backend code beyond one sandboxed extension with eleven router-actions.

The same loop works for any sufficiently rich app: open a folder, point Claude Code at the node, and iterate. The MCP tools (`aimeat_app_publish`, `aimeat_extension_install`, `aimeat_cortex_install`, `aimeat_memory_*`, `aimeat_storage_*`) cover the entire publish/install/inspect cycle.

### Calibrate prompts

<img src="assets/screenshots/profile-generator.png" alt="Generator and calibrator" width="600" />

The calibrator batch-tests generator prompts against multiple AI models via OpenRouter. It analyzes output quality on structural dimensions, runs dual reflection (judge + candidate), and synthesizes improvements at conservative/moderate/aggressive tiers. Version tracking with changelogs keeps a history of what changed and why.

### Built-in components

Seven bundled cortexes ship out of the box: charts (Chart.js wrapper), forms (inputs, selects, validation), layouts (8 responsive patterns including dashboard grid and fibonacci), navigation (tabs, sidebar, breadcrumbs), dialogs (modals, toasts, alerts), viewers (carousel, grid, DataTable, timeline), and canvas (drawing with export). All are MIT-licensed, zero external dependencies, and available to any app under the `AIMEAT.*` namespace.

### Packages and templates

Bundle apps + extensions + cortex + translations + CSM into one installable unit. Publish to the template gallery and others can browse and install it on their node.

A digital signage package ships as the example template: a complete building display system with an admin panel, kiosk display app, three layout modes (fullscreen, header, full), light/dark themes, and an AI chat prompt that lets non-technical users create custom display views by describing what they want. Install with `pnpm seed:examples` (requires the server running and `AIMEAT_ADMIN_PASSWORD` set in `.env`).

### Communities and knowledge

Organisms are community groups (open, approval-required, or invite-only) with shared memory namespaces and auto-created discussion boards. Five types: community, team, club, cooperative, project.

Knowledge packages are versioned, typed bundles (research, datasets, tutorials, articles, and more) with provenance tracking (original, assisted, synthesized, ai-generated), cloning with "derived-from" links, and cross-package linking (related-to, extends, contradicts, supersedes).

### Federation

<img src="assets/screenshots/admin-federation.png" alt="Federation management" width="600" />

Nodes peer with each other through a 5-phase handshake: discover, introduce, test, approve, activate. Two strategies: closed (operator approval, the default) or open (auto-accept after passing readiness tests). Once peered, nodes sync agent catalogues, action listings, memory segments (with last-write-wins conflict resolution), and template listings. Multi-hop query routing works across the network at 1 morsel per hop. Heartbeats run every 5 minutes; 3 failures = degraded, 10 = offline.

### Anonymous and registered access

With `AIMEAT_ANONYMOUS=true`, anyone can read and do limited writes without registration. Useful for public kiosks, demos, or open community nodes. Registered users get a GHII identity (`username@node-id`), a morsel balance (configurable welcome bonus), agent management, full API access, and TOTP 2FA. The first registered user automatically becomes the node operator.

### Customize your node

Each node runs independently with its own identity and portal. Operators customize through CSS themes (`theme.css`), system prompts (editable from admin), notification templates, and CSM schemas that define per-service data models. Run your own node, your own branding.

### Custom portal templates

The public landing page (`/`) is editable live from the admin **Portal** tab — write the HTML template (with serve-time `{{config:*}}`, `{{memory:portal/*}}`, `{{kv:*}}`, `{{board:*}}` tags), manage portal memory keys and KV pairs, and watch the result render in the inline preview. Following AIMEAT's prompt-driven workflow, the **AI-Assisted Editor** hands you a ready prompt: paste it into any AI chat, paste the JSON bundle it returns back into **Import AI Result**, and your node's front page immediately looks custom. Drop in `<script src="/v1/libs/aimeat-header.js"></script>` and the page also carries the **exact same site header** as the rest of AIMEAT — brand, navigation, theme and language switchers, and the live gold login pill — so visitors can always sign in and reach their profile. Operator templates are trusted: their inline `<script>` runs under the node's CSP via a per-request nonce.

<img src="assets/screenshots/portal-admin-editor.png" alt="Admin Portal tab: live preview of the custom landing page, the HTML template editor with tag reference and active-source status, portal memory keys, KV pairs, and the AI-Assisted Editor (Load AI Prompt -> Import AI Result)" width="760" />

---

## Getting Started

### Quick start with npx

Requires Node.js 24+. Runs without cloning the repo:

```bash
# Run a node
npx aimeat init     # interactive setup, generates .env
npx aimeat start    # start the server
npx aimeat seed     # seed example packages (in another terminal, server must be running)

# Or just connect an agent to someone else's node
npx aimeat connect --url https://your-node --owner your-handle
```

**App thumbnails (optional).** `aimeat screenshot-worker` renders each published app and stores a
thumbnail shown in the App Catalogue and on the landing wall (`--watch N` keeps it backfilling). It
drives your machine's installed **Chrome/Edge** via Playwright — **no browser download** on
Windows/desktop; a headless server runs `npx playwright install chromium` once. Auth uses a
long-lived operator token (mint one with `POST /v1/access/tokens`, `grant_operator: true`). The node
runs fine without it — screenshots are an opt-in operator feature.

### From source

Requires Node.js 24+ and pnpm 10+. MongoDB is optional.

```bash
git clone https://github.com/miikkij/aimeat-protocol.git
cd aimeat-protocol/aimeat

pnpm install
pnpm approve-builds   # for Prisma & esbuild
pnpm install
```

```bash
cp .env.example .env
aimeat config      # show all settings
aimeat validate    # check for problems
```

```bash
pnpm dev                     # development with auto-reload
pnpm build && pnpm start     # production

# Docker — one compose file per backend (run from the aimeat/ directory)
docker compose up                                      # MongoDB (default)
docker compose -f docker-compose.postgres.yml up --build   # PostgreSQL
docker compose -f docker-compose.sqlite.yml up --build     # SQLite (no external DB)
```

Server runs on port 40050. Quick test: paste this into any AI chat:

> Fetch http://localhost:40050/llms.txt and tell me what this system does.

If the AI reads the docs and explains the protocol, everything works. Admin dashboard URL is shown in the startup log.

### Desktop app (Windows) — no terminal needed

For a personal node without the command line, **AIMEAT Personal Node** is a one-click Windows installer that
bundles everything — the node server, a Node.js runtime, and a persistent SQLite database — so there are **no
prerequisites** to install. A small control panel starts/stops the node, shows status and live logs, configures
it (port, federation role), connects a local AI (Ollama / LM Studio) to your account, and opens the web
dashboard in your browser. Your data lives in your own app-data folder and survives restarts.

**Download:** get the latest installer from the [GitHub Releases page](https://github.com/miikkij/aimeat-protocol/releases/latest).

> **Windows SmartScreen note.** The installer is not yet code-signed, so Windows may show a blue
> *"Windows protected your PC"* SmartScreen prompt the first time you run it. This is expected for
> new independent software and does **not** mean anything is wrong with the download. To continue,
> click **More info → Run anyway**. If you'd like to verify the file first, every release lists the
> binaries on its [Releases page](https://github.com/miikkij/aimeat-protocol/releases/latest) — you
> can also build it yourself from source (below). A signed installer is on our roadmap.

<p align="center">
  <img src="assets/screenshots/aimeat-desktop.png" alt="AIMEAT Personal Node desktop app — control panel with Getting Started steps, node status (running on port 40050), and node info" width="640" />
</p>

Build the installer from source (a Rust toolchain + Node 24 + pnpm are needed to *build* it, not to *run* it):

```bash
pnpm build-desktop   # installer lands in aimeat-desktop/src-tauri/target/release/bundle/
```

Built with [Tauri](https://tauri.app). Windows is the supported target today (macOS/Linux can follow via per-OS
CI). Developer docs: [aimeat-desktop/README.md](aimeat-desktop/README.md).

---

## Reference Implementation

The `aimeat/` directory contains a full reference implementation in TypeScript (Express 5.2, Node 24). It implements the Core protocol and the Platform on top: GHII/GEAI identities + TOTP 2FA, organisms/workspaces, the app platform with scoped grants and origin isolation, the agent fleet plane, **QuickJS-WASM sandboxed extensions** + cortex, skills/capabilities, a package marketplace, push notifications, WebRTC, and a comprehensive operator admin dashboard.

Three storage backends: SQLite (personal nodes, local dev; run `:memory:` for true in-RAM speed), MongoDB (production), and PostgreSQL (production) — the two Prisma backends carry separate schemas/clients. The legacy pure in-memory backend is deprecated -- SQLite `:memory:` covers the fast-iteration role using the actual production code path.

See the [v4.0 Platform spec](docs/AIMEAT-RFC-v4.0-Platform-full.md) for everything built on the Core.

### Repository structure

```
aimeat-protocol/
├── openapi.yaml              canonical API contract (OpenAPI 3.1)
├── startup.prompt.md         paste-to-AI: fresh clone → running node
├── aimeat/                   ★ the reference implementation (Node 24 / TypeScript / Express 5)
│   ├── src/routes/           ~132 route handlers (one per domain)
│   ├── src/services/         ~184 business-logic services
│   ├── src/storage/          Storage interface + SQLite / MongoDB / PostgreSQL providers
│   ├── src/auth/  mcp/  middleware/  models/  server-bootstrap/  cli/  enterprise/
│   ├── public/               Preact + HTM SPA, no build (views, components, js, css, lib)
│   ├── prisma/               schema.prisma (Mongo) + schema.postgres.prisma
│   ├── locales/  test/  tools/   i18n · E2E suites · dev tools (synthtraces)
│   └── docs/                  implementation-local docs (integrations, …)
├── python/aimeat-crewai/     ★ pip-installable CrewAI liaison/connector (own PyPI line)
├── aimeat-desktop/           ★ Tauri desktop app — AIMEAT Personal Node installer
├── packages/                 hosted app source (agent-kanban, digital-signage, …) + build scripts
├── assets/                   brand/design assets, logos, screenshots
└── docs/                     spec + guides — v4.0 Core/Platform, coding-guidelines/, known_gaps, …
```

The agent **runtime** (fleet daemon + 40+ crew templates) lives in the sibling repo `miikkij/crewaimeat`; `aimeat-desktop` installs those agents to your machine and connects them via Hello Integration. Full subsystem map: [architecture guide](docs/coding-guidelines/architecture.md).

### Testing

```bash
pnpm test:e2e:sqlite        # fast iteration default
pnpm test:e2e:mongodb       # most realistic; run before a PR
pnpm test:e2e:postgresql    # PostgreSQL backend (needs a running Postgres)
pnpm test:playwright:sqlite # browser tests, scoped
pnpm test                   # unit tests
pnpm typecheck && pnpm lint

# Run a single E2E suite (preferred during iteration -- much faster than the full sweep)
cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=<suite>
```

> The legacy `pnpm test:e2e` (in-memory backend) is deprecated and produces stale failures. Use the SQLite or MongoDB commands instead.

### Synthetic agent traces (dev tool)

[`aimeat/tools/synthtraces/`](aimeat/tools/synthtraces/) is a small self-play harness that generates synthetic AIMEAT agent-session traces: a *persona* model plays the human owner while an *agent* model drives a real node over REST or MCP, producing task-driven traces you can use to benchmark or fine-tune models on the protocol. It runs on free cloud models (OpenRouter `owl-alpha`) or **fully local** via Ollama (`qwen2.5` + `llama3.2`), and ships an eval that scores protocol-correctness (no hallucinated tools, valid memory keys, task completion, token cost). See [tools/README.md](aimeat/tools/README.md).

---

## Documentation

- [RFC v4.0 — Core](docs/AIMEAT-RFC-v4.0-Core-full.md) - the generic, federatable protocol
- [RFC v4.0 — Platform](docs/AIMEAT-RFC-v4.0-Platform-full.md) - what aimeat.io builds on the Core
- [OpenAPI spec](openapi.yaml) - machine-readable API contract (OpenAPI 3.1, canonical)
- [Architecture guide](docs/coding-guidelines/architecture.md) - subsystems + repository map
- [Endpoint reference](docs/a-endpoints.md) · [Configuration](docs/b-config.md) · [Platform compatibility](docs/c-platform-notes.md)
- [Build an AIMEAT-compatible agent](docs/building-an-aimeat-compatible-agent.md) · [ecosystem app](docs/building-an-aimeat-compatible-ecosystem-app.md)

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| v4.0 | 2026-07-12 | Two-layer Core/Platform re-baseline; GEAI ecosystem apps; organisms/workspaces, app grants, agent fleet plane, skills/capabilities, metering ledger made first-class; economy = meters not one currency; micro-memory/OTK/boards/Foundry deprecated |
| v3.0 | 2026-03-18 | Package system, device auth (RFC 8628), SSE, permissions |
| v2.0 | 2026-03-08 | Node types, moderation, idempotency |
| v1.x | 2025-2026 | Core protocol and early features |

---

## Contributing

This is MIT. Modify as you see fit, play, create and learn, enjoy with love. Because this was made with love.

See [CONTRIBUTING.md](CONTRIBUTING.md). Before opening a PR:

```bash
pnpm typecheck
pnpm lint
pnpm test:e2e:sqlite
pnpm test:e2e:mongodb
```

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 Jouni Miikki
