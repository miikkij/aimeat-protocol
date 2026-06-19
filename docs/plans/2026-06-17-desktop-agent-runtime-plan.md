# Desktop Agent Runtime + Local Ollama + Automated Installer Release — Plan

**Date:** 2026-06-17
**Status:** Draft for developer approval (no work started beyond this document)
**Owner decision required:** see "Open decisions" at the end before implementation.

## Goal (one sentence)

Make a non-technical user able to **download one Windows installer, click once, and have a
fully local AIMEAT node running its own CrewAI ("crewaimeat") agents on a local Ollama
model** — while coders get a parallel "build an agent from the repo + an AI prompt" path —
and have the whole thing build and release itself via GitHub Actions, with the handbook
maintained inside AIMEAT's own organism (dogfood).

## The two on-ramps we are completing

| Audience | Path | Today | Target |
|----------|------|-------|--------|
| **Beginners** | Desktop installer → click "Start" → click "Add local agent" | Desktop runs the node only; no agent runtime, no Python, no Ollama | Desktop also installs Python + aimeat-crewai + Ollama and runs a local agent out of the box |
| **Vibecoders / coders** | GitHub repo + a copy-paste Claude/ChatGPT/Grok prompt that scaffolds an AIMEAT-compatible crewaimeat agent | `buildTaskRunnerPrompt()` exists but only in the profile Agents tab | A landing-page "Build an agent in 10 minutes — copy this prompt" section + a maintained managed prompt |

## Current state (grounded facts)

- `aimeat-desktop/` — Tauri v2, Windows, v0.3.0. Bundles a Node sidecar (`scripts/stage-node.mjs`),
  the built server (`scripts/stage-server.mjs`, SQLite-only), WebView2 loader. GUI tabs incl.
  an **AI Setup** tab (`aimeat-desktop/src/index.html`). Tray + start/stop. Builds NSIS + MSI
  via `pnpm package`. **No CI, no GitHub Release.**
- `python/aimeat-crewai/` — v0.5.0. `run_crew_daemon()` polls the node and runs a crew per task.
  LLM is pass-through to CrewAI's abstraction (`llm` kwarg); docstring example uses OpenRouter.
  **No Ollama wiring, no TUI.** Connects via `aimeat connect serve` loopback + token keychain.
  Curated tool filter (`DAEMON_DEFAULT_TOOL_FILTER`, ~25 tools) exists because small models
  choke on the full ~95-tool schema — **directly relevant to local-model viability.**
- CI: `ci.yml` (Node test), `publish-aimeat-crewai.yml` (tag `aimeat-crewai-v*` → PyPI),
  `python-aimeat-crewai.yml` (path-gated Python tests). **No desktop release workflow.**
- Prompts: managed prompt service `GET /v1/prompts/:name` + `draft-offer` template
  (`src/services/draft-offer-prompt.ts`). `buildAgentPrompt()` (device-auth connect) and
  `buildTaskRunnerPrompt()` (CrewAI crew scaffold) live in `public/views/profile/agents-tab.js`.
- Landing (`public/views/landing.js`) has `buildLandingAppPrompt()` (APPS) — **no agent equivalent.**

## Workstreams

### A. Local agent runtime inside the desktop app (the core)

**Objective:** From the desktop "AI Setup" tab, a user clicks "Enable local agents" and the app
provisions everything needed to run a crewaimeat agent fully on localhost.

