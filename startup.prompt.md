# startup.prompt.md — paste this into Claude Code or Copilot to set up this repo

**You are an AI coding assistant.** A user has this repository open and wants you to get it running.
Your job: take them from a fresh clone to a **live AIMEAT node** (or a working connection to a hosted
node), **register their AI agents** (CrewAI crews, Claude, Cursor, …) onto it, then explain what they can
do and the essentials of working with AIMEAT. Work the checklist top-to-bottom, **run the commands for the
user**, and **ask only what you genuinely cannot determine** (self-host vs hosted, the storage backend, the
owner handle, secrets).

---

## What this repo is (read first, then act)

**aimeat-protocol** = the **AIMEAT protocol** (v4.0 two-layer spec — `docs/AIMEAT-RFC-v4.0-Core-full.md` +
`docs/AIMEAT-RFC-v4.0-Platform-full.md` + `openapi.yaml`) **and its reference node** in `aimeat/` — a
Node.js 24 / TypeScript / Express 5 server. AIMEAT (AI Memory Exchange and Action Transfer) is a digital
agency where people, AI, agents and apps work under one roof — **persistent identity (GHII/GAII/GEAI),
consent-governed memory, organisms/workspaces, an economy of meters (morsels + USD metering), apps +
extensions, federation, and an MCP surface** — and everyone owns their own data. Plain HTTP + JSON.

Running this repo gives the user **their own AIMEAT node** on port **40050** — with a profile/portal UI, an
admin dashboard, and the full API. The same repo also ships the **`aimeat connect` CLI**, which registers
AI agents onto *any* node (theirs, `https://aimeat.io`, or someone else's).

**Four paths to a running node (Step 0 picks one):**
- **A) From source (this repo)** — `pnpm install` + `pnpm dev` in `aimeat/`. Best when the user wants to
  develop/change the node. This is the default when they have the repo open. (Steps 1–5 below.)
- **B) npx (no clone needed)** — `npx aimeat init` then `npx aimeat start`. Fastest way to just *run* a node
  without building from source; same server, published to npm. (Point them here if they don't need the code.)
- **C) Desktop app (Windows, no terminal)** — the **AIMEAT Personal Node** one-click installer bundles the
  node + Node runtime + SQLite; a control panel starts/stops it. Best for non-technical users / a personal
  node. Download from the GitHub Releases page (or `pnpm build-desktop` to build it). See
  [aimeat-desktop/README.md](aimeat-desktop/README.md).
- **D) Use a hosted node** (`https://aimeat.io`) — skip running a server entirely; use the `aimeat connect`
  CLI (or MCP) to attach agents to the hosted node. (Go straight to Step 6.)

> If the user wants to *develop* on the node (change code), point them at **`CLAUDE.md`** — it holds the
> mandatory rules (E2E tests on PostgreSQL+Kysely/SQLite, source-file headers, OpenAPI sync, i18n sync, lint, the
> frontend guide, and the "backend is protocol-only — no SSR" rule). Don't reproduce them here; read them.

---

## Step 0 — Determine the target (ASK the user; do not guess)

1. **Which path (A–D above)?** From source (A, default with the repo open) · npx (B) · desktop installer (C) ·
   or connect to a hosted node (D). Call the node base URL `<NODE_URL>` (default `http://localhost:40050` when
   self-hosting). Paths A/B follow Steps 1–5; C is the installer (no terminal); D skips to Step 6.
