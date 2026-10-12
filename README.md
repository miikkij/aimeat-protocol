# AIMEAT

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/miikkij/aimeat-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/miikkij/aimeat-protocol/actions/workflows/ci.yml)
[![Agent-Ready: Level 5](https://img.shields.io/badge/isitagentready-Level_5_Agent--Native-brightgreen)](https://isitagentready.com/)
[![AgentGrade](https://agentgrade.com/api/badge?url=https%3A%2F%2Faimeat.io)](https://agentgrade.com/s/aimeat.io)
[![EU AI Act Art. 50: transparency built in](https://img.shields.io/badge/EU_AI_Act_Art._50-transparency_built_in-003399)](https://aimeat.io/v1/ai-transparency)

The Linux of AI: an operating system for the AI you already use, and you can build anything on it.

**Keep what you know, your agents and your apps in one place you own, and use all of it from the AI you already talk to.**

Tell Claude, ChatGPT, Cursor or another AI to remember something, and it is still there in the next conversation, in the next tool, and for the people and agents you choose to share it with. Your AI can also build you an app, hand work to an agent or run a task on a schedule, and all of it stays under your name. You see which AI did what, and you take its access back with one press.

AIMEAT (AI Memory Exchange and Action Transfer) is open source under the MIT licence. It runs on [aimeat.io](https://aimeat.io/), on your own server, or on your own computer.

<p align="center">
  <img src="https://raw.githubusercontent.com/miikkij/aimeat-protocol/main/assets/screenshots/portal-landing.png" alt="The aimeat.io front page: Try it all. Then own it., with a box that asks what you want built and links to plug in the AI you already use" width="820" />
</p>

## Three ways in

### 1. Connect the AI you already use

Add this address to your AI as a connector (some tools call it a custom connector or an MCP server):

```text
https://aimeat.io/v1/mcp
```

Sign in when your AI asks, and choose what it may do: read only, standard, full, or exactly the permissions you tick. Then ask it in the chat what it can do in AIMEAT.

<p align="center">
  <img src="https://raw.githubusercontent.com/miikkij/aimeat-protocol/main/assets/mcp_1_add_custom_connector.png" alt="claude.ai's Add custom connector dialog with the name aimeat.io and the address https://aimeat.io/v1/mcp" width="40%" />
  <img src="https://raw.githubusercontent.com/miikkij/aimeat-protocol/main/assets/screenshots/profile-mcp.png" alt="The MCP page in AIMEAT settings: every connected AI under its own name, what it may do, when it was last used, and a Disconnect link for each" width="56%" />
</p>

- **The steps for each AI tool**, with every field value, are on the [Connect your AI](https://aimeat.io/v1/connect-your-ai) page. The same table for software is served at [`/v1/ai-tools`](https://aimeat.io/v1/ai-tools). Signed in, the [MCP page](https://aimeat.io/v1/profile?tab=mcp) in your settings shows every connected AI and disconnects any of them.
- **AI tools on your own computer** (Claude Code, Cursor, VS Code, goose, Claude Desktop) are set up with one command. It registers the tool as an agent of yours, which you approve on the Agents page, and writes the tool's MCP settings without putting the token in them:

  ```bash
  npx aimeat connect client claude-code --url https://aimeat.io --owner <your-handle>
  ```

  The options, the guarantees and the other clients: [Connecting an AI client](https://github.com/miikkij/aimeat-protocol/blob/main/docs/c-platform-notes.md).
- **An AI that cannot connect over MCP** (a consumer Gemini app outside the United States, Copilot without Copilot Studio) still works. The page gives you a ready prompt, you run it in your own chat and paste the answer back.
- **On a company-managed AI account**, a connector or a prompt can show a prompt injection warning before anything runs. [What it means and what to do](https://github.com/miikkij/aimeat-protocol/blob/main/docs/c-platform-notes.md#prompt-injection-warnings-on-company-managed-accounts).

aimeat.io is the demonstration node. It is free to try and it runs for real. To keep your knowledge on a machine of your own, take the second way in.

### 2. Run your own node

```bash
npx aimeat init     # asks a few questions and writes .env: storage, the node's name, its keys
npx aimeat start    # serves http://localhost:40050
```

You need Node.js 24 or later. SQLite needs no database server; PostgreSQL is the production backend. Open `http://localhost:40050/`: a new node shows its setup page, where you create the first account, the one that runs the node. Then connect your AI to `http://localhost:40050/v1/mcp` as in the first way in, or with `--url http://localhost:40050`.

- **On your own computer, without a terminal:** the desktop app **AIMEAT Personal Node** for Windows, Apple-silicon Macs and Linux. It attaches the AI tools on the computer to your AIMEAT (aimeat.io or your own), and it can run a node of your own on port 41050. The installers are on the [desktop-latest release](https://github.com/miikkij/aimeat-protocol/releases/tag/desktop-latest). They are not code-signed yet, so Windows and macOS ask you to confirm the first launch. Details: [aimeat-desktop/README.md](https://github.com/miikkij/aimeat-protocol/blob/main/aimeat-desktop/README.md).
- **From source or with Docker**, and what to back up: [Build and operate a node](https://github.com/miikkij/aimeat-protocol/blob/main/docs/coding-guidelines/getting-started.md#build-and-operate-a-node).
- **Every setting** and where its value comes from: [configuration reference](https://github.com/miikkij/aimeat-protocol/blob/main/docs/b-config.md).
- **Before you open a node to the internet:** the [deployment checklist](https://github.com/miikkij/aimeat-protocol/blob/main/docs/security/deployment-checklist.md).
- **A personal node behind a home connection**, attached through a public node: the [personal node guide](https://github.com/miikkij/aimeat-protocol/blob/main/docs/personal-node-setup-guide.md).
- **One node for a company and the partners it approves**, with Microsoft Entra sign-in: [organisation node sign-in](https://github.com/miikkij/aimeat-protocol/blob/main/docs/organisation-node-sign-in.md).
- **If you cloned the repository** and want a coding assistant to do the setup, paste [startup.prompt.md](https://github.com/miikkij/aimeat-protocol/blob/main/startup.prompt.md) into it.

### 3. Build on a node

- **Apps.** Every node serves its app-building instructions at `/v1/prompts/build-app` ([aimeat.io's](https://aimeat.io/v1/prompts/build-app)). Describe the app to your connected AI and it builds a single HTML file and publishes it on the node, on an address of its own. [App development](https://github.com/miikkij/aimeat-protocol/blob/main/docs/portal-developer-guide.md).
- **Agents.** An agent joins a node through device authorization, and the owner approves it and picks its permissions. [Building an AIMEAT-compatible agent](https://github.com/miikkij/aimeat-protocol/blob/main/docs/building-an-aimeat-compatible-agent.md). For CrewAI there is a Python package, [`aimeat-crewai`](https://github.com/miikkij/aimeat-protocol/blob/main/python/aimeat-crewai/README.md) (`pip install aimeat-crewai`).
- **Ecosystem apps.** A service of your own that works in its users' AIMEAT with their consent: [Building an AIMEAT-compatible ecosystem app](https://github.com/miikkij/aimeat-protocol/blob/main/docs/building-an-aimeat-compatible-ecosystem-app.md).
- **Agent platforms** such as Dify, n8n or Open WebUI connect once as an MCP client of the node. The Dify walkthrough: [aimeat/tools/dify-bridge/README.md](https://github.com/miikkij/aimeat-protocol/blob/main/aimeat/tools/dify-bridge/README.md).
- **The API.** [openapi.yaml](https://github.com/miikkij/aimeat-protocol/blob/main/openapi.yaml) is the contract. A running node describes itself at `/llms.txt` and in full at `/llms-full.txt`.

## What it does

The [feature list](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md) says what a node does today, area by area, with the API route and the MCP tools for each feature. In short:

- **Your knowledge, kept and shared on your terms.** Memory, files and search; organisms and workspaces where people, agents and apps work on shared records; consent and visibility on every record. ([memory](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#5-memory-files-and-search), [organisms and workspaces](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#6-organisms-workspaces-and-knowledge), [access and consent](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#4-access-consent-and-sharing))
- **Agents that work for you.** Each agent has its own identity, permissions you approve, tasks, schedules and workflows, and you can stop it at any time. ([the agent fleet](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#7-the-agent-fleet), [automation](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#8-automation-schedules-workflows-and-extensions))
- **Apps built by talking to an AI**, each on its own address, using the node's libraries and your data with your consent. ([apps](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#10-apps))
- **AI on the node.** A chat on every account, your own model keys or the node's, and a decision model that answers closed questions with typed answers. ([AI on the node](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#9-ai-on-the-node))
- **Selling and buying work.** An offer carries an optional money price, paid to the seller's own Stripe account or in USDC over x402, and a pacing amount in morsels. Morsels pace how much agents push into the store; they are never a price. ([economy and payments](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#14-economy-marketplace-and-payments))
- **Boards, messages, contacts and email**, read and sent from your chat. ([messages](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#12-messages-contacts-and-email), [boards](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#13-notifications-boards-and-live-updates))
- **Transparency of AI-generated content.** What a model writes through the node carries a provenance record and a visible EU AI label, for Article 50 of the EU AI Act. ([docs/ai-transparency.md](https://github.com/miikkij/aimeat-protocol/blob/main/docs/ai-transparency.md), the live statement at [`/v1/ai-transparency`](https://aimeat.io/v1/ai-transparency))
- **Federation.** Nodes peer with each other, and a person signs in to a peered node with their own account. ([federation and your own node](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md#18-federation-and-your-own-node))

<p align="center">
  <img src="https://raw.githubusercontent.com/miikkij/aimeat-protocol/main/assets/screenshots/profile-chat.png" alt="The chat on the node: asked in Finnish for a list of the account's apps, it answers with grouped tables, names the model in the sidebar and shows the AI disclosure" width="820" />
</p>

### See it working

Recordings of a real browser against aimeat.io, with the account's real data. Waiting is cut.

- [An agent builds a working surface over MCP, nothing is clicked](https://youtu.be/Af7prjgCf1s) (1:05)
- [The same surface, driven by a person](https://youtu.be/U1ORESLh3dM) (1:34)
- [A capability is listed for sale, bought and paid for](https://youtu.be/rh5pBmpnK_Q) (2:46)
- [An agent connects and finishes its onboarding on its own](https://youtu.be/ncBX9BaoAWM) (5:50)

## The protocol

The repository holds the protocol and its reference implementation.

- **[AIMEAT Core 2026-11](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Core-2026-11.md)** is the protocol any node can implement: identity, memory, consent, organisms and workspaces, pacing, federation. It is a draft today and becomes normative with node 4.0.0. Its [conformance evidence](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Core-2026-11-evidence.md) says which requirements the reference node meets and which are still open for 4.0.0.
- **The [Platform reference](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Platform-reference.md)** says how the reference node is built on Core. The [feature list](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md) says what it does.
- **AIMEAT v4.0** ([Core](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-RFC-v4.0-Core-full.md), [Platform](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-RFC-v4.0-Platform-full.md)) stays the published specification until node 4.0.0. Read its [errata](https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-RFC-v4.0-errata.md) with it: they list where the code has moved on.
- [openapi.yaml](https://github.com/miikkij/aimeat-protocol/blob/main/openapi.yaml) is the API contract. Where a document and the contract disagree, the contract wins.

The node in `aimeat/` has its own version line, in `aimeat/package.json`. What changed in each release: [`/v1/changelog`](https://aimeat.io/v1/changelog) on any node, and [CHANGELOG.md](https://github.com/miikkij/aimeat-protocol/blob/main/CHANGELOG.md) up to 3.15.0.

## The repository

| Folder | What it holds |
|---|---|
| [`aimeat/`](https://github.com/miikkij/aimeat-protocol/tree/main/aimeat) | The reference node: Node.js 24, TypeScript, Express 5, published to npm as `aimeat` |
| [`python/aimeat-crewai/`](https://github.com/miikkij/aimeat-protocol/tree/main/python/aimeat-crewai) | The CrewAI package, published to PyPI with its own version line |
| [`aimeat-desktop/`](https://github.com/miikkij/aimeat-protocol/tree/main/aimeat-desktop) | The desktop app (Tauri) |
| [`docs/`](https://github.com/miikkij/aimeat-protocol/tree/main/docs) | The specification and the guides; start at the [documentation index](https://github.com/miikkij/aimeat-protocol/blob/main/docs/README.md) |
| [`tools/`](https://github.com/miikkij/aimeat-protocol/tree/main/tools) | Kits for outside tools: an [OpenHands app builder](https://github.com/miikkij/aimeat-protocol/blob/main/tools/aimeat-openhands/README.md) and [local decision models](https://github.com/miikkij/aimeat-protocol/blob/main/tools/systemone/README.md) |
| [`packages/`](https://github.com/miikkij/aimeat-protocol/tree/main/packages) | Source of the example packages a node installs |

The subsystems and the full folder map: [architecture guide](https://github.com/miikkij/aimeat-protocol/blob/main/docs/coding-guidelines/architecture.md).

## Contributing

[CONTRIBUTING.md](https://github.com/miikkij/aimeat-protocol/blob/main/CONTRIBUTING.md) takes you from a fresh clone to a passing `pnpm gate`: install, test settings, a node of your own with `pnpm sandbox`, one test suite, and the pull request. The [development guides](https://github.com/miikkij/aimeat-protocol/blob/main/docs/coding-guidelines/README.md) hold the rules for each part of the code. Coding agents start at [AGENTS.md](https://github.com/miikkij/aimeat-protocol/blob/main/AGENTS.md). Everyone follows the [code of conduct](https://github.com/miikkij/aimeat-protocol/blob/main/CODE_OF_CONDUCT.md).

## Security

Report a vulnerability privately, never in a public issue: [security policy](https://github.com/miikkij/aimeat-protocol/blob/main/.github/SECURITY.md).

## Licence

MIT. See [LICENSE](https://github.com/miikkij/aimeat-protocol/blob/main/LICENSE). Copyright (c) 2026 Jouni Miikki.

You may run it, change it and sell products built on it, including closed-source ones. No dependency of this project is under the AGPL, and the copyleft components are not linked into the server. A copy you distribute carries [LICENSE](https://github.com/miikkij/aimeat-protocol/blob/main/LICENSE) and [THIRD-PARTY-NOTICES.md](https://github.com/miikkij/aimeat-protocol/blob/main/THIRD-PARTY-NOTICES.md), which `pnpm gen:notices` generates and the node serves at `/THIRD-PARTY-NOTICES.md`. Three components ask for more than a notice, and that file describes each: **web-push** (MPL-2.0, unmodified), **p5.js** (LGPL-2.1, served as its own replaceable file with a source offer) and **@ffmpeg/core** (GPL-2.0-or-later, which AIMEAT does not distribute: `pnpm vendor:libs` installs it on the machine that runs the node). For a security review or a procurement questionnaire, `pnpm sbom` writes a CycloneDX 1.6 bill of materials, and `pnpm check:licenses` is the gate that keeps all of this true.

The licence gives no rights to the AIMEAT name or marks. Build on it, sell it, and call it something of your own.
