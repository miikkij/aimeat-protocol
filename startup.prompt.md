# startup.prompt.md: paste this into a coding assistant to set up AIMEAT from this repository

**Who uses this file, and where.** A person has cloned this repository and opened it in a coding
assistant: Claude Code, Codex, Cursor, VS Code with Copilot, or another one that can run commands
in the repository. They paste this whole file into that assistant's chat. The assistant then
works through the checklist below with them.

**You are that coding assistant.** Take the person from a fresh clone to AIMEAT working in the AI
tools they use: either connected to a hosted node such as `https://aimeat.io`, or to a node of
their own that you start here. Run the commands for them, and ask only what you cannot find out
yourself (hosted or their own node, the storage backend, their account name, secrets).

**Where this leads.** AIMEAT is used from the person's own AI chat, over MCP. Standing up a node is
the way there, not the goal. Once their AI tools are connected (Step 6), those tools do the work
directly with `aimeat_*` tools (`aimeat_handbook_get` first, then `aimeat_memory_*`,
`aimeat_app_publish` and the rest) instead of you walking them through shell commands. If you
already hold `aimeat_*` tools against a running node, skip to Step 6 and Step 7.

---

## What this repository is (read first, then act)

**aimeat-protocol** holds the **AIMEAT protocol** (`docs/AIMEAT-RFC-v4.0-Core-full.md`,
`docs/AIMEAT-RFC-v4.0-Platform-full.md`, the errata in `docs/AIMEAT-RFC-v4.0-errata.md`, and the API
contract `openapi.yaml`) and its **reference node** in `aimeat/`, a Node.js 24, TypeScript and
Express 5 server. AIMEAT (AI Memory Exchange and Action Transfer) keeps a person's knowledge, agents
and apps on a node they own and lets them work with it from the AI they already use. It carries
persistent identity for people, agents and apps, consent-governed memory, organisms and workspaces
for sharing, apps and extensions, federation between nodes, and an MCP server. Plain HTTP and JSON.

A node of their own serves a web interface, an admin area and the full API on port **40050**. The
same repository ships the **`aimeat` CLI**, which connects AI tools and agents to *any* node: their
own, `https://aimeat.io`, or someone else's.

**Five ways to start (Step 0 picks one):**

- **A) Hosted node, nothing to install.** The person adds `https://aimeat.io/v1/mcp` (or their
  operator's node) as a connector in their AI and signs in. Go straight to Step 6. This is the
  right answer for someone who only wants to use AIMEAT.
- **B) From source (this repository).** `pnpm install` and `pnpm dev` in `aimeat/`. For someone who
  wants to change the node. Steps 1 to 5.
- **C) npx, no build.** `npx aimeat init`, then `npx aimeat start`. The same server, from npm.
  Steps 3 to 5.
- **D) Desktop app (Windows, Apple-silicon Macs, Linux), no terminal.** **AIMEAT Personal Node**
  attaches the AI tools on the computer (Claude Code, Cursor, VS Code) to their AIMEAT, and can run
  a node of their own on port **41050**. The installers are on the release
  `https://github.com/miikkij/aimeat-protocol/releases/tag/desktop-latest`, or build one with
  `pnpm build-desktop`. See [aimeat-desktop/README.md](aimeat-desktop/README.md).
- **E) Docker.** `docker compose up --build` in `aimeat/` (PostgreSQL) or
  `docker compose -f docker-compose.sqlite.yml up --build` (SQLite). Then Step 5.

> If the person wants to *develop* the node, point them at **`CONTRIBUTING.md`** (setup, a node of
> their own with `pnpm sandbox`, one test suite, `pnpm gate`) and **`CLAUDE.md`** with the rules in
> `.claude/rules/`. Do not repeat those rules here; read them.

---

## Step 0: Determine the target (ask the person; do not guess)

1. **Which way (A to E)?** A hosted node (A) needs no node here. Call the node's base URL
   `<NODE_URL>`: `https://aimeat.io`, their operator's address, or `http://localhost:40050` for a
   node started here.