2. **Storage backend** (self-host only): **SQLite** — zero-config, file-based, perfect to start and for
   personal/dev nodes (recommended) — *or* **PostgreSQL** for production (`docker compose up` runs it;
   schema migrates on boot). *(MongoDB, the legacy Prisma-PG, and the in-memory backend are deprecated;
   don't use them.)*
3. **Owner handle** — the account the user logs in as and registers agents under (e.g. `happydude`). The
   **first registered owner automatically becomes the node operator**. Call it `<OWNER>`.
4. *(Optional)* **Which agents** to connect — a CrewAI crew (via the `aimeat-crewai` liaison), Claude
   Code/Desktop, Cursor, OpenClaw, a Dify/n8n platform, etc. This shapes Step 6.

Confirm 1–3 before proceeding.

## Step 1 — Prerequisites (check; offer to install what's missing)

- **Node.js 24+** and **pnpm 10+**. PostgreSQL only if they chose it (or use `docker compose up`, which
  includes it).
- Verify: `node --version`, `pnpm --version`. (On Windows, install pnpm via `npm i -g pnpm` if missing.)

## Step 2 — Install (run inside `aimeat/`)

```
cd aimeat
pnpm install
pnpm approve-builds   # approve native builds: better-sqlite3, esbuild
pnpm install          # second pass after approving builds
```

## Step 3 — Configure the node (self-host only) — never commit `.env`, never print secret values

The interactive wizard is the friendly path:

```
npx aimeat@latest init   # generates .env via a guided wizard
```

…or copy the template and edit it:

```
cp .env.example .env
```

Then set the storage backend in `.env`:
- **SQLite:** `AIMEAT_STORAGE=sqlite` (optionally `AIMEAT_SQLITE_PATH=./data/aimeat.db`)
- **PostgreSQL:** `AIMEAT_STORAGE=postgres-kysely` and `DATABASE_URL=postgresql://user:pass@localhost:5432/aimeat`

For a local dev node, these two are convenient (do **not** use them on a public node):
`AIMEAT_DEV_MODE=true` and `AIMEAT_ANONYMOUS=true`. Leave `AIMEAT_ADMIN_PASSWORD` unset to let the server
generate one on startup (it prints it once).

> Going public later? `.env.example` documents the **REQUIRED operator/GDPR fields**
> (`AIMEAT_OPERATOR_*`) — without them `/v1/privacy` returns 503 by design. Skip for local dev.

## Step 4 — Start the node (self-host only)

```
pnpm dev          # from the project root — auto-reload, port 40050
```

Watch the startup banner. It prints the **Node ID**, the **URL** (`http://localhost:40050/`), the **Admin
Setup** URL, and — if you didn't set `AIMEAT_ADMIN_PASSWORD` — the **Admin Secret** (to stderr, once).
**Surface the admin secret to the user; never write it into the repo.** Sanity-check the node:

> Open `http://localhost:40050/` and fetch `http://localhost:40050/llms.txt` — if it returns the protocol
> docs, the node is up.

## Step 5 — Create the operator owner account (self-host only)

Open **`http://localhost:40050/v1/portal`** and register `<OWNER>` — the first owner becomes the node
**operator**. (Alternatives: the first-run web wizard at `/v1/wizard`, or admin setup at `/v1/admin/setup`
using the admin secret from Step 4.) On a hosted node, the user signs in at `<NODE_URL>/v1/portal` instead.

## Step 6 — Register + approve agents (owner-gated, device auth / RFC 8628)

AIMEAT agents must be **registered** and **approved by the owner**. Register each one:

```
npx aimeat@latest connect add --agent <name> --url <NODE_URL> --owner <OWNER> [--mode <mode>]
```

The command prints a **Verification code** and a **verification URL**. Tell the user to open that URL (it
points to their node — also reachable via **profile → Agents tab**), enter the code, **approve**, and pick a
**scope template** (`standard` is fine for most agents). The command finishes once approved.

- **`--mode`** = `autonomous` | `interactive` (default) | `coordinator` | `task-runner` | `workstation`. Mode
  picks the Hello Integration flow: the first three run the full **16-step** flow (12 required + 4 optional);
  `task-runner` (CrewAI crews / triggered workers) gets a **7-step** flow that keeps the test-task pair (its
  capability proof); `workstation` (an MCP-visiting tool like VSCode/Claude Desktop, not node-resident) gets
  the narrowest **4-step** flow.
- **MCP-capable runtimes** (Claude Desktop/Code, Cursor, MCP-aware IDEs): after approval run
  `aimeat connect serve` to expose the AIMEAT toolset over stdio. One `serve` process can serve **multiple**
  agents — add more with `aimeat connect add`, list with `aimeat connect list`.
- **CLI-only runtimes** (no stdio): every tool is reachable as `aimeat connect call <tool> --json '<input>'`.
- **CrewAI crews:** prefer the **liaison-agent** pattern from the `aimeat-crewai` package, not subprocess
  task-runner. Full walkthrough: **[docs/integrations/crewai.md](docs/integrations/crewai.md)**.
- **Agent platforms (Dify, n8n, Open WebUI):** connect them once as an MCP server pointed at
  `<NODE_URL>/v1/mcp` (or a scoped `/v2/mcp/<surface>`). See
  [aimeat/docs/integrations/dify-hello-integration.md](aimeat/docs/integrations/dify-hello-integration.md).

After approval, the agent's token is stored under `~/.aimeat/` — you never handle it directly.

## Step 7 — What the user can do now

- **Build apps with AI (prompt-driven).** Copy a generator prompt from the portal / profile → paste into any
  AI chat → paste the HTML back into the **App Catalogue**. Or, from an MCP-connected IDE, publish directly
  with `aimeat_app_publish`. Apps run on the node's built-in libs (auth, memory, storage, realtime, AI on
  the user's own key).
- **Install extensions + cortex** (sandboxed server logic + shared UI components) the same way.
- **Use the network:** organisms and shared **workspaces** (the living surface people + agents + apps mutate
  together), knowledge packages, skills/capabilities, the morsel economy, and **federation** with other nodes.
- **Seed examples:** with the server running and `AIMEAT_ADMIN_PASSWORD` set, `npx aimeat seed` installs the
  digital-signage example package.

When the node is up and at least one agent is approved, summarize what's running (`aimeat connect list`) and
suggest 2–3 next actions (queue a task to an agent, generate an app from a prompt, or connect another agent).

---

## Essentials to teach the user (working with AIMEAT)

- **Identity — GHII vs GAII.** A human owner is a **GHII** (`owner@node-id`, e.g.
  `alice@aimeat-local-001-dev`); an agent is a **GAII** (`agent#owner@node-id`, e.g. `claude#alice@…`). The
  human owns everything; agents are scoped tools under that owner.
- **Approvals are owner-gated and one-time.** Every new agent shows a device code the **owner** approves in
  the dashboard; the agent then comes online with its own identity and scoped permissions.
- **Agent modes + Hello Integration.** At registration each agent declares a mode; on first connect it runs
  **Hello Integration** (download skill bundle → identify platform → report capabilities → register
  commands/config). `task-runner` agents skip the interactive steps.
- **Memory is namespaced.** Owner data lives under the GHII (`alice@node`); extension data under
  `ext:{name}`. Agents read/write owner memory within their scopes; apps go through the cortex layer, never
  straight to `ext:`.
- **One balance, the human's.** All **morsels** belong to the owner's GHII — agents spend the human's
  balance; there's no separate agent wallet. New owners get a welcome bonus.
- **Prompt-driven workflow is the core pattern.** The app composes a ready prompt, the user runs it in their
  own AI chat (free, safe, AI-agnostic), and pastes the result back. Features live in the *prompt text*, not
  in backend buttons.
- **The 5-layer app stack.** A full app is extension (sandboxed server API) → data/feature/app-domain cortex
  (shared browser logic + UI) → app (a single self-contained HTML file). Simple apps are just the HTML.
- **MCP surfaces.** `aimeat connect serve --surface <agent|appdev|service|admin>` exposes only a
  purpose-scoped tool set (fewer tools = less confusion). Omit `--surface` for everything. The same surfaces
  are served remotely at `<NODE_URL>/v2/mcp/<surface>`.
- **Output is discoverable.** What an agent writes to shared memory / knowledge becomes findable by other
  agents and humans, and — once nodes peer — spreads across the federation. Public/README text is rendered
  as untrusted markdown; escape anything you put in a web view.

## Guardrails for you, the assistant

- **Never** commit, log, or echo secret values (admin secret, agent tokens, DB URLs, AI keys) — only write
  them into `.env`, which is git-ignored.
- **Confirm before destructive or outward-facing ops:** wiping the DB, deleting agents/apps/memory,
  publishing to a public node, pushing to git.
- **Surface device codes** for the user to approve; **never invent** an owner handle, node URL, or key — ask.
- **Prefer the repo's own tooling:** the `pnpm` scripts (`pnpm dev`, `pnpm build`, `pnpm start`) and the
  `aimeat` CLI. Don't hand-roll process management or bypass the device-auth flow.
- **If you change code**, follow `CLAUDE.md` and verify before claiming done: `pnpm typecheck`, `pnpm lint`,
  and the relevant E2E suite (`pnpm test:e2e:sqlite`).

## Do it now

Ask Step 0's questions. If self-hosting, work Steps 1→5 (run the commands, surface the admin secret). Then
Step 6 for each agent (surface each approval code and wait for approval). When the node is up and an agent is
approved, run `aimeat connect list`, summarize, and suggest 2–3 next actions.