**Approach (provision-on-demand, not baked into the base installer):**
1. **Python runtime** — ship/fetch a portable, self-contained Python (python-build-standalone
   or `uv`-managed) into `%APPDATA%\com.overscale.aimeat-desktop\runtime\python\`. Do **not**
   require a system Python. Decision D1 below: bundle vs. first-run download.
2. **aimeat-crewai** — create an isolated venv and `pip install aimeat-crewai` (pinned version)
   into the runtime dir. crewai pulls heavy deps → this is why first-run download is attractive.
3. **Connector token** — desktop already has the node + owner; use the existing
   `aimeat connect add`/device-auth to mint a local agent token into the keychain
   (`~/.aimeat/tokens/...`) without the user touching a terminal.
4. **Daemon supervision** — desktop spawns `run_crew_daemon()` (via a thin Python entry script)
   as a managed child process with restart-on-crash, surfacing status to the GUI. Mirror how the
   Node sidecar is supervised today.

**Key files:** `aimeat-desktop/src-tauri/src/` (new Rust command(s) to manage the Python child +
status), `aimeat-desktop/scripts/stage-python.mjs` (new, mirrors `stage-node.mjs`),
`aimeat-desktop/src/index.html` (AI Setup tab UI), `python/aimeat-crewai/` (new console entry
for "run a default local agent" — see C).

**Acceptance:** fresh Windows box → install → Start node → AI Setup → "Enable local agents" →
within the GUI, an agent shows "running", and giving it a task (from the web portal) produces a
result, all offline against Ollama.

### B. Ollama as the local model backend for crewaimeat

**Objective:** crewaimeat agents run on a local Ollama model by default; no API keys.

**Approach:**
1. **Ollama install/detect** — AI Setup tab detects Ollama; if missing, guides/triggers install
   from ollama.com (cannot bundle — models are GB-scale). Pull a sensible default model
   (candidate: a tool-use-capable ~7–8B such as `qwen2.5` / `llama3.1`; final pick is D2).
2. **crewaimeat Ollama helper** — add a small helper in `aimeat-crewai` that builds
   `crewai.LLM(model="ollama/<model>", base_url="http://localhost:11434")` (CrewAI/litellm
   support the `ollama/` provider) and a config knob (`AIMEAT_AGENT_MODEL`, default local).
3. **Tool-filter coupling** — local models must use the curated tool filter
   (`DAEMON_DEFAULT_TOOL_FILTER`); document and default this on for Ollama runtimes so the
   schema doesn't overflow small context windows.

**Key files:** `python/aimeat-crewai/src/aimeat_crewai/` (new `models.py` or extend `daemon.py`),
README + `building-an-aimeat-compatible-agent.md` (model section), desktop AI Setup tab.

**Acceptance:** with Ollama running and the default model pulled, the daemon completes a simple
task end-to-end with no cloud LLM key set.

### C. One-button agent status & management (GUI-first; optional TUI)

**Objective:** "see agents' state and manage them easily," one click from the desktop.

**Recommendation:** make the **desktop GUI the agent manager** rather than build a separate TUI:
- The daemon already tracks in-flight tasks; the node already exposes agent status via
  `/v1/agents/*` (last_seen, tasks). The desktop already reads the node.
- Add an "Agents" panel to the desktop GUI: start/stop the local daemon, live status
  (running/idle/last task), recent results, and a "Run a test task" button.
- A real Python **TUI (textual/rich)** stays **optional** and coder-facing (D3) — useful for the
  repo path, not required for beginners.

**Key files:** `aimeat-desktop/src/index.html` + Rust status command; (optional) new
`python/aimeat-crewai/src/aimeat_crewai/tui.py` + console entry.

**Acceptance:** one button launches/stops the local agent and shows its state without a terminal.

### D. Automated Windows installer build + GitHub Release (CI)

**Objective:** a tagged push builds the installer on CI and publishes a downloadable GitHub
Release we can link to permanently (the landing "Get your own →" target).

**Approach:**
1. New workflow `.github/workflows/release-desktop.yml`, trigger `push` tags `desktop-v*.*.*`
   (+ `workflow_dispatch`), runner `windows-latest`.
2. Steps: checkout → setup Node/pnpm + Rust → run `stage-node` / `stage-server` /
   `stage-python` (A1) / `stage-webview2` → `tauri build` (NSIS + MSI). Use the official
   **tauri-action** to build and create/update the GitHub Release with the artifacts attached.
3. Version source-of-truth: `aimeat-desktop/src-tauri/tauri.conf.json`; validate tag matches
   (mirror the Python publish workflow's tag-vs-manifest check).
4. Output: a stable "latest release" URL for the installer.

**Acceptance:** pushing `desktop-v0.4.0` produces a GitHub Release with the signed-or-unsigned
`*_x64-setup.exe` (+ `.msi`) downloadable; the landing CTA points to it.

**Note / risk:** code signing (Authenticode) is out of scope here unless a cert is provided —
unsigned installers show a SmartScreen warning. Flag as D4.

### E. Landing page: "Build an agent in 10 minutes" + "Get your own → desktop"

**Objective:** the outward-facing page teaches both on-ramps.

**Approach:**
1. New landing section + `buildLandingAgentPrompt()` (mirrors `buildTaskRunnerPrompt`, landing
   tone): a copy-paste prompt for Claude/ChatGPT/Grok that scaffolds an AIMEAT-compatible
   crewaimeat agent from the repo (connect → `uv pip install aimeat-crewai` → liaison + crew →
   offers doc → run as daemon), instructing the AI to guide the user to a *good* agent.
2. Re-point **"Get your own →"** from `/v1/pricing` to the desktop GitHub Release (D) — the
   download path the developer asked for (beginners), with a secondary "or run from the repo"
   link (coders).
3. i18n en+fi together (Rule 4); file-header + version-history bumps (Rule 2); `ld-` prefix +
   theme tokens (Rule 8). Mirror the build-prompt against the canonical managed prompt so the
   landing copy and `/v1/prompts/*` don't drift.

**Key files:** `public/views/landing.js`, `public/css/views/landing.css`, `locales/en.json` +
`locales/fi.json`, possibly a new managed prompt `GET /v1/prompts/build-agent`.

**Acceptance:** logged-out visitor can copy a working agent-build prompt and find the desktop
download; verified by driving the browser (Rule 1b) on mobile + desktop widths.

### F. Dogfood: publish the handbook inside AIMEAT's own organism

**Objective:** the handbook/docs live in the AIMEAT dev organism (appdev MCP), maintained on
AIMEAT itself, doubling as AI-acceleration for extending the platform.

**Approach (respecting the gated publish ritual in CLAUDE.md):**
1. Map the docs that should become Handbook pages (getting-started, build-an-agent, desktop
   install, model setup) to organism Handbook entries.
2. Build/agree the `pnpm organism:sync` tool referenced in CLAUDE.md for two-way sync of
   `docs/known_gaps.md` + roadmap; keep the repo canonical for code/spec, the organism canonical
   for coordination/working context.
3. **Publishing is a milestone → only on explicit developer go-ahead in-session.** Drafts/edits
   are free; no auto-publish.

**Acceptance:** handbook pages exist as drafts in the organism, synced from the repo, ready for
an approved publish.

## Sequencing & dependencies

1. **B (Ollama helper in aimeat-crewai)** and **E1 (landing agent prompt)** are the most
   independent — they unblock testing the agent runtime and the coder on-ramp early.
2. **A (desktop runtime)** depends on B for the model and on a Python staging script.
3. **C (GUI manager)** depends on A.
4. **D (CI release)** depends on A's staging scripts existing (so CI can stage Python too).
5. **E2 ("Get your own" → release URL)** depends on D producing a release.
6. **F (organism)** is parallel and gated; start drafting any time, publish only on approval.

## Open decisions (need the developer)

- **D1 — Python delivery:** bundle a portable Python into the base installer (bigger download,
  fully offline first run) **vs.** download Python + aimeat-crewai on first "Enable local agents"
  (lean installer, needs network once). Recommendation: first-run download.
- **D2 — Default local model:** which Ollama model is the out-of-box default (tool-use capable,
  fits typical RAM)? Candidates: `qwen2.5:7b`, `llama3.1:8b`. Needs a quick capability check
  against the curated tool filter.
- **D3 — Separate Python TUI?** GUI-only manager (recommended) vs. also ship a textual/rich TUI
  for the coder path.
- **D4 — Code signing:** is an Authenticode cert available? Without it, installers trip
  SmartScreen. Affects D.
- **D5 — Where does "Get your own →" point until D ships?** Keep `/v1/pricing` temporarily, or a
  "coming soon / build from repo" interim target.

## Explicitly out of scope (for now)

- macOS / Linux desktop builds (desktop is Windows-only today).
- npm publish of the Node `aimeat` package (separate, still manual).

---

## Update 2026-06-17 — the agent runtime is the `crewaimeat` repo (supersedes A/B/C specifics)

**Correction to the original assumption.** The TUI, the agents, and the provider system are
NOT in `python/aimeat-crewai/` (that is the thin PyPI *library*: liaison + daemon + offers).
They live in a **separate repo**: GitHub `miikkij/crewaimeat` (cloned locally at
`e:/dev/GitHub/crewfive/`), package name `crewaimeat` v0.3.0.

**What `crewaimeat` contains (verified):**
- **Fleet TUI** — `src/crewaimeat/tui/app.py`, console script `crewaimeat-tui`, optional extra
  `tui = ["textual>=0.60"]`. This is the existing dev/vibecoder interface (resolves D3).
- **~40 crews** — `crews/*.py` (news, briefing, image, app-builder, editorial, researcher,
  workflow manager, etc.). These are the agents to bundle / offer in the desktop.
- **Provider system** — `src/crewaimeat/llm.py`: `get_llm()` + `MultiProviderLLM`, driven by an
  `llm_providers.json`. Provider types already include **`ollama`** (`ollama/` litellm prefix,
  default base `http://localhost:11434`), plus `openrouter`/`xai`/`openai`/`generic`. Per-model
  context windows; per-crew profiles (content vs coding); priority fallback **across providers**
  (e.g. local Ollama first, OpenRouter as backup). **Ollama is already a first-class provider —
  no integration to write, only a default config to ship.**
- **Deps:** `crewai[tools]>=1.14.7` + `aimeat-crewai>=0.5.0` (the in-repo PyPI lib) — so the
  desktop runtime pulls both.
- **Console scripts:** `crewaimeat` (scaffold), `crewaimeat-tui` (fleet TUI), `research-crew`.

**Revised workstream A (desktop runtime):** provision Python (D1: first-run download) → install
the **`crewaimeat`** package from GitHub (`pip install "git+https://github.com/miikkij/crewaimeat"`,
pinned ref) which transitively brings `aimeat-crewai` + `crewai[tools]` + its crews → mint the
local agent token via existing connect/device-auth → supervise the fleet (daemon) as a managed
child, status surfaced to the desktop GUI.

**Revised workstream B (Ollama):** ship a desktop-default `llm_providers.json` whose primary
provider is local `ollama` with the chosen model (D2), optional cloud provider as fallback. The
desktop "AI Setup" tab ensures Ollama is installed and the model pulled. No provider code to
write — the system already supports Ollama; bundle `scripts/check_models.py` as the capability
probe for the local model against the curated tool filter.

**Revised workstream C (interfaces):** desktop **GUI = the "normal" manager** (status/start/stop/
test, one button); the existing **`crewaimeat-tui` = the vibecoder/dev interface** (ships in the
runtime, launchable from the GUI or a terminal). This matches the developer's D3 answer exactly.

**Distribution note:** the crews are "available directly from GitHub" (the `crewaimeat` repo), so
the desktop can install/update them from a pinned Git ref without a PyPI release of `crewaimeat`
itself. A later `crewaimeat` PyPI/tag release is optional.

## Decisions resolved / answered (2026-06-17)

- **D1 — first-run download** (confirmed).
- **D2 — RESOLVED: local Gemma on Ollama** (offline default, no keys). Developer chose local
  Gemma ("Gemma 4 paikallinen"). Implementation: make the model configurable
  (`AIMEAT_AGENT_MODEL`) and default to the **newest Gemma available on Ollama** — `gemma3`
  today, auto-adopting `gemma4` once it lands on Ollama. Ships in the desktop default
  `llm_providers.json` as the primary `ollama` provider; cloud providers remain optional
  fallbacks the user can add later. Probe local capability against the curated tool filter
  (`crewaimeat/scripts/check_models.py`).
- **D3 — resolved:** GUI for normal users; the existing `crewaimeat-tui` for vibecoder/dev.
- **D4 — code signing:** no cert today; installers ship unsigned (SmartScreen warning). A free
  Authenticode signing path is being evaluated. Add the signing step back into
  `release-desktop.yml` once a method is chosen.
- **D5 — interim CTA target:** before the first `desktop-v*` GitHub Release exists, "Get your own
  →" points to the repo **Releases page**; once the release workflow publishes the installer, it
  resolves to the direct download. (This is what D5 asked: where the button goes in the gap before
  the first automated release.)

- **F — confirmed:** create the AIMEAT organism that ships with the package from the start.

## Implementation status — 2026-06-17 (first pass, all workstreams)

Built on `main`. Verified = lint 0 errors, JSON/YAML valid, Node scripts `--check` clean, i18n
en/fi in sync. **Not verified here** (needs the developer's machine): the Rust compile, the Tauri
desktop build, and live browser/desktop runs (dev server was down + Playwright browser profile
locked during the session).

- **E — done & verified (code).** `buildLandingAgentPrompt()` + `BuildAgentPrompt` section in
  `landing.js`; i18n `agentBuildTitle`/`agentBuildSub` (en+fi); Hero "Get your own →" → the desktop
  release page. Browser verification pending.
- **D — done & verified (file).** `.github/workflows/release-desktop.yml` — `desktop-v*` tag →
  windows build (stage + `tauri build`) → GitHub Release with NSIS+MSI; tag-vs-manifest gate.
  To use: bump `aimeat-desktop/src-tauri/tauri.conf.json` version, push `desktop-vX.Y.Z`.
- **B — done & verified (file).** `aimeat-desktop/resources/agent-runtime/llm_providers.default.json`
  (local Gemma primary, qwen2.5:7b fallback, keyless) + README; bundled via `tauri.conf.json`
  `resources`. Ollama is already a first-class provider in `crewaimeat/src/crewaimeat/llm.py` — no
  integration code needed.
- **A — done (scripts verified; Rust NOT compiled).** `resources/agent-runtime/provision.mjs`
  (git/uv/ollama provisioning, JSON-line progress) + `run-agent.mjs` (uv-run daemon supervisor with
  backoff). Rust glue `src-tauri/src/agent_runtime.rs` (`agent_provision`/`agent_start`/`agent_stop`/
  `agent_status`) mirrors `chat.rs`; registered in `main.rs`. **Must `cargo check` / `pnpm tauri
  build` on a Windows machine.** No `stage-python.mjs` needed (D1 = first-run download; resources are
  static-bundled).
- **C — done & verified (GUI JS).** Agents tab in `aimeat-desktop/src/index.html` (Enable local
  agents · Start/Stop · Activity log) wired to the `agent_*` commands + `agent-event` stream.
  Compiles only once the Rust (A) is built.
- **F — drafted (gated publish).** `docs/handbook/README.md` + `docs/handbook/local-agents.md` —
  both on-ramps + local-model setup. Publishing to an AIMEAT organism awaits explicit go-ahead.

### Follow-ups for the developer's machine
1. `cd aimeat-desktop/src-tauri && cargo check` (or `pnpm tauri build`) — confirm `agent_runtime.rs`
   compiles; fix any borrow/type nits.
2. End-to-end desktop run: Enable local agents → Start → queue a task → confirm a local-Gemma result.
3. Bump desktop version + push `desktop-v*` to exercise the release workflow.
4. Browser-verify the landing agent prompt (Rule 1b) once the dev server/Playwright are free.
5. Decide on publishing the handbook to an AIMEAT organism (F, gated).