2. **Storage backend** (their own node only): **SQLite**, file-based with no database server, right
   for a personal or development node (recommended), or **PostgreSQL** for production
   (`docker compose up` runs it; the schema migrates on start). Those are the two backends.
   > **Set it explicitly, and check that you did.** With `AIMEAT_STORAGE` unset the node uses an
   > **in-memory** store: it starts, the pages work, and everything the person creates disappears at
   > the next restart. That default is for tests.
3. **Account name**: the owner handle the person signs in with and registers agents under (for
   example `alice`). On a new node the **first owner becomes the node's operator**. Call it
   `<OWNER>`.
4. *(Optional)* **Which AI tools and agents** to connect: Claude, ChatGPT, Codex, Cursor, VS Code,
   goose, a CrewAI crew (the `aimeat-crewai` package), a Dify or n8n platform. This shapes Step 6.

Confirm 1 to 3 before you go on.

## Step 1: Prerequisites (their own node from source; offer to install what is missing)

- **Node.js 24+** and **pnpm 10+**. PostgreSQL only if they chose it (or `docker compose up`, which
  includes it).
- Check: `node --version`, `pnpm --version`. On Windows, `npm i -g pnpm` installs pnpm.

## Step 2: Install (from the repository root)

```
pnpm install          # at the root: turns on the repository's git hooks
cd aimeat
pnpm install          # the node's dependencies; native builds (better-sqlite3, esbuild) are pre-approved
```

## Step 3: Configure the node (their own node only). Work in `aimeat/`, never commit `.env`, never print secret values

**The file must end up at `aimeat/.env`.** `pnpm dev` starts the node with `--env-file=.env`
relative to `aimeat/`, so a `.env` in the repository root is read by nothing, and the node starts on
defaults, which is the in-memory store.

The wizard is the easy path:

```
npx aimeat@latest init   # asks a few questions and writes .env
```

Or copy the template and edit it:

```
cp .env.example .env     # from aimeat/
```

Then set the storage backend in `.env`. **This line is not optional**; without it the store is
in memory:

- **SQLite:** `AIMEAT_STORAGE=sqlite` (optionally `AIMEAT_SQLITE_PATH=./data/aimeat.db`)
- **PostgreSQL:** `AIMEAT_STORAGE=postgres-kysely` and
  `DATABASE_URL=postgresql://user:pass@localhost:5432/aimeat` (`postgres` and `postgresql` are
  aliases for the same backend)

For a local development node these two help (never on a public node): `AIMEAT_DEV_MODE=true` and
`AIMEAT_ANONYMOUS=true`. Leave `AIMEAT_ADMIN_PASSWORD` unset to let the server write an admin secret
to a file (Step 4).

**The node's keys live in `.env`, and they must never change or be lost.** The data key encrypts
every stored secret (AI keys, the secrets vault, extension secrets, two-step sign-in secrets): that
is `AIMEAT_ENCRYPTION_KEY`, or `AIMEAT_TOTP_ENCRYPTION_KEY` when the first is not set, and
`aimeat init` generates the second. `AIMEAT_KEY_PASSPHRASE` encrypts the node's identity key, and
`aimeat init` generates it too. Tell the person to keep a copy of `.env` somewhere safe, together
with the key file `~/.aimeat/nodes/<node id>/node-key.json`: the database alone does not restore
the node's identity, and a changed data key makes every stored secret unreadable.

> Opening the node to the public later? The operator fields (`AIMEAT_OPERATOR_*` in `.env.example`,
> also on the admin Config page) are required for the privacy and terms pages; until they are set,
> `/v1/privacy` answers 503 and names the missing fields. Skip this for a local node.

## Step 4: Start the node (their own node only)

```
pnpm dev          # from the repository root or from aimeat/; serves port 40050
```

`pnpm dev` does not restart when backend source changes; `pnpm dev:watch` in `aimeat/` does. With
npx, `npx aimeat start` instead.

Watch the startup log. **It names the storage backend: read that line first.** It says one of:

```
Using SQLite (./data/aimeat.db) storage
Using PostgreSQL (postgresql://<credentials>@localhost:5432/aimeat) storage
Using in-memory (data will not persist across restarts) storage
```

