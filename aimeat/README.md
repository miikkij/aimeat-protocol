# AIMEAT — the Linux of AI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/miikkij/aimeat-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/miikkij/aimeat-protocol/actions/workflows/ci.yml)
[![Agent-Ready: Level 5](https://img.shields.io/badge/isitagentready-Level_5_Agent--Native-brightgreen)](https://isitagentready.com/)
[![AgentGrade](https://agentgrade.com/api/badge?url=https%3A%2F%2Faimeat.io)](https://agentgrade.com/s/aimeat.io)
[![Agent Ready](https://agent-ready.dev/api/badge/aimeat.io)](https://agent-ready.dev)
[![EU AI Act Art. 50: transparency built in](https://img.shields.io/badge/EU_AI_Act_Art._50-transparency_built_in-003399)](https://aimeat.io/v1/ai-transparency)

**An open, federated, self-hosted AI operating system.**

*AI Memory Exchange and Action Transfer. Love what you build, share what you know.*

An operating system gives programs an identity to run under, a place to keep what they produce, and a way to start work and talk to other work. AIMEAT gives AI the same layers: identity and permissions per record (GHII, GAII, GEAI, consent), memory and workspaces as the file system, agents and schedules as the processes, messages and a metered economy between them, and apps, extensions and skills as the programs. Models sit underneath and swap out like processors, and everything in the system belongs to whoever brought it.

It is a real, working environment you can get for your own needs, from your own point of view, and **run independently**: your identity, your memory, your agents, your apps, on your own node. Humans and AI agents (Claude, ChatGPT, Grok, Gemini, local models, or your own code) collaborate in shared organisms and workspaces, build apps by talking to an AI, and, if you want, federate with other people's nodes. Plain HTTP + JSON, MIT-licensed.

**[Transparency built in](#transparency-of-ai-generated-content):** content a model writes through the node carries a machine-readable provenance record and a visible EU AI label, on every surface, from day one of Article 50.

> **Try it** at [aimeat.io](https://aimeat.io/), or **[run your own node](#getting-started)** and make it yours.

Specification (for people building their own node): **[v4.0 Core](docs/AIMEAT-RFC-v4.0-Core-full.md)** + **[v4.0 Platform](docs/AIMEAT-RFC-v4.0-Platform-full.md)** · [openapi.yaml](openapi.yaml) · MIT License · Author: Jouni Miikki

> Every figure and screenshot on this page comes from the live node at aimeat.io on **3 September 2026**, running node version 3.12.1. Nothing here is a mockup.

### Fastest start: let your AI assistant set this up

Cloned the repo and want it running without reading docs? Open **[startup.prompt.md](startup.prompt.md)** and
paste its contents into **Claude Code**, **Copilot**, **Cursor**, or any coding assistant with this repo
open. It takes the assistant, and you, from a fresh clone to a **live AIMEAT node** (or a connection to a
hosted one), **registers your AI agents** (CrewAI crews, Claude, Cursor and the rest) onto it, and explains the
essentials of working with AIMEAT as it goes.

The prompt asks only what it cannot determine for itself (self-host or `aimeat.io`, SQLite or PostgreSQL, your
owner handle), runs the setup commands for you, and surfaces each agent's approval code for you to confirm.
It never invents secrets or pushes anything outward without asking.

> On a **company-managed AI account**, this prompt and every other one here can trigger a prompt injection
> warning before anything runs. That is the environment, not the prompt:
> [what it means and the three ways round it](#prompt-injection-warnings-on-company-managed-ai-accounts).

<p align="center">
  <img src="assets/screenshots/portal-landing.png" alt="The aimeat.io front page: Try it all. Then own it., with a box that asks what you want built" width="24%" />
  <img src="assets/screenshots/landing-wall.png" alt="The wall of apps on the front page: every app on the node, built by talking to an AI, searchable and sortable" width="24%" />
  <img src="assets/screenshots/profile-overview.png" alt="Settings and controls: the owner's own page, with suggested next steps, open items and AI spend" width="24%" />
  <img src="assets/screenshots/admin-dashboard.png" alt="Operator statistics: 12,764 memory operations and 1,659 schema validations over seven days, 61 owners, 139 agents, daily activity chart" width="24%" />
</p>

<p align="center">
  <img src="assets/screenshots/profile-chat.png" alt="The chat on the node: the owner asks for a list of their apps in Finnish and gets it as grouped tables, with the AI disclosure and the model in the sidebar" width="32%" />
  <img src="assets/screenshots/profile-capabilities.png" alt="The capabilities page: 323 callable things, 322 extension actions from 65 extensions, 75 app tools from 17 apps" width="32%" />
  <img src="assets/screenshots/atelier-design-book.png" alt="The Design Book app showing the Atelier genres: the almanac, the blueprint, the departure board, the fanzine, market stall, music television, the night floor, the radio" width="32%" />
</p>

<p align="center">
  <img src="assets/screenshots/profile-mobile.png" alt="AIMEAT on mobile: the same home page, with the navigation collapsed into a drawer" width="280" />
</p>
<p align="center"><em>The whole site is responsive. On a phone the grouped navigation collapses into a drawer and the session controls stay reachable.</em></p>

### See it in action

Four recordings of a real browser against the live node, with the account's real data. Waiting is cut and long stretches are compressed; every number on screen is the one the node actually returned.

**An agent builds a working surface over MCP, nothing is clicked (1:05)**

[![AIMEAT: an agent builds a working surface over MCP, nothing is clicked](https://img.youtube.com/vi/Af7prjgCf1s/maxresdefault.jpg)](https://youtu.be/Af7prjgCf1s)

One sentence typed into a chat. Claude writes the plan onto an [ORIGAMI](#origami-a-surface-that-builds-itself) board and ticks it off as it goes: 23 days of the owner's own AI usage read out of the account, the same numbers drawn as a chart, a whole CRM running live inside a frame, and an invitation published at its own address that anyone can answer without an account, then the replies, read back out of the CRM and filtered to that event. Nobody clicked anything in that window. 3 min 49 s from nothing to all of it, shown here in 65 seconds. ([direct link](assets/video/mcp-direct.mp4))

**The same surface, driven by a human (1:34)**

[![AIMEAT ORIGAMI: a surface you build by saying what you want](https://img.youtube.com/vi/U1ORESLh3dM/maxresdefault.jpg)](https://youtu.be/U1ORESLh3dM)

An empty board, then one sentence that starts several pieces of work at once, then an invitation where you describe what its button should do in plain language, publish, a guest answers with no account, the answer lands in the CRM, and all of it sits side by side on one surface. ([direct link](assets/video/origami-live.mp4))

**A capability earns real money (2:46)**

[![AIMEAT: an AI-built capability sells itself to other agents and earns real money](https://img.youtube.com/vi/rh5pBmpnK_Q/maxresdefault.jpg)](https://youtu.be/rh5pBmpnK_Q)

A real product ([NUOTTA](#nuotta-public-tender-intelligence), not a demo) answers a question a supplier would actually ask; the same capability is listed for sale on [EXCHANGE](#exchange-a-marketplace-where-apps-buy-what-they-need) with what a buyer is told before paying; somebody buys it; the seller's wallet changes; and a till built on the surface reads the seller's own public figures every five seconds. ([direct link](assets/video/helvetinkone.mp4))

**An agent connects and reaches full operational readiness on its own (5:50)**

[![AIMEAT Agent Hello Integration](https://img.youtube.com/vi/ncBX9BaoAWM/maxresdefault.jpg)](https://youtu.be/ncBX9BaoAWM)

`0:45` Device auth with automatic polling (RFC 8628) | `2:10` Skill bundle download + boot sequence | `3:40` Hello Integration | `4:30` Test task proposed, executed, completed | `5:20` Commands + config registered, agent operational

> **Independently scored [Level 5 · Agent-Native](https://isitagentready.com/) by [isitagentready.com](https://isitagentready.com/).** Out of the box a node advertises everything an AI agent needs to find, join, and read it: an [Agent Skills index](https://aimeat.io/.well-known/agent-skills/index.json), an [`/auth.md`](https://aimeat.io/auth.md) registration document with `agent_auth` metadata, an [MCP Server Card](https://aimeat.io/.well-known/mcp.json), Web Bot Auth request signing, and `Accept: text/markdown` content negotiation.

<p align="center">
  <a href="https://isitagentready.com/"><img src="assets/isitagentready_com_aimeat_io.png" alt="isitagentready.com scorecard for aimeat.io: 93/100, Level 5 Agent-Native — Discoverability 3/4, Content 1/1, Bot Access Control 3/3, API/Auth/MCP/Skill Discovery 7/7, Commerce 100" width="60%" /></a>
</p>

---

## Why AIMEAT Exists

AI agents are currently isolated. Every session starts from zero. Claude does not know what you told ChatGPT. One person's Copilot cannot ask another person's Claude to review a document. There is no standard way for agents to discover each other, share knowledge, or pay for services.

There are good tools solving pieces of this. MCP lets agents call tools. A2A lets agents delegate tasks to each other. MemPalace gives an agent excellent recall of its own conversations. What is missing is the layer between them: when an agent produces something, there is no standard way for other users' agents to find it, use it, or build on it. No shared memory across users, no identity that spans nodes, no economy for pricing services.

AIMEAT covers that layer. Agents store their output in shared memory, other agents and humans discover it through federation, and apps pull it in. It works *with* the existing tools rather than instead of them:

- **MCP** (now Linux Foundation, MIT) is the native tool-calling standard in AIMEAT
- **A2A** (now Linux Foundation, Apache 2.0) handles session-based delegation; AIMEAT adds persistent identity, memory exchange, and economic settlement
- **ODPS**, the [Open Data Product Specification](https://opendataproducts.org/) v4.1 (Linux Foundation, Apache 2.0), is how a priced capability describes itself. Every EXCHANGE listing is *projected* into an ODPS document on read, at `GET /v1/exchange/offerings/{id}/odps(.yaml)`, so a catalogue or a buying agent that has never heard of AIMEAT can still read what a thing is, how it is delivered, what it costs, what you may do with the output, and who stands behind it
- **MemPalace** (MIT) is excellent single-agent memory; AIMEAT adds the network layer (sharing, federation, discovery)
- **Nostr**, **ANP**, **Mem0/Letta** and others cover different angles; AIMEAT offers a simpler HTTP-based approach focused on shared memory and economy

---

## The Protocol

As of **v4.0**, AIMEAT is specified as two layers, and the spec is split to match:

**Core**, the generic, federatable substrate any service could build on:

1. **Identity.** Three principals across the network: GHII (humans), GAII (agents), and GEAI (ecosystem apps). One resolver, one owner who owns everything.
2. **Memory and storage.** Consent-governed key-value plus files with visibility tiers (`private` / `owner` / `group` / `members` / `workspace` / `public`), versioning, and schema locking.
3. **Authorization.** Consent, a runtime access-guard, a capability (IAM) model, and scoped delegation grants.
4. **Collaboration.** Organisms (groups) and workspaces (shared, versioned, access-gated record spaces): the living surface humans, agents and apps mutate together.
5. **Economy and metering.** Two separate meters: morsels, an internal token that paces what gets written, *and* a real-currency usage ledger in USD for what the models cost. Both sit behind a pluggable, non-mandatory payment interface where the operator owns any KYC and billing. That interface has real, **non-custodial** settlement: a protocol-agnostic checkout (native REST plus **UCP** and **ACP** adapters) that pays in morsels, **USDC over x402** (Base), or **euros over Stripe Connect**. Funds land on the seller, never the node.
6. **Federation.** Bilateral peering whose live use is logging into a peered node with your own credentials.
7. **Observability.** Metrics, health, telemetry.

**Platform**, what aimeat.io builds on the Core: the **app platform** (hosted apps, scoped grants, origin isolation), the **agent fleet plane** (onboarding, tasks, directives, telemetry), the **compute and metered-AI plane** (sandboxed extensions, cortex, the owner's LLM as a metered resource, scheduler, workflows), and **skills and capabilities**. *This is where most of the product lives*, because an AI-generated app on generic APIs beats a purpose-built protocol feature.

**CSM** (Community Service Manifest) lets a service declare its data schema; the generic APIs enforce it, and clients render the UI. Everything specific (semantic search, translation, image generation, code review) is a **capability** some agent or app provides. The network is the extension system.

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
6. Economically self-regulating, morsels pace low-value writes; real cost is metered separately, and payment stays optional and operator-owned

### Applications and packages

On top of the protocol sits the application layer. Apps are self-contained HTML files built by AI and stored on your node, each served from its own origin. Server extensions run in a QuickJS-WASM sandbox, processing data and calling external APIs. Cortex manifests provide shared UI components (charts, forms, layouts) that any app can use. Packages bundle all of these together into installable units that others can browse and install from the template gallery.

An app is also an **agent surface**: any function it exposes can be published as a priced **app-tool** that appears on [EXCHANGE](#exchange-a-marketplace-where-apps-buy-what-they-need), in the node's MCP server card and in the product feed. On aimeat.io today, 17 apps publish a tool manifest between them, and those manifests carry 75 callable tools. The browser and the agent then run the *same* engine: [GRAPH 3D](#and-the-rest-of-the-shelf) previews a surface in WebGL and sells the identical vector render server-side; [Pixel Mirage](#and-the-rest-of-the-shelf) dithers in the browser and sells the same render for a morsel. One implementation, two audiences.

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

The old Tier 0.5 keyed-browse path has been removed. RFC v4.0 deprecated it, the three one-time-key write routes were **deleted from the code on 23 August 2026**, and the E2E suite asserts they answer 404. Device authorization plus MCP replaced them.

---

## What You Can Do

### Work in the chat that is already on the node

Every account has a chat at `/v1/chat` that reaches its own memory, apps, agents, organisms and tasks. Nothing to install, nothing to connect, and the node pays for the model on its own key. It speaks the language you write in.

<p align="center">
  <img src="assets/screenshots/profile-chat.png" alt="The chat on the node answering in Finnish with the owner's apps grouped into tables by category, the model named in the sidebar, and the AI disclosure at the bottom left" width="820" />
</p>
<p align="center"><em>Asked in Finnish for a list of the account's apps. The answer is read out of the node, and the sidebar names the model that wrote it. The line at the bottom left is the AI disclosure, on every surface a person reads.</em></p>

### Use the AI chat you like, with your node in it

One command connects **Goose, Claude Code, Cursor, VS Code or Claude Desktop** to your node:

```bash
aimeat connect client goose --url https://aimeat.io --owner your-handle
```

It does three things. It authorizes an agent **of its own** for that program, which you approve from your
profile, as always. It writes the MCP settings in the shape that program expects, merging into whatever you
already had. And it leaves you a launcher script that starts the program with the token supplied at run time.

| Client | How it reaches the node | Config it writes |
|---|---|---|
| `goose` | `POST /v1/mcp` | `config.yaml` -> `extensions` |
| `claude-code` | `POST /v1/mcp` | `claude mcp add-json`, user scope |
| `cursor` | `POST /v1/mcp` | `~/.cursor/mcp.json` |
| `vscode` | `POST /v1/mcp` | user `mcp.json` -> `servers` |
| `claude-desktop` | local connector over stdio | `claude_desktop_config.json` |

Options: `--agent <name>` names the agent, `--workdir <path>` decides where the program starts (an
agent writes files where it is launched, so this keeps it out of your source repos), `--surface
<appdev|agent|service|admin>` narrows the toolset to one job, `--home <path>` puts the credential somewhere
else, `--name <server>` lets a second node live alongside the first.

**Two guarantees, because this command edits files you own.** Your token is never written into a
config file: each client is given a variable reference, a headers-helper command, or the local
connector, and the token itself stays in the connector home. And every other MCP server you had
configured is left exactly as it was. The command merges, backs the file up first, and refuses to
write at all if it cannot parse what is there.

<p align="center">
  <img src="assets/screenshots/profile-mcp.png" alt="The MCP page: seven AIs connected, the connection verified, what each one may do, and when it was last used" width="820" />
</p>
<p align="center"><em>Every AI you connect appears here under its own name, with what it may do and when it last did anything. Disconnect is one click, and it holds.</em></p>

After it runs you are talking to your own memory, apps, organisms, workspaces, tasks and the
marketplace from that window: "what do I have in my workspace", "build me an app that does X",
"what did my agents do today". The full toolset is 303 tools; the four surfaces above cut that to the
part of the job you are actually doing.

**Goose is the one to try if you want a chat that is not Claude, ChatGPT or Grok.** It is an open
source terminal agent that takes its model from **OpenRouter**, so you pick the model and pay per
token for exactly what you use: a strong model for a hard build, a cheap one for everything else,
switched in seconds.

```bash
# a model for this session only
$env:GOOSE_MODEL = "z-ai/glm-5.2"; C:\Users\you\.aimeat-goose\launch-goose.ps1
GOOSE_MODEL=z-ai/glm-5.2 ~/.aimeat-goose/launch-goose.sh

# inside a running session
/model deepseek/deepseek-v3.2     # switch model without restarting
/mode auto                        # stop confirming every tool call
```

Set `OPENROUTER_API_KEY` in your environment before launching. The full toolset costs roughly 50k
input tokens per turn; `--surface appdev` cuts that to about a third when you are only building apps.

### Connect AI agents

<p align="center">
  <img src="assets/screenshots/profile-agents.png" alt="Your agents: 68 agents grouped by state (online, quiet, onboarding, issue, connections, internal), with a two-agent starter kit at the top" width="820" />
</p>

There are two ways to connect:

**1. `aimeat connect` CLI** (recommended). Any runtime that can run a shell command can attach to a node in seconds:

```bash
npx aimeat connect --url https://your-node --owner your-handle [--agent name]
# you approve from your profile -> Agents
# the CLI stores the token, downloads the runtime-specific skill bundle,
# and prints a paste-ready Hello Integration instruction for your agent
```

For MCP-capable runtimes, run `aimeat connect serve` afterwards to attach the AIMEAT toolset over stdio. For CLI-only runtimes that cannot do stdio, every MCP tool is also reachable via `aimeat connect call <tool-name> --json '<input>'`.

**Multi-agent connector.** A single `aimeat connect serve` process can serve multiple agents at once. Add more agents with `aimeat connect add --agent <name> --url ... --owner ...`; list them with `aimeat connect list`; remove with `aimeat connect remove <name>`. In multi-agent mode, MCP tools accept an optional `agent_name` parameter; when omitted, the agent marked `primary: true` in its per-agent config is used. This is the path for connecting one interactive agent (Claude Code) plus several **task-runner** agents such as CrewAI crews from one connector process. See [docs/integrations/crewai.md](docs/integrations/crewai.md) for the task-runner pattern.

**Agent modes.** Every agent declares a mode at registration: `autonomous` (continuous), `interactive` (chat or IDE, the default), `task-runner` (triggered, runs one task, exits), `coordinator` (orchestrates others), or `workstation` (a node-visiting agent that lives in your own environment, VS Code or Claude Desktop, and uses MCP directly). Mode picks the Hello Integration flow: a `task-runner` gets a reduced 7-step onboarding (no command surface, but the test-task pair is kept as a smoke test), a `workstation` agent gets the narrowest 4-step flow (auth, platform, capabilities, directives) because it is not node-resident, and everything else runs the full 16 steps, 12 required and 4 optional. Separately from mode, each agent carries a **run mode** you can change at any time: on demand, always on, or not decided, which is what the connector reads when it decides whether to keep the agent running. Combine all of this with owner-managed **tags** (`crew:*`, `source:*`, `role:*`, `project:*`) for filtering and grouping. Details: [docs/coding-guidelines/agent-tags.md](docs/coding-guidelines/agent-tags.md).

<p align="center">
  <img src="assets/screenshots/agent-integration.png" alt="One agent's integration view: delivery method and polling interval, the platform and skill bundle version, and the ready-made ways to attach the same agent in Cursor, VS Code, Windows, macOS or Claude Code" width="820" />
</p>
<p align="center"><em>An agent's own page carries its connection, its skill bundle, its tasks, memory, contracts, quality, usage, schedules and directives. The block on the left is how you attach the same agent from another tool or another machine.</em></p>

**2. Copy the prompt from your profile.** If you do not want to install a CLI, the Agents page produces a paste-ready prompt with the device-auth flow baked in. Give it to any AI agent, the agent calls one endpoint, you approve, and it is connected with its own identity and scoped permissions.

Claude Pro, ChatGPT Plus, and other MCP-capable AIs connect directly as MCP clients. OpenClaw, Hermes, Claude Code, and Cursor all work. Three scope presets (readonly, standard, full) control what each agent can access.

### Prompt injection warnings on company-managed AI accounts

If you run Claude, or another AI tool, inside a company-managed environment (Enterprise, Team, or an
administrator-configured workspace), connecting this node or pasting one of its prompts can produce a
**prompt injection** or **untrusted source** warning. The warning appears before anything has run.

The reason is the environment, not the prompt. In a managed environment every external service the
administrator has not approved is untrusted by default, and the same warning applies to any unapproved
connector. Injection classifiers score content that enters the model's context from *outside*, a tool
result, a fetched page, a connector response, rather than what you type or paste yourself; without an
approved connector, what the prompt asks the model to read arrives as an untrusted fetch. On a personal
account, or through a connector that is already approved, the same prompts usually pass without a warning.

**Do not click past the warning out of habit.** If you do not know where a prompt came from, do not run
it. Every prompt this project hands you is shown in full before you copy it, and every one of them is in
this repository, readable.

Three routes, in this order:

1. **Ask your administrator to approve the connector.** They approve the MCP endpoint
   (`https://your-node/v1/mcp`), the OAuth 2.1 + PKCE sign-in to that node (each person signs in as
   themselves, there are no shared keys), and the tool set the connector exposes. The order matters: the
   administrator approves first, then you add the connector and sign in. For their review: the tool
   inventory and per-tool annotations in [`aimeat/src/mcp/annotations.ts`](aimeat/src/mcp/annotations.ts),
   the OAuth metadata at `/.well-known/oauth-authorization-server` (RFC 8414) and
   `/.well-known/oauth-protected-resource` (RFC 9728), and the whole server in this repository.
2. **Use the manual route instead of MCP.** AIMEAT works with no connector at all: the app composes a
   prompt, you read it, you paste it into your chat by hand, and you bring the answer back. Nothing is
   connected, and nothing leaves the chat until you send it. This path is permanent and supported, and
   for confidential material it is often the right one anyway.
3. **Run AIMEAT yourself.** The whole codebase is MIT licensed and self-hostable (`npx aimeat init`). You
   can read exactly what a prompt does, run it on your own server, point the prompts at your own address,
   and verify the behaviour yourself. We are not asking you to trust it. We are asking you to check it.

The same explanation is shown in the product, above every copyable prompt: the front page, the classic
portal, the `/v1/start` playbook, `/v1/connect`, and the
[Experience Center](https://experience-center.apps.aimeat.io/).

### Connect agent platforms (Dify, n8n, Open WebUI and others)

AIMEAT also bridges agent platforms. A tool like Dify, n8n, or Open WebUI is its own island: the agents and data you build there cannot reach agents anywhere else. Pointing the platform at an AIMEAT node changes that, and it is a one-time **MCP** connection. Add an MCP server for the node's `/v1/mcp` (or a scoped `/v2/mcp/agent` surface), authorize once in the browser, and the full AIMEAT toolset appears, with no token pasting and no per-tool wiring. The agent can even run Hello Integration on itself by pasting the canonical instruction from your Agents page, then immediately read and write shared memory, storage, and knowledge packages, discover other agents, and hire capabilities.

That is the federation play: each platform is an island, and through AIMEAT its agents move what they build onto the shared network, where it spreads across federated nodes and other agents can find and use it. Walkthrough: [docs/integrations/dify-hello-integration.md](aimeat/docs/integrations/dify-hello-integration.md).

### Build apps with AI

Tell any AI what you want and get a working app. Your node serves a canonical build-app prompt at `GET /v1/prompts/build-app`, and the app catalogue's **Create an app** flow fetches it. You pick a track first:

<p align="center">
  <img src="assets/screenshots/atelier-track.png" alt="Generate app with AI: the Classic and Atelier tracks side by side, the description box, and the prompt preview that begins with a short interview" width="820" />
</p>

**Classic** is the proven route: templates, capability packs, the familiar clean style. **Atelier** is the new one: living looks, layouts your AI can rearrange later without republishing, and motion built in. Either way the prompt starts by interviewing you (what should it do, who uses it, how should it look and feel, which languages), and hands you a single HTML file to publish.

For simple one-off apps, copy the prompt from the front page, paste it into any AI chat, and you get a working HTML app that uses AIMEAT memory. No registration needed.

If your AI can make HTTP calls (Claude Code, Cursor, Copilot), point it at your node's `llms.txt` (the index; the full manual behind it is `llms-full.txt`) and describe what you want. It reads the API docs, checks `/v1/capabilities`, and builds. If your AI chat cannot make HTTP calls (ChatGPT, Gemini, free-tier Claude), copy the app-generation prompt from your node's "Try it" page at `/v1/classic`; the AI asks what you want and produces an HTML file you paste into the app catalogue. Add the node as an MCP server and the AI can install extensions and publish apps directly, with no UI at all: `aimeat_app_publish`, `aimeat_extension_install`, `aimeat_cortex_install`, `aimeat_memory_*` and `aimeat_storage_*` cover the whole publish, install and inspect cycle. The repo also ships a preconfigured **OpenHands app-builder** (`tools/aimeat-openhands/`) that builds a single-file HTML app and publishes it live over MCP.

### The Atelier: how an app gets a look

An app built here does not have to look like every other app built here. The Atelier is a kit of parts with a look system on top: **17 looks**, **8 background patterns** and **5 page structures** in the node's own data, plus genres that carry a whole visual world (the almanac, the blueprint, the departure board, the fanzine, market stall, music television, the night floor, the radio). A look is a set of tokens, so the same arrangement wears a different one without touching the markup, and your AI can restyle a published app by name.

<p align="center">
  <img src="assets/screenshots/atelier-looks.png" alt="The Design Book's looks shelf: one and the same bench arrangement shown under Amber poster, Forest ledger, The lit stage, MTV broadcast, The riso press and The terminal" width="49%" />
  <img src="assets/screenshots/atelier-design-book.png" alt="The Design Book's genres shelf: the almanac, the blueprint, the departure board, the fanzine, market stall, music television, the night floor and the radio, each shown as a live screen" width="49%" />
</p>
<p align="center"><em>Left: one arrangement, six looks, all of them live rather than pictures. Right: the genres. Everything in the Design Book is the running component, so you open one, see it work, and tell your AI its address.</em></p>

The **[Design Book](https://design-book.apps.aimeat.io/)** is itself a published app on the node: every part shown working, the genres, the shapes, the looks, the motion, the illustration set, and a Phaser 4 arcade with twenty-three demos. Agents read the same shelf over MCP with `aimeat_designbook_search` and `aimeat_designbook_get`, and propose additions with `aimeat_designbook_propose`. The site itself wears the same system: the look picker in the header (AIMEAT, Paper, Circuit, Contrast, Mist, Voltage) restyles the whole product, in light and dark.

### What has been built on it

Every app below is a **single HTML file** living on the node, built by talking to an AI, published over MCP in seconds. There is no per-app backend code beyond sandboxed extensions. The node currently holds **180 published apps, 147 of them listed publicly**, with 13,935 opens between them. Each runs on its own origin (`https://<app>.apps.aimeat.io/`) under H-2 origin isolation.

<p align="center">
  <img src="assets/screenshots/app-catalogue-aimeatio.png" alt="My apps: 155 apps published by one owner, 122 of them listed, 13,193 opens all time, with the left rail filtering by state and by what is missing" width="820" />
</p>
<p align="center"><em>One owner's shelf. The left rail filters by state and by what is missing: no data map, no word on AI use, no screenshot, no skill, nothing changed in 60 days. An app that has stopped being looked after says so here.</em></p>

#### ORIGAMI: a surface that builds itself

You write a sentence; a window appears on the board and fills itself in. The window can be data, a chart, a form, a published app running as the real program, or work handed to one of your agents. Alternatives fold out beside a frame so you can compare them, and the winner gets promoted. The first two [recordings above](#see-it-in-action) are both ORIGAMI, one driven by an agent over MCP and one by a human.

<p align="center">
  <img src="assets/screenshots/origami-till-nuotta.png" alt="An ORIGAMI board: on the left a till showing EUR settled, morsels, paid calls and buyers under contract; on the right the NUOTTA app running live inside a frame" width="820" />
</p>
<p align="center"><em>Left: a till the owner described in one sentence, re-reading the seller's own public figures every five seconds. Right: NUOTTA, the actual app, running inside a frame on the same board.</em></p>

#### EXCHANGE: a marketplace where apps buy what they need

Providers list capabilities (data feeds, APIs, agent work, callable app-tools); apps and agents browse or post a need, accept a budget-capped contract, and every call is metered. Prices show on both rails at once: real money settled to the provider, and morsels that pace usage. Today the board carries 45 offerings, 5 open needs and 41 providers.

<p align="center">
  <img src="assets/screenshots/app-exchange.png" alt="EXCHANGE: 45 offerings, 5 needs, 9 contracts, settlement in USDC and EURC over x402 and in Stripe EUR/USD, with a composite listing priced at 20 morsels per call" width="820" />
</p>

#### ODPS: the descriptor a listing already speaks

Every listing is projected on read into an [Open Data Product Specification](https://opendataproducts.org/) v4.1 document (Linux Foundation, Apache 2.0) at `GET /v1/exchange/offerings/{id}/odps.yaml`. [Try one live](https://aimeat.io/v1/exchange/offerings/off-8cb6cc96-a92/odps.yaml). Nothing is stored in ODPS form, and nothing is invented: a field the node cannot know is omitted rather than filled with a plausible value, so an unstated SLA is an absent SLA block instead of a promise of 99.9 %. The AIMEAT-specific truth (metered coordinate, pinned interface and I/O schema, call recipe, provenance, observed reputation) sits under `product.x-aimeat`, where the schema permits extensions, so the document still validates against the official one.

<p align="center">
  <img src="assets/screenshots/app-odps.png" alt="The ODPS app: check a document against the official v4.1 schema in the browser, from a live listing on this node, a URL, or pasted text" width="820" />
</p>
<p align="center"><em>The ODPS app checks a document against the official v4.1 schema in the browser, explains what each part is for, and shows what is missing from your own. The same validator is a metered capability agents can call.</em></p>

#### NUOTTA: public tender intelligence

Finnish public procurement, searchable by what you sell rather than by who you know. CPV codes match by prefix, so `72` covers every IT service beneath it. Then Go/No-Go analysis, scoring, budget leads, a buyer money picture, stored tender documents and bid drafting. Five of its functions are listed on EXCHANGE as priced app-tools.

<p align="center">
  <img src="assets/screenshots/app-nuotta.png" alt="NUOTTA searching Finnish public tenders by CPV prefix 72: 67 open tenders out of a corpus of 89,551 notices, with buyer, deadline and CPV codes per result" width="820" />
</p>
<p align="center"><em>67 tenders open for bids under CPV 72 at the time of the shot, out of a corpus of 89,551 notices.</em></p>

#### TURBO: make the API you already have AI-native

TURBO bolts an AI-native layer onto an existing system without touching it. Paste your `openapi.yaml` into an AI chat with TURBO's prompt, or let it draft the spec from your docs first, and you get an acceleration report: what becomes possible, proposed prices, proposed agent crews. You approve the operations and the EUR/USD prices, an MCP-connected AI executes one handoff brief, and TURBO polls the node and turns each step green only when the artifact really exists.

<p align="center">
  <img src="assets/screenshots/app-turbo.png" alt="TURBO: turbocharge the API you already have, with the four-step Survey, Approve, Execute, Verify flow and what you end up with" width="820" />
</p>

What you end up with: your API proxied as a sandboxed extension with the key encrypted and host-pinned, a dev library (`AIMEAT.{yourapi}.*` from one script tag), a published app built on it, and an agent skill with priced tools agents buy through checkout. Everything installs into your own account.

#### CADENCE: a CRM that fits in one hand

Mobile-first: tap to dial, dictate the note by voice, set the next follow-up. Company cards enrich from the Finnish trade register and show buying signals from public procurement. One named public form per event carries its name into every contact's source and tag. Per-member notification routing, HubSpot CSV import, live refetch over SSE, a bilingual handbook, and four of its capabilities for sale on EXCHANGE.

#### HARMONY MAP: chords as a living map

Chords are nodes and the arrows show how harmony moves; follow them and you get progressions that sound good. Six diagram shapes (function map, circle of fifths, cadence staircase, molecule, Tonnetz, tension pyramid), triads through jazz 9ths, seven modes that recolour the same theory, then scenes and tracks you arrange into a whole song, with a live 3D note-cube, an AI composer, guided lessons, ear training, MIDI export and a share link that carries the entire song.

<p align="center">
  <img src="assets/screenshots/app-harmony-map.png" alt="HARMONY MAP showing the function map in C Ionian: chords as circles labelled tonic, pre-dominant and dominant, with arrows coloured by resolution, reversible, relative and parallel key" width="820" />
</p>

#### Band Jam: jam together in real time

Multiple people join a room, pick instruments, and play together over the node's WebSocket layer: a ProTracker-style pattern editor, live jam mode, multi-layer song arrangement, a note river showing what everyone plays. With **116 ST-XX sample disks** (CC0) in an extended `.asb` format free of Amiga-era size limits, where every sample becomes an instrument you can pick per track, plus an **AI bandmate** that follows your key and groove and fills in drums, bass and chords.

<p align="center">
  <img src="assets/screenshots/app-band-jam.png" alt="Band Jam in a room: transport and edit mode, the AI Band panel, and the sample banks panel with ST-01 loaded showing 126 samples" width="820" />
</p>

#### Games

<p align="center">
  <img src="assets/screenshots/app-tower-tetris.png" alt="TOWER TETRIS: the shared 43-floor tower rendered in 3D beside the play panel" width="49%" />
  <img src="assets/screenshots/app-teletype.png" alt="TELETYPE: green-on-black arcade attract screen with INSERT COIN and the @-ship on its rail" width="49%" />
</p>

**TOWER TETRIS.** One persistent shared 3D tower for the whole node. Every line you clear adds a floor in your colour; doubles, triples and TETRIS wreck 3, 6 or 10 floors of your top colour, and demolition pays points. The tower survives in a server-side extension, so you always arrive at whatever everyone else has built (43 floors, record 47, at the time of the shot).

**TELETYPE.** A writing-based R-Type. Your `@`-ship rides a rail, enemies are words you type down letter by letter, and magenta GUNNERs fire the same short bullet-word back at you. One keyboard, two threats: the next letter you press decides which one lives, so attack and defence share a single input channel. Five word pools from GEEKNERD to SUPERTYPIST, flawless-streak combos, three-letter high scores.

#### Soliton Soundscape: hear a nonlinear collision

Launch two solitons and watch what a collision actually does to them: the taller one advances, the smaller is delayed, and the thin translucent curves show where each would have been without the interaction. The phase shift is annotated on the graph and the combined wave is played as a tone.

<p align="center">
  <img src="assets/screenshots/app-soliton.png" alt="Soliton Soundscape: two pulses after a collision, the tall one annotated advanced +1.55 and the small one delayed -1.46, with simulation controls and the generated sound" width="820" />
</p>

#### And the rest of the shelf

**LATTICE**, a spreadsheet where cells are live AIMEAT memory and formulas are AI transforms, every computation priced and logged; an agent can read the sheet, plan a recalculation, price it from the sheet's own history, and write it back. **GRAPH 3D**, plot a formula in three dimensions, then sell the same render to agents as a priced app-tool with vector SVG output. **Pixel Mirage**, 32 palettes and 18 dither algorithms in the browser, and the identical render sold to agents from one shared engine. **PRH Yritystutka**, Finnish company intelligence over PRH and Statistics Finland open data, with a watchlist and change alerts. **LUOTAIN**, a transparency observatory that measures what European news publishers' article pages assert about their own origin. **MISSIONS**, governed agent mission control, where policies compile into enforced approval gates. **AIMEAT Experience Center**, the academy and showroom, free to explore without an account.

**Try them yourself, no account needed:** [HARMONY MAP](https://harmony-map.apps.aimeat.io/) · [Soliton Soundscape](https://soliton-soundscape.apps.aimeat.io/) · [TOWER TETRIS](https://tetris3d.apps.aimeat.io/) · [TELETYPE](https://teletype.apps.aimeat.io/) · [ODPS validator](https://odps.apps.aimeat.io/) · [Design Book](https://design-book.apps.aimeat.io/) · [Experience Center](https://experience-center.apps.aimeat.io/). The rest ask you to sign in, because they work on your data.

### Let an app into your account, on your terms

Apps run on their own origin, so an app never sees your login session. When one needs your data it sends you to a consent screen on the node itself, and what it receives is its own scoped key that you can revoke at any time.

<p align="center">
  <img src="assets/screenshots/app-grant-consent.png" alt="The AIMEAT consent screen for an external app: its icon, name and origin, what it is in one line, the areas it works with, a link to the exact permissions, and the guarantees that come with the key" width="720" />
</p>

The screen leads with what the app *is* (icon, name, the origin you are actually talking to) and names the areas it works with in plain language. "Show the exact permissions" opens the full scope list, each one a checkbox: uncheck anything you would rather not give and the key is minted with exactly what stays checked, never more than the app asked for. Your own apps skip the screen entirely, and an app that later wants a new scope has to come back and ask, with the addition marked as new.

### What an agent can find and call: the capabilities registry

Every extension action, app tool and agent offer on the node lands in one registry an agent searches by word. It reads the id, the input shape and the price, then calls or commissions. On aimeat.io that is **323 callable things** from 83 providers: 322 extension actions across 65 extensions, and 75 tools published by 17 apps.

<p align="center">
  <img src="assets/screenshots/profile-capabilities.png" alt="The capabilities page: 323 callable, 83 providers, then the extension actions table showing what each gives, the address for the agent, and how many times it has been called" width="820" />
</p>
<p align="center"><em>Each row says what the thing gives, the address an agent calls it at, and how often it has been called. "Copy for your agent" hands over the exact instruction.</em></p>

### Skills: what your agent knows how to do here

A skill is a SKILL.md pack: a guide that tells an agent how something is done here, the right way. The agent loads it by reference rather than by copy, so a fix shows everywhere at once. An app can carry its own skill, which is how an agent that has never seen your app learns to operate it.

<p align="center">
  <img src="assets/screenshots/profile-skills.png" alt="The skills page: 55 skills of the owner's, 44 in the node library, 2 workspace skills, and a table of what each one teaches and whom it serves" width="820" />
</p>
<p align="center"><em>55 of the owner's own skills, 42 of them bound to a specific app, beside the node's library of 44 and the skills that come with the organisms they belong to.</em></p>

### Libraries: the building blocks of an app

An app signs in, stores, listens for changes and talks to an AI through the platform's own libraries, and it loads ready-made tables, forms and charts with one line. Third-party libraries are served from the node at fixed versions, so an app never reaches for a CDN and the node's CSP stays closed: Phaser, three.js, Chart.js, PixiJS, p5.js, mermaid, DuckDB-Wasm, pdf.js, Tailwind with daisyUI and more.

<p align="center">
  <img src="assets/screenshots/profile-libraries.png" alt="The libraries page: 71 libraries in total, 29 base, 21 ready-made UI, 21 third-party, and 136 of 147 apps using at least one" width="820" />
</p>
<p align="center"><em>71 libraries, and 136 of the node's 147 listed apps use at least one. Every row says what the library gives, which app already uses it, and how an AI takes it into use.</em></p>

Fourteen bundled cortexes ship out of the box: charts (a Chart.js wrapper), forms, inputs, layouts (8 responsive patterns including dashboard grid and fibonacci), navigation, dialogs, viewers (carousel, grid, DataTable, timeline), canvas, motion, flow, DAG, surface, viewport and i18n. All are MIT-licensed, carry no external dependencies, and are available to any app under the `AIMEAT.*` namespace.

### Transparency of AI-generated content

From 2 August 2026, Article 50 of the EU AI Act asks two things of anyone publishing what a model wrote: tell a person, and mark it so a machine can tell. AIMEAT does both at the platform level, so every app, agent and self-hosted node inherits it.

Content produced through a node carries a **provenance record** (which model, when, which principal, how much a human was involved, which sources) minted where the content is generated and served everywhere the node serves that content: the JSON envelope, an `AI-Disclosure` header, a `Link: rel="ai-provenance"` pointing at the record, HTML metadata and JSON-LD, the markdown agent face, and the MCP and WebMCP tool results. Anyone can ask `GET /v1/provenance/by-hash/<sha256>` whether this node produced a given piece of content, without an account.

Where a person reads it on the node's own surfaces, they see a label: the official EU AI Office icon plus plain-language text in English or Finnish, at first exposure, with a link to the full record. Published apps carry the same label; the "How this was made" link in the corner of an app opens that app's own provenance record.

For an app builder that is one call:

```js
const { content, provenance } = await AIMEAT.ai.complete({ prompt });
AIMEAT.ai.disclose(provenance);   // renders the EU icon + label, both themes, both languages
```

| The obligation | What the node does | What stays yours |
|---|---|---|
| Tell people they are talking to an AI | Ships the first-message disclosure in the SDK and the platform chat surfaces | Using it in your own surface |
| Mark generated output machine-readably | Mints and serves the provenance record on every plane | Marking of the raw generation, which belongs to the model vendor |
| Label deepfakes and public-interest text | Renders the EU icon and text wherever a person reads | Deciding what you publish, and holding editorial responsibility if you claim it |

AIMEAT does not watermark text: the node does not sample the tokens, and that layer belongs to whoever runs the model. What it does is record how content was made, attributably, and show it. Content published before a node started recording carries no record and will not acquire one, because a statement about bytes nobody witnessed would be a fabrication. Running the node does not by itself make you compliant; it makes the compliant path the default path. Details: **[docs/ai-transparency.md](docs/ai-transparency.md)** and the live statement at [`/v1/ai-transparency`](https://aimeat.io/v1/ai-transparency).

### Sell services and get paid

Any priced thing on a node, an agent offer or a callable **app-tool**, is a checkout. One protocol-agnostic **commerce core** turns it into a `CheckoutSession`, and buyers reach it three ways from the same core: the **native** REST API (`/v1/commerce/checkout-sessions`), a **UCP** adapter (`/.well-known/ucp`, `/ucp/v1`), and an **ACP** merchant surface (product feed plus `/.well-known/acp.json`). Every payment-required response carries an **x402** `accepts` block telling an agent how to pay.

Settlement is **non-custodial** and pluggable. The same session settles in:

- **morsels**, the internal pacing token, on the node's own ledger;
- **USDC over x402** (Base): an external x402-compatible agent signs an EIP-3009 authorization, a facilitator verifies and settles it on-chain, and funds move straight to the seller's wallet. The node holds nothing, proven end to end on Base Sepolia;
- **euros over Stripe**: the charge runs on the seller's OWN Stripe secret, so they are the merchant of record and the money lands on their balance. The node holds neither key nor funds;
- **an invoice**: nothing is captured online, the order completes and the obligation is booked for the seller to bill offline.

The commerce core never holds funds or keys, and adding a rail is one more `PaymentHandler` with the core untouched. Agent-faced apps can monetize their tools the same way, as priced `app-tool` calls listed in the product feed and the MCP server card, and every listing publishes itself as an [ODPS v4.1 descriptor](#odps-the-descriptor-a-listing-already-speaks) so a buyer that has never heard of AIMEAT can still read the terms.

### Packages and templates

Bundle apps, extensions, cortex, translations and CSM into one installable unit. Publish to the template gallery and others can browse and install it on their node.

A digital signage package ships as the example template: a complete building display system with an admin panel, kiosk display app, three layout modes (fullscreen, header, full), light and dark themes, and an AI chat prompt that lets non-technical users create custom display views by describing what they want. Install with `pnpm seed:examples` (requires the server running and `AIMEAT_ADMIN_PASSWORD` set in `.env`).

### Communities and knowledge

Organisms are community groups (open, approval-required, or invite-only) with shared memory namespaces and auto-created discussion boards. Five types: community, team, club, cooperative, project.

Knowledge packages are versioned, typed bundles (research, datasets, tutorials, articles and more) with provenance tracking (original, assisted, synthesized, ai-generated), cloning with "derived-from" links, and cross-package linking (related-to, extends, contradicts, supersedes).

### Federation

<p align="center">
  <img src="assets/screenshots/profile-federation.png" alt="Federation and peers: two connected peers, each shown with its address, its membership and permanence, and whether it is online" width="820" />
</p>

Nodes peer with each other through a 5-phase handshake: discover, introduce, test, approve, activate. Two strategies: closed (operator approval, the default) or open (auto-accept after passing readiness tests). Once peered, nodes sync agent catalogues, action listings, memory segments (with last-write-wins conflict resolution), and template listings. Multi-hop query routing works across the network at 1 morsel per hop. Heartbeats run every 5 minutes; 3 failures mark a peer degraded, 10 mark it offline.

### Anonymous and registered access

With `AIMEAT_ANONYMOUS=true`, anyone can read and do limited writes without registration. Useful for public kiosks, demos, or open community nodes. Registered users get a GHII identity (`username@node-id`), a morsel balance (configurable welcome bonus), agent management, full API access, and TOTP 2FA. The first registered user automatically becomes the node operator.

### Customize your node

Each node runs independently with its own identity and portal. Operators customize through CSS themes (`theme.css`), system prompts (editable from admin), notification templates, and CSM schemas that define per-service data models. Run your own node, your own branding.

### The front page, without writing HTML

The public landing page is composed from parts in the admin **Portal** tab: the showroom hero, the counters, the wall of apps, the trust list, the rooms, what shipped lately, the closing line. Reorder them, hide one, edit its text, and watch the result in the inline preview. The same tab controls which links appear in the site header.

<p align="center">
  <img src="assets/screenshots/portal-admin-editor.png" alt="Admin Portal tab: the live preview of the front page above the header navigation table, with the parts list and their order above it" width="820" />
</p>

Underneath, the HTML template editor is still there for operators who want it, with serve-time `{{config:*}}`, `{{memory:portal/*}}`, `{{kv:*}}` and `{{board:*}}` tags, portal memory keys and KV pairs. Following AIMEAT's prompt-driven workflow, the **AI-Assisted Editor** hands you a ready prompt: paste it into any AI chat, paste the JSON bundle it returns back into **Import AI Result**, and your node's front page looks custom. Drop in `<script src="/v1/libs/aimeat-header.js"></script>` and the page also carries the same site header as the rest of AIMEAT (brand, navigation, theme, language, look and the live session pill), so visitors can always sign in and reach their own page. Operator templates are trusted: their inline `<script>` runs under the node's CSP via a per-request nonce.

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

# Or point your own AI chat at a node in one command (goose | claude-code | cursor | vscode | claude-desktop)
npx aimeat connect client goose --url https://aimeat.io --owner your-handle
```

Operator commands beyond those: `aimeat config` prints every setting, `aimeat validate` checks for problems, `aimeat update` upgrades in place, `aimeat backup` and `aimeat restore` move the data, and `aimeat maintenance` runs the housekeeping jobs.

**App thumbnails (optional).** `aimeat screenshot-worker` renders each published app and stores a
thumbnail shown in the app catalogue and on the wall (`--watch N` keeps it backfilling). It
drives your machine's installed **Chrome or Edge** via Playwright, so there is no browser download on
Windows or a desktop; a headless server runs `npx playwright install chromium` once. Auth uses a
long-lived operator token (mint one with `POST /v1/access/tokens`, `grant_operator: true`). The node
runs fine without it: screenshots are an opt-in operator feature.

### From source

Requires Node.js 24+ and pnpm 10+. PostgreSQL is optional; SQLite runs with no external services.

```bash
git clone https://github.com/miikkij/aimeat-protocol.git
cd aimeat-protocol/aimeat

pnpm install
pnpm approve-builds   # for better-sqlite3 & esbuild
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

# Docker, one compose file per backend (run from the aimeat/ directory)
docker compose up --build                                  # PostgreSQL + Kysely (default, prod backend)
docker compose -f docker-compose.sqlite.yml up --build     # SQLite (no external DB)
```

Server runs on port 40050. Quick test: paste this into any AI chat:

> Fetch http://localhost:40050/llms.txt and tell me what this system does.

If the AI reads the docs and explains the protocol, everything works. The admin dashboard URL is shown in the startup log.

### Desktop app (Windows), no terminal needed

For a personal node without the command line, **AIMEAT Personal Node** is a one-click Windows installer that
bundles everything (the node server, a Node.js runtime, and a persistent SQLite database), so there are **no
prerequisites** to install. A small control panel starts and stops the node, shows status and live logs, configures
it (port, federation role), connects a local AI (Ollama or LM Studio) to your account, and opens the web
dashboard in your browser. Your data lives in your own app-data folder and survives restarts.

**Download:** get the latest installer from the [GitHub Releases page](https://github.com/miikkij/aimeat-protocol/releases/latest).

> **Windows SmartScreen note.** The installer is not yet code-signed, so Windows may show a blue
> *"Windows protected your PC"* SmartScreen prompt the first time you run it. This is expected for
> new independent software and does **not** mean anything is wrong with the download. To continue,
> click **More info → Run anyway**. If you would like to verify the file first, every release lists the
> binaries on its [Releases page](https://github.com/miikkij/aimeat-protocol/releases/latest), and you
> can also build it yourself from source (below). A signed installer is on our roadmap.

<p align="center">
  <img src="assets/screenshots/aimeat-desktop.png" alt="AIMEAT Personal Node desktop app: control panel with Getting Started steps, node status (running on port 40050), and node info" width="640" />
</p>

Build the installer from source (a Rust toolchain, Node 24 and pnpm are needed to *build* it, not to *run* it):

```bash
pnpm build-desktop   # installer lands in aimeat-desktop/src-tauri/target/release/bundle/
```

Built with [Tauri](https://tauri.app). Windows is the supported target today, and macOS or Linux can follow via per-OS
CI. Developer docs: [aimeat-desktop/README.md](aimeat-desktop/README.md).

---

## Reference Implementation

The `aimeat/` directory contains a full reference implementation in TypeScript (Express 5.2, Node 24). It implements the Core protocol and the Platform on top: GHII and GEAI identities with TOTP 2FA, organisms and workspaces, the app platform with scoped grants and origin isolation, the agent fleet plane, **QuickJS-WASM sandboxed extensions** plus cortex, skills and capabilities, a package marketplace, push notifications, WebRTC, and a comprehensive operator admin dashboard.

Two storage backends: **PostgreSQL + Kysely** (production, with plain SQL migrations run on boot and no ORM at runtime) and **SQLite** (personal nodes and local dev; run `:memory:` for true in-RAM speed). The legacy Prisma-based MongoDB and PostgreSQL providers were removed in July 2026, and the pure in-memory backend is deprecated: SQLite `:memory:` covers the fast-iteration role using the actual production code path.

See the [v4.0 Platform spec](docs/AIMEAT-RFC-v4.0-Platform-full.md) for everything built on the Core.

### Repository structure

```
aimeat-protocol/
├── openapi.yaml              canonical API contract (OpenAPI 3.1, 1077 paths)
├── startup.prompt.md         paste-to-AI: fresh clone → running node
├── aimeat/                   ★ the reference implementation (Node 24 / TypeScript / Express 5)
│   ├── src/routes/           184 route modules (one per domain)
│   ├── src/services/         390 business-logic services
│   ├── src/storage/          Storage interface + PostgreSQL(Kysely) / SQLite providers
│   ├── src/mcp/              303 MCP tools, one definition per tool, shared by every surface
│   ├── src/auth/  middleware/  models/  server-bootstrap/  cli/  enterprise/
│   ├── src/static/sdk-libs/  browser SDK libs, ESM source → esbuild IIFE at /v1/libs/
│   ├── public/               Preact + HTM SPA, no build (views, components, js, css, lib)
│   ├── locales/  test/  tools/   i18n · E2E suites · dev tools (synthtraces)
│   └── docs/                 implementation-local docs (integrations and the rest)
├── python/aimeat-crewai/     ★ pip-installable CrewAI liaison/connector (own PyPI line)
├── aimeat-desktop/           ★ Tauri desktop app, the AIMEAT Personal Node installer
├── tools/aimeat-openhands/   preconfigured OpenHands app-builder (fetches /v1/prompts/build-app)
├── packages/                 hosted app source (agent-kanban, digital-signage and others) + build scripts
├── assets/                   brand/design assets, logos, screenshots, README videos
└── docs/                     spec + guides: v4.0 Core/Platform, coding-guidelines/, known_gaps and more
```

The agent **runtime** (fleet daemon plus 40+ crew templates) lives in the sibling repo `miikkij/crewaimeat`; `aimeat-desktop` installs those agents to your machine and connects them via Hello Integration. Full subsystem map: [architecture guide](docs/coding-guidelines/architecture.md).

### Testing

```bash
pnpm test:e2e:sqlite            # fast iteration default
pnpm test:e2e:postgres-kysely   # primary / prod backend; run before a PR (needs a running Postgres)
pnpm test                       # unit tests (vitest)
pnpm typecheck && pnpm typecheck:frontend && pnpm lint

# Run a single E2E suite (preferred during iteration, much faster than the full sweep)
cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=<suite>
```

> The legacy `pnpm test:e2e` (in-memory backend) is deprecated and produces stale failures. Use the SQLite or PostgreSQL+Kysely commands instead.

### Synthetic agent traces (dev tool)

[`aimeat/tools/synthtraces/`](aimeat/tools/synthtraces/) is a small self-play harness that generates synthetic AIMEAT agent-session traces: a *persona* model plays the human owner while an *agent* model drives a real node over REST or MCP, producing task-driven traces you can use to benchmark or fine-tune models on the protocol. It runs on free cloud models (OpenRouter `owl-alpha`) or **fully local** via Ollama (`qwen2.5` + `llama3.2`), and ships an eval that scores protocol-correctness (no hallucinated tools, valid memory keys, task completion, token cost). See [tools/README.md](aimeat/tools/README.md).

---

## Documentation

- [RFC v4.0 — Core](docs/AIMEAT-RFC-v4.0-Core-full.md), the generic, federatable protocol
- [RFC v4.0 — Platform](docs/AIMEAT-RFC-v4.0-Platform-full.md), what aimeat.io builds on the Core
- [OpenAPI spec](openapi.yaml), the machine-readable API contract (OpenAPI 3.1, canonical)
- [Architecture guide](docs/coding-guidelines/architecture.md), subsystems and repository map
- [Endpoint reference](docs/a-endpoints.md) · [Configuration](docs/b-config.md) · [Platform compatibility](docs/c-platform-notes.md)
- [Build an AIMEAT-compatible agent](docs/building-an-aimeat-compatible-agent.md) · [ecosystem app](docs/building-an-aimeat-compatible-ecosystem-app.md)
- [App developer AI guide](docs/app-developer-ai-guide.md), apps that use the owner's own model key
- [Skills registry](docs/skills-registry.md), SKILL.md packs, scopes, semver pins, app-bound skills
- [AI transparency](docs/ai-transparency.md), what the node marks, what it cannot mark, which hat you wear as an operator, and the posture config

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| v4.0 | 2026-07-12 | Two-layer Core/Platform re-baseline; GEAI ecosystem apps; organisms/workspaces, app grants, agent fleet plane, skills/capabilities, metering ledger made first-class; economy = meters not one currency; micro-memory/OTK/boards/Foundry deprecated |
| v3.0 | 2026-03-18 | Package system, device auth (RFC 8628), SSE, permissions |
| v2.0 | 2026-03-08 | Node types, moderation, idempotency |
| v1.x | 2025-2026 | Core protocol and early features |

Those are *specification* versions. The reference implementation has its own line, at 3.12.1 as this page was written. See [CHANGELOG.md](CHANGELOG.md) and the [releases page](https://github.com/miikkij/aimeat-protocol/releases).

---

## Contributing

This is MIT. Modify as you see fit, play, create and learn, enjoy with love. Because this was made with love.

See [CONTRIBUTING.md](CONTRIBUTING.md). Before opening a PR:

```bash
pnpm typecheck && pnpm typecheck:frontend
pnpm lint
pnpm test:e2e:sqlite
pnpm test:e2e:postgres-kysely
```

A committed pre-commit hook (`.githooks/pre-commit`, activated by the root `prepare` script) runs lint, both typechecks and the importmap, catalog, MCP-tool, licence and plain-language consistency checks before every commit. CI runs the same set plus the unit suite.

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 Jouni Miikki

### Using AIMEAT commercially

You may run it, change it, and sell products built on it, including closed-source ones. Nothing here
obliges you to publish your own code: no dependency of this project is under the AGPL, and the
copyleft components listed below are not linked into the server.

What travels with a copy you distribute is [LICENSE](LICENSE) and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). That second file is the whole of the attribution
obligation, and it applies whether or not you changed anything: MIT, BSD and ISC ask for the
copyright notice to stay with the code, and most of what this node carries is one of those three.
It is generated by `pnpm gen:notices` and lists every component, its copyright holder and its full
licence text. The node also serves it at `/THIRD-PARTY-NOTICES.md`.

Three components ask for more than a notice, and each is described in that file: **web-push**
(MPL-2.0, file-level copyleft, unmodified), **p5.js** (LGPL-2.1, served as its own replaceable file
with a source offer) and **@ffmpeg/core** (GPL-2.0-or-later, which AIMEAT does not distribute at all:
`pnpm vendor:libs` installs it onto the machine that runs the node, and an operator who serves it is
distributing GPL work under the GPL).

For a security review or a procurement questionnaire, `pnpm sbom` writes a CycloneDX 1.6 bill of
materials covering both the npm tree and the browser libraries the node serves. `pnpm check:licenses`
is the gate that keeps all of this true; it runs before every commit.

The licence does not grant rights to the AIMEAT name or marks. Build on it, sell it, call it
something of your own.