If it is the third, `aimeat/.env` was not read or `AIMEAT_STORAGE` is unset. Fix it and restart
**before the person creates an account or anything else**, or that work is lost at the next
restart. The log also prints the **Node ID**, the **URL** (`http://localhost:40050/`) and, when
`AIMEAT_ADMIN_PASSWORD` is not set and the node has no owner yet, the path of the file
`admin-setup-secret` that holds the **admin secret** (beside the SQLite database, or in `./data`,
readable by the server's user only). The secret creates the first operator only. **Give the secret
to the person; never write it into the repository.** Check the node:

> Open `http://localhost:40050/` and fetch `http://localhost:40050/llms.txt`. If it returns the
> node's description, the node is up.

## Step 5: Create the first account (their own node only)

A node with no owner shows its **setup page, `/v1/setup/wizard`**, for every page address, so
opening `http://localhost:40050/` lands there. The person creates `<OWNER>` on it, and that first
owner becomes the node's **operator**. `POST /v1/setup/init` refuses with `ALREADY_CONFIGURED`
(403) once any owner exists, so the page provisions the first owner and nothing else; it is not a
recovery route. `GET /v1/setup/status` says whether setup is still needed.

The other way: **`/v1/admin/setup`**, with the admin secret from Step 4.

Later accounts register and sign in at `<NODE_URL>/v1/portal`. On a hosted node, the person signs
in there too.

## Step 6: Connect their AI tools

Three routes. Pick by what the tool can do; use more than one if they use several tools.

**a) A remote connector, for AI apps that take one** (claude.ai, Claude Desktop, ChatGPT, Grok
and others). The person adds `<NODE_URL>/v1/mcp` as a connector (custom connector, MCP server) in
the tool's settings, signs in to the node in the browser, and picks what the AI may do: read only,
standard, full, or exactly the permissions they tick. Nothing to install. The steps for each tool,
with every field value, are at `<NODE_URL>/v1/connect-your-ai` and, for software,
`<NODE_URL>/v1/ai-tools`. Signed in, the person's MCP page (`<NODE_URL>/v1/profile?tab=mcp`) shows
every connected AI and disconnects any of them.

A tool that runs in a vendor's cloud reaches only a node the internet can reach. A node on
`localhost` works with tools that run on the same computer (route b), not with claude.ai or ChatGPT.

**b) One command, for AI tools on this computer** (Claude Code, Cursor, VS Code, goose, Claude
Desktop):

```
npx aimeat@latest connect client <claude-code|cursor|vscode|goose|claude-desktop> --url <NODE_URL> --owner <OWNER>
```

It registers the tool as an agent of the person's (they approve it, see below), writes the tool's
MCP settings merged into what was there, keeps the token out of the config file, and leaves a
launcher script. `--surface <appdev|agent|service|admin>` narrows the tools to one job. Details:
`docs/c-platform-notes.md`.

**c) Device authorization, for agents and runtimes** (a CrewAI crew, a daemon, any runtime that
runs commands):

```
npx aimeat@latest connect add --agent <name> --url <NODE_URL> --owner <OWNER> [--mode <mode>]
```

The command prints a **verification code** and a **verification URL**. The person opens the URL
(it is on their node, also reachable from the **Agents** page in their settings), enters the code,
**approves**, and picks the permissions (`standard` fits most agents). The command finishes once
approved, and the token is stored in the connector home, a `.aimeat` folder in the directory the
command ran in (or `AIMEAT_HOME`), which keeps itself out of git. You never handle the token.

- **`--mode`** is `autonomous`, `interactive` (default), `coordinator`, `task-runner` or
  `workstation`. It picks the onboarding flow (Hello Integration): the first three run the full
  flow, `task-runner` (a crew or another triggered worker) a shorter one that keeps the test task
  as its proof, and `workstation` (a tool that visits the node, such as an IDE) the shortest.
- **MCP over stdio:** after approval, `aimeat connect serve` exposes the AIMEAT tools over stdio.
  One `serve` process can serve several agents: add more with `aimeat connect add`, list them with
  `aimeat connect list`.
- **A runtime without stdio:** every tool is reachable as `aimeat connect call <tool> --json '<input>'`.
- **CrewAI crews:** use the liaison agent from the `aimeat-crewai` package
  (`python/aimeat-crewai/README.md`).
- **Agent platforms (Dify, n8n, Open WebUI):** connect them once as an MCP client of
  `<NODE_URL>/v1/mcp` (or a narrower `<NODE_URL>/v2/mcp/<surface>`). For Dify, see
  [aimeat/tools/dify-bridge/README.md](aimeat/tools/dify-bridge/README.md).

**An AI that cannot connect at all** (a consumer Gemini app, Copilot without Copilot Studio) still
works through prompts: the node's pages compose a ready prompt, the person runs it in their own chat
and pastes the answer back.

## Step 7: What the person can do now

Once a tool is connected, the person works from their chat. Suggest they ask it what it can do in
AIMEAT; the connected AI reads `aimeat_handbook_get` and answers for this node.

- **Remember and share.** Tell the AI to remember something, and it lands in their own memory on
  the node, readable from every connected tool. Organisms and workspaces share knowledge with other
  people and their agents, on the person's consent.
- **Build apps.** Describe an app to the connected AI. It reads the node's instructions
  (`<NODE_URL>/v1/prompts/build-app`; the Atelier track's specification is at
  `<NODE_URL>/v1/prompts/build-app-atelier`), builds one HTML file and publishes it with
  `aimeat_app_publish`, on an address of its own. Apps use the node's served libraries for sign-in,
  memory, storage, live updates and AI on the person's own key.
- **Hand work to agents.** Tasks, schedules and workflows run under the person's name, with the
  permissions they approved.
- **Install extensions and cortex** (sandboxed server logic and shared interface parts) the same
  way, from the chat.

When the node is up and at least one tool is connected, summarize what is running
(`aimeat connect list` for the CLI agents) and suggest two or three next steps.

---

## Essentials to teach the person

- **Identity.** A person is a **GHII** (`owner@node-id`, for example `alice@aimeat-local-001-dev`);
  an agent is a **GAII** (`agent#owner@node-id`, for example `claude#alice@…`). The person owns
  everything; agents act under them with the permissions they approved.
- **Approvals are the owner's, once per agent.** A new agent appears only when the owner approves
  it. Nothing creates an agent by itself.
- **Memory is namespaced.** Owner data lives under the GHII; an extension's data under `ext:{name}`.
  Agents read and write the owner's memory within their permissions; apps go through the served
  libraries and cortex, never straight to `ext:`.
- **Morsels pace; they are not money.** The owner's GHII holds one morsel balance, and agents act
  on it in the owner's name; agents have no balance of their own. Morsels pace how much agents push
  into the store, so what lands is refined. An offer can also carry a money price, paid on separate
  payment rails. A morsel is never a price.
- **The prompt route** is for AIs that cannot connect over MCP: the page composes a prompt, the
  person runs it in their own chat and pastes the result back. It is free and works with any AI.
- **Narrow MCP surfaces.** `aimeat connect serve --surface <agent|appdev|service|admin>` and
  `<NODE_URL>/v2/mcp/<surface>` expose only the tools one job needs. Fewer tools cost fewer tokens
  and confuse a model less. `<NODE_URL>/v1/mcp` is the full set.
- **Output is discoverable.** What an agent writes to shared memory or knowledge can be found by
  other agents and people with access, and across peered nodes. Text from other people is untrusted
  markdown: escape anything you put into a web page.

## Guardrails for you, the assistant

- **Never** commit, log or echo a secret (the admin secret, agent tokens, database URLs, AI keys).
  Write them only into `.env`, which git ignores.
- **Confirm before anything destructive or outward-facing:** wiping the database, deleting agents,
  apps or memory, publishing to a public node, pushing to git.
- **Show device codes** for the person to approve; **never invent** an owner handle, a node URL or
  a key: ask.
- **Use the repository's own tooling:** the `pnpm` scripts (`pnpm dev`, `pnpm build`, `pnpm start`)
  and the `aimeat` CLI. Do not hand-roll process management or go around device authorization.
- **If you change code**, follow `CONTRIBUTING.md` and `CLAUDE.md`, and check before you call it
  done: run `pnpm test:env:init` once in `aimeat/`, then the E2E suite the change can reach, then
  `pnpm gate`.

## Do it now

Ask Step 0's questions. For a hosted node, go to Step 6. For their own node, work through Steps 1
to 5 (run the commands, give the person the admin secret), then Step 6 for each tool or agent (show
each approval code and wait). When something is connected, summarize and suggest two or three next
steps.
